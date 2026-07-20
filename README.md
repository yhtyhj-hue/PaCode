# PaCode

> 类 Claude Code 架构的 AI 编程助手框架

## 项目概述

PaCode 是一个参考 Claude Code 架构理念设计的 AI 编程助手，完全独立实现，不使用任何 Claude Code 源代码。

### 核心特性

- **AI Agent 循环** — QueryEngine 异步生成器循环，支持 Subagent + SubagentStop hook
- **7 级权限系统** — plan → default → acceptEdits → auto → dontAsk → bypass → bubble，含 tool permissionMode 门禁（Layer 4）；非 TTY 默认 deny（`PACODE_AUTO_APPROVE=1` 可放行）
- **31 核心工具** — Bash(+BashOutput/BashStop)/Read/Edit/Write/Grep/Glob/Task*/Team/Coordinator/Skill/ToolSearch/Config/NotebookEdit/ScheduleCron/Diagnostics(+LSP)/AskUser/Web*/MCP* 等；文件工具限制在工作区内
- **9 上下文源 + 5 层压缩** — Budget → Snip → Microcompact → Collapse → Auto-compact（L4–L5 已实现）
- **文件化记忆** — 用户级 `.paude/memory/` + 项目级 `.paude/projects/{hash}/`
- **4 层扩展机制** — Hooks → Skills → Plugins（工具/agent 注册）→ MCP（stdio / SSE / HTTP / WebSocket）+ **bridge/v1-local** 本机会话中继（公网 SaaS 不在范围）
- **CLI / REPL / Ink TUI** — Plan 模式（`/plan`）、slash（含 `/btw`）、`--tui`、`-p` headless、流式 Markdown、cc-switch
- **SDK** — `import { runAgent } from 'pacode'`（见 `src/sdk/README.md`）

## 快速开始

```bash
npm install
npm run build
npm start
```

### CLI 命令

| 命令 | 说明 |
|------|------|
| `pacode [message]` | 启动 Agent（可选 `-m` 权限模式、`--model` 等） |
| `pacode mcp list\|add\|remove` | 管理 MCP 服务器配置 |
| `pacode init` | 初始化项目 `.paude/` 目录 |
| `pacode resume [id]` | 恢复 REPL 会话 |
| `pacode worktree list\|create\|remove` | 管理 git worktree |
| `pacode cc-switch list\|use\|add\|…` | 切换 API provider |

REPL slash 命令：`/plan`、`/compact`、`/mode`、`/help` 及 plugin 注册命令。

## 测试与质量

```bash
npm test              # unit + gate（排除 evals/periodic）
npm run test:coverage # 同 exclude；阈值 lines/statements ≥80、functions ≥79、branches ≥73.9
npm run eval:gate     # 确定性 eval（M1 policy+引擎行为 / M2–M5 / M3 harness）
npm run eval:periodic # LLM / head-to-head（需凭证；COMPARE 含 ccVersion/model）
```

当前：`npm test` + `npm run eval:gate` + **CI 含 coverage**。阈值见 `vitest.config.ts`（branches 74%，非「全面 80%」）。Phase H–K 见 [docs/ROADMAP.md](./docs/ROADMAP.md)。

## 文档

- [架构设计文档](./ARCHITECTURE.md)
- [实施路线图](./docs/ROADMAP.md)
- [CLAUDE.md](./CLAUDE.md)
- [docs/](./docs/)

## 项目结构

```
PaCode/
├── src/
│   ├── agent/        # QueryEngine、Subagent、Plan 模式
│   ├── cli/          # CLI 入口、REPL、handlers、worktree
│   ├── context/      # 9 源组装 + 5 层压缩
│   ├── hooks/        # Hook 注册与执行
│   ├── memory/       # 用户 + 项目级记忆
│   ├── mcp/          # MCP 客户端（@modelcontextprotocol/sdk）
│   ├── permission/   # 7 级权限 + tool-gate + AUTO 分类器
│   ├── plugins/      # Plugin 工具/agent 加载
│   ├── pkg/          # config、settings、cc-switch、app-config
│   ├── session/      # 会话持久化
│   ├── skills/       # Skills 加载
│   └── tools/        # 31 核心工具 + bash-secure
├── plugins/          # 示例插件（tools/agents）
├── evals/            # Eval harness（gate + periodic）
├── test/             # Vitest gate tests
├── docs/             # 使用文档与路线图
└── rules/            # 项目规则
```

## 开发阶段

| 阶段 | 目标 | 状态 |
|------|------|------|
| Phase A | 配置基础设施（app-config、MCP CLI、压缩配置化） | ✅ |
| Phase B | Agent 核心（压缩 L4–5、Engine 测试、Subagent） | ✅ |
| Phase C | CLI/REPL（Plan 模式、handlers/slash 测试） | ✅ |
| Phase D | 扩展机制（Plugin 工具、Skills、Worktree） | ✅ |
| Phase E | 安全与存储（Bash 加固、项目 Memory、tool-gate） | ✅ |
| Phase F | 质量与文档（80% 覆盖率、文档同步、Eval 骨架） | ✅ |

## 技术栈

- **语言**: TypeScript (Node.js >= 18)
- **CLI**: readline REPL + Ink TUI（`--tui`）+ ANSI / 流式 Markdown
- **AI**: Anthropic Messages API（cc-switch 多 provider）
- **Protocol**: MCP (`@modelcontextprotocol/sdk`)；Bridge = 本机 WS（非公网）
- **Storage**: 文件存储（会话 + 记忆）
- **测试**: Vitest（unit+gate；coverage 四维阈值见 vitest.config.ts）

## 参考资料

- [Dive into Claude Code](https://github.com/VILA-Lab/Dive-into-Claude-Code)
- [Claude Code Architecture](https://arxiv.org/html/2604.14228v1)

## 许可证

MIT
