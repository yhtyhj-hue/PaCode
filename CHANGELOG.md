# Changelog

## 0.2.0

### 多模型 / Provider
- 内置 Anthropic Messages 兼容预设：MiniMax、DeepSeek、豆包 Coding、智谱 GLM、腾讯混元、阿里千问、Kimi、Anthropic
- **OpenAI Chat Completions 协议**：`openai` / `ollama` / `lmstudio` 预设；引擎双协议分叉
- **Models.dev**：`pacode cc-switch models-dev` 浏览 / `add`（openai-compatible + anthropic 可映射项）
- `planMode`：`api` | `token-plan` | `coding-plan`；`apiProtocol`：`anthropic` | `openai`
- 腾讯 TokenHub Token Plan、GLM / MiniMax / Kimi Coding Plan 预设
- CLI：`pacode cc-switch presets [--plan=…]`、`add --preset=… --plan=… --protocol=…`
- REPL/TUI：`/providers use`、`/providers presets`
- 显式导入 CC Switch（`~/.cc-switch/cc-switch.db`）与 `~/.claude/settings.json`（启动不自动拉取）
- Bearer 鉴权（豆包 / Token Plan / Coding Plan）

### 文档 / 官网
- `docs/CONFIG.md` 多模型与 Token Plan 说明
- 官网实测对照栏对齐；`section-alt` 内容柱与全页统一

## 0.1.4

- CLI / MCP / boot banner 版本号从 `package.json` 读取，不再写死
- 产品官网（GitHub Pages）上线：优势、M5 vs Claude Code 实测、OpenCode 定位对照

## 0.1.1 – 0.1.3

- npm 发布 `@sallon/pacode`，默认 MiniMax-M3 + Anthropic 兼容网关
- bin shim、scoped 包名、安装与文档修正
- 仓库主托管迁至 GitHub；Gitee 作镜像
