# PaCode

[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@sallon/pacode.svg)](https://www.npmjs.com/package/@sallon/pacode)

> 类 Claude Code 架构的 AI 编程助手框架 · 默认 MiniMax-M3

- **GitHub:** https://github.com/yhtyhj-hue/PaCode  
- **Gitee 镜像:** https://gitee.com/sallon/pa-code  
- **npm:** https://www.npmjs.com/package/@sallon/pacode

## 项目概述

PaCode 是一个参考 Claude Code 架构理念设计的 AI 编程助手，完全独立实现，不使用任何 Claude Code 源代码。配置与记忆使用 `~/.paude/` / `.paude/`，不依赖 Claude Code 本地配置。

### 核心特性

- **AI Agent 循环** — QueryEngine 异步生成器循环，支持 Subagent 与 SubagentStop hook
- **7 级权限系统** — `plan` → `default` → `acceptEdits` → `auto` → `dontAsk` → `bypass` → `bubble`；含 tool `permissionMode` 门禁（Layer 4）；非 TTY 默认 deny（`PACODE_AUTO_APPROVE=1` 可放行）
- **31 核心工具** — 文件工具限制在工作区内：
  - 文件：`Read` · `Edit` · `Write` · `Grep` · `Glob` · `NotebookEdit`
  - Shell：`Bash` · `BashOutput` · `BashStop`
  - 任务：`Task` · `Team` · `Coordinator` · `TodoWrite` · `ScheduleCron`
  - 扩展：`Skill` · `ToolSearch` · `Config` · `AskUser`
  - 诊断 / 网络 / MCP：`Diagnostics`（含 LSP）· `WebFetch` / `WebSearch` · MCP 系列
- **10 上下文源 + 5 层压缩** — 含 Recent Results；压缩链：L1 Budget-Reduction（限速）→ Snip → Microcompact → Collapse → Auto-compact
- **文件化记忆** — 用户级 `.paude/memory/` + 项目级 `.paude/projects/{hash}/`
- **4 层扩展** — Hooks → Skills → Plugins → MCP（stdio / SSE / HTTP / WebSocket）；本机 `bridge/v1-local`（无公网 SaaS）
- **CLI / REPL / Ink TUI** — `/plan`、paste chips、live task、↑↓ 历史与 slash 导航、`-p`、`--tui`、cc-switch
- **SDK** — `import { runAgent } from '@sallon/pacode'`（见 `src/sdk/README.md`）

## 快速开始

### 全局安装（推荐：npm 正式包）

```bash
npm install -g @sallon/pacode
pacode --version
pacode -p "hello"
```

命令行名仍是 `pacode`（包名为作用域 `@sallon/pacode`）。**不要用 `sudo`**（会搞乱权限；改用 nvm / 修 npm 全局前缀即可）。

配置 MiniMax（默认）见 [docs/CONFIG.md](docs/CONFIG.md)；需设置 `ANTHROPIC_API_KEY`（或 `PACODE_API_KEY`）。

### 从源码安装（跟仓库最新提交）

优先用 **GitHub**（npm 对 GitHub 的 `git+https` 支持更稳）。不要裸写仓库 URL（会被当成 tarball，易出现 `TAR_BAD_ARCHIVE`）：

```bash
# 方式 A：git+https
npm install -g "git+https://github.com/yhtyhj-hue/PaCode.git#main"

# 方式 B（更稳）：clone → build → link
git clone https://github.com/yhtyhj-hue/PaCode.git
cd PaCode
npm install
npm run build
npm link
```

Gitee 镜像：

```bash
git clone https://gitee.com/sallon/pa-code.git
cd pa-code && npm install && npm run build && npm link
```

### 从源码开发

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
│   ├── context/      # 10 源组装 + 5 层压缩
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

**Business Source License 1.1 (BUSL-1.1)** — 源码可见，但**不**是 OSI 开源协议。

| 用途 | 是否需要商业许可 |
|------|------------------|
| 个人本地试用 / 学习 / 学术研究 | ❌ 免费 |
| 个人小项目开发（非生产） | ❌ 免费 |
| **任何组织**的**员工 / 承包商 / 自动化系统**用于开发、测试之外的场景 | ✅ 需要 |
| 对外提供服务 / 嵌入第三方产品 / 多用户部署 | ✅ 需要 |

判定边界：**只要有"组织"在用 PaCode 处理真实工作流，就算生产用途（Production Use）**，与该组织员工是否独立安装无关。详见 `LICENSE`。

**Change Date**：2030-07-20 — 此后自动转为 Apache License 2.0。

商用授权联系：见 `LICENSE` 顶部 Licensor。
