/**
 * K7: start Ink TUI REPL wired to QueryEngine
 */

import { render } from 'ink';
import { QueryEngine } from '../../agent/engine.js';
import { SessionManager } from '../../session/manager.js';
import { getToolRegistry } from '../../tools/registry.js';
import { registerCoreTools } from '../../tools/bootstrap.js';
import { bootstrapMcpTools } from '../../mcp/loader.js';
import { bootstrapHooks } from '../../hooks/loader.js';
import { HookRegistry } from '../../hooks/registry.js';
import { ContextAssembler } from '../../context/assembler.js';
import { SkillsLoader } from '../../skills/loader.js';
import { PermissionMode, type SessionState, type ToolCall } from '../../pkg/types.js';
import type { Provider } from '../../pkg/ccswitch/index.js';
import { AskUserAbortedError } from '../../services/ask-user/index.js';
import type { OutputStyle } from '../output-styles.js';
import { TuiApp, type TuiController } from './app.js';
import { handleTuiSlash } from './slash.js';

export interface InkReplOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  mode: PermissionMode;
  provider: Provider;
  authStyle?: import('../../pkg/anthropic-client.js').ProviderAuthStyle;
  apiProtocol?: import('../../pkg/ccswitch/presets.js').ProviderApiProtocol;
}

function summarizeTool(tool: ToolCall): string {
  const input = tool.input as Record<string, unknown>;
  const cmd = input['command'] ?? input['path'] ?? input['pattern'];
  return typeof cmd === 'string' ? cmd.slice(0, 60) : '';
}

export async function startInkRepl(options: InkReplOptions): Promise<void> {
  const skillsLoader = new SkillsLoader();
  await skillsLoader.loadAll();

  const toolRegistry = getToolRegistry();
  const hookRegistry = new HookRegistry();
  registerCoreTools(toolRegistry, {
    task: {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      toolRegistry,
    },
    skillsLoader,
  });
  bootstrapHooks(hookRegistry);
  await bootstrapMcpTools(toolRegistry);

  const sessionManager = new SessionManager();
  const session: SessionState = sessionManager.createSession({ mode: options.mode });

  let ctl: TuiController | null = null;
  let exitRequested = false;
  let interrupt = false;
  const tokenUsage = { input: 0, output: 0 };
  let outputStyle: OutputStyle = 'default';
  let model = options.model;

  const engine = new QueryEngine({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    authStyle: options.authStyle ?? options.provider.authStyle,
    apiProtocol: options.apiProtocol ?? options.provider.apiProtocol,
    toolRegistry,
    sessionManager,
    hookRegistry,
    contextAssembler: new ContextAssembler({ skillsLoader }),
    permissionPrompt: async (tool, batch) => {
      const names = batch?.length
        ? batch.map((t) => t.name).join(', ')
        : tool.name;
      const detail = summarizeTool(tool);
      const q = detail ? `Allow ${names}? (${detail})` : `Allow ${names}?`;
      if (!ctl) return false;
      return ctl.askConfirm(q);
    },
    // AskUser：Ink askText，避免再开 readline 抢 stdin
    readLine: async (prompt) => {
      if (!ctl) throw new AskUserAbortedError();
      return ctl.askText(prompt);
    },
  });

  const onSubmit = async (text: string): Promise<void> => {
    if (!ctl) return;
    if (text.startsWith('/')) {
      const handled = await handleTuiSlash(text, {
        ctl,
        session,
        model,
        apiKeyPresent: Boolean(options.apiKey),
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        setModel: (m) => {
          model = m;
        },
        applyProvider: (p) => {
          model = p.model ?? model;
          engine.setCredentials({
            apiKey: p.apiKey,
            baseUrl: p.baseUrl,
            authStyle: p.authStyle,
            apiProtocol: p.apiProtocol,
          });
        },
        providerName: options.provider.name,
        tokenUsage,
        outputStyle,
        setOutputStyle: (s) => {
          outputStyle = s;
        },
        onSessionRestored: () => {
          // applySessionState 已写回 live session；SessionManager 必须指向同一引用
          sessionManager.restoreSession(session);
        },
        onSessionCompacted: () => {
          sessionManager.saveSession(session);
        },
      });
      if (handled) return;
    }
    interrupt = false;
    ctl.appendUser(text);
    ctl.setBusy(true);
    ctl.setStatus('querying');
    session.messages.push({ role: 'user', content: text, timestamp: Date.now() });

    try {
      for await (const event of engine.query(
        {
          message: text,
          options: {
            model,
            shouldAbort: () => interrupt || exitRequested,
          },
        },
        session
      )) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          ctl.appendAssistantDelta(event.delta.text);
        } else if (event.type === 'tool_use' && event.tool) {
          ctl.appendTool(event.tool.name, summarizeTool(event.tool));
        } else if (event.type === 'message_stop' && event.usage) {
          tokenUsage.input += event.usage.inputTokens ?? 0;
          tokenUsage.output += event.usage.outputTokens ?? 0;
        } else if (event.type === 'error' && event.error) {
          ctl.appendError(event.error.message);
        }
      }
    } catch (e) {
      ctl.appendError(e instanceof Error ? e.message : String(e));
    } finally {
      ctl.setBusy(false);
      ctl.setStatus('ready');
      sessionManager.saveSession(session);
    }
  };

  const instance = render(
    <TuiApp
      model={options.model}
      mode={options.mode}
      providerName={options.provider.name}
      bindController={(c) => {
        ctl = {
          ...c,
          requestInterrupt: () => {
            interrupt = true;
            c.requestInterrupt();
          },
        };
      }}
      onSubmit={onSubmit}
      onExit={() => {
        exitRequested = true;
        interrupt = true;
      }}
    />
  );

  await instance.waitUntilExit();
}
