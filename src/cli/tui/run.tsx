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
import { TuiApp, type TuiController } from './app.js';

export interface InkReplOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  mode: PermissionMode;
  provider: Provider;
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

  const engine = new QueryEngine({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
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
  });

  const onSubmit = async (text: string): Promise<void> => {
    if (!ctl) return;
    if (text.startsWith('/')) {
      await handleSlash(text, ctl, session);
      return;
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
            model: options.model,
            shouldAbort: () => interrupt || exitRequested,
          },
        },
        session
      )) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          ctl.appendAssistantDelta(event.delta.text);
        } else if (event.type === 'tool_use' && event.tool) {
          ctl.appendTool(event.tool.name, summarizeTool(event.tool));
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

  // 等待 Ink 退出（/exit 或 Ctrl+C）
  await instance.waitUntilExit();
}

async function handleSlash(
  text: string,
  ctl: TuiController,
  session: SessionState
): Promise<void> {
  const [cmd, ...args] = text.slice(1).split(/\s+/);
  if (cmd === 'help') {
    ctl.appendSystem('/help /clear /mode <name> /status /exit');
    return;
  }
  if (cmd === 'clear' || cmd === 'reset') {
    session.messages = [];
    ctl.appendSystem('Conversation cleared');
    return;
  }
  if (cmd === 'status') {
    ctl.appendSystem(
      `session=${session.sessionId} messages=${session.messages.length} mode=${session.mode}`
    );
    return;
  }
  if (cmd === 'mode') {
    const next = args[0];
    const allowed = Object.values(PermissionMode) as string[];
    if (!next || !allowed.includes(next)) {
      ctl.appendSystem(`Usage: /mode ${allowed.join('|')}`);
      return;
    }
    session.mode = next as PermissionMode;
    ctl.setMode(next as PermissionMode);
    ctl.appendSystem(`mode=${next}`);
    return;
  }
  ctl.appendSystem(`Unknown slash: /${cmd}. Try /help`);
}
