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
import { getTodoStore } from '../../context/todo-store.js';
import { todosToPanelItems } from '../live-task-panel.js';

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

/**
 * TUI 模式:把任何对 process.stdout.write 的直写(hook / 第三方代码)路由到
 * controller,避免腐蚀 Ink 的 alt-screen。
 *
 * 重要:含 ANSI escape(\x1b[)的内容必须 pass-through,不要 appendSystem —
 * LiveTaskPanel / QueryProgress / ToolRunningLine 这类老 live widget 写的是
 * cursor-up + clear-to-end 的"原地重绘"指令,如果被 appendSystem 转成 transcript
 * 行就会污染屏幕(老 widget 的重绘会重复显示整块内容)。
 */
function installStdoutShim(ctl: TuiController): () => void {
  const original = process.stdout.write.bind(process.stdout);
  const shim = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString('utf-8');
    // 含 escape 序列的写:透传(老 live widget 的 cursor 重绘不应进入 transcript)
    if (text.includes('\x1b[')) {
      return original(chunk, ...(rest as []));
    }
    // 含换行的长写(hook / console.log 等):折成一行系统消息
    if (text.length > 4 && text.includes('\n')) {
      ctl.appendSystem(text.replace(/\n+$/, ''));
    }
    return original(chunk, ...(rest as []));
  }) as typeof process.stdout.write;
  process.stdout.write = shim;
  return (): void => {
    process.stdout.write = original;
  };
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
    // AskUser:Ink askText / askChoice,避免再开 readline 抢 stdin
    readLine: async (prompt) => {
      if (!ctl) throw new AskUserAbortedError();
      return ctl.askText(prompt);
    },
    // 结构化 AskUser 通道(CC 同款):TUI 自己渲染选项 + 方向键选择
    askUser: async (rawInput) => {
      if (!ctl) throw new AskUserAbortedError();
      const input = rawInput as {
        question: string;
        header?: string;
        options: Array<{ id: string; label: string; description?: string }>;
        multiSelect?: boolean;
        default_id?: string;
      };
      return ctl.askChoice(input);
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
    ctl.setProgressPhase('Accomplishing…');
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
          if (event.tool.name === 'TodoWrite') {
            // TodoWrite 写完后,把 store 里的 todo 列表作为 live task panel 内容推给 controller
            const items = todosToPanelItems(getTodoStore().list(session.sessionId));
            ctl.setLiveTasks(items);
          }
          ctl.setToolRunning({ name: event.tool.name });
        } else if (event.type === 'tool_result') {
          ctl.setToolRunning(null);
        } else if (event.type === 'message_stop' && event.usage) {
          const inTok = event.usage.inputTokens ?? 0;
          const outTok = event.usage.outputTokens ?? 0;
          tokenUsage.input += inTok;
          tokenUsage.output += outTok;
          ctl.addTokens(inTok, outTok);
        } else if (event.type === 'error' && event.error) {
          ctl.appendError(event.error.message);
        }
      }
    } catch (e) {
      ctl.appendError(e instanceof Error ? e.message : String(e));
    } finally {
      ctl.setBusy(false);
      ctl.setStatus('ready');
      ctl.setProgressPhase(null);
      ctl.setToolRunning(null);
      ctl.setLiveTasks([]);
      sessionManager.saveSession(session);
    }
  };

  const instance = render(
    <TuiApp
      model={options.model}
      mode={options.mode}
      providerName={options.provider.name}
      tokens={tokenUsage}
      bindController={(c) => {
        ctl = {
          ...c,
          requestInterrupt: () => {
            interrupt = true;
            c.requestInterrupt();
          },
        };
        // 安装 stdout shim;caller 卸载后通过 instance.unmount() 自动恢复
        const restore = installStdoutShim(c);
        instance.waitUntilExit().finally(restore);
      }}
      onSubmit={onSubmit}
      onExit={() => {
        exitRequested = true;
        interrupt = true;
      }}
    />
  );

  // 启动后台 turn(从外部模块调用);目前通过 setVoiceTranscriptHandler 暴露
  // 给 run.tsx 接入 speech-to-text 的注入路径。

  await instance.waitUntilExit();
}

/**
 * 后台 turn:从 run.tsx 启动 agent 时通过此函数把完成消息注入 controller。
 */
export async function runBackgroundTurn(args: {
  prompt: string;
  ctl: TuiController;
  engine: QueryEngine;
  session: SessionState;
  onEvent: (event: 'started' | 'done' | 'error', detail: string) => void;
}): Promise<void> {
  const { prompt, ctl, engine, session } = args;
  const id = Math.floor(Math.random() * 9000) + 1000;
  ctl.appendSystem(`[bg ${id}] started — /agents to list`);
  args.onEvent('started', `[bg ${id}]`);
  try {
    let lastText = '';
    for await (const event of engine.query({ message: prompt }, session)) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        lastText += event.delta.text;
      } else if (event.type === 'error' && event.error) {
        ctl.appendSystem(`[bg ${id}] error: ${event.error.message}`);
        args.onEvent('error', event.error.message);
        return;
      }
    }
    const preview = lastText.trim().split('\n').slice(0, 3).join(' ').slice(0, 120);
    ctl.appendSystem(`[bg ${id}] done: ${preview || '(no output)'}`);
    args.onEvent('done', preview);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctl.appendSystem(`[bg ${id}] error: ${msg}`);
    args.onEvent('error', msg);
  }
}