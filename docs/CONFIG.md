# PaCode 配置指南

默认走 **MiniMax-M3**（Anthropic 兼容网关）。启动时**不**自动读取 Claude Code 配置；可用 `pacode cc-switch import` 显式从 **CC Switch** / `~/.claude/settings.json` 导入。

多模型通过 **cc-switch + 内置 preset** 管理，并区分：

| planMode | 含义 | 示例 |
|----------|------|------|
| `api` | 开放平台按量 | deepseek、hunyuan、qwen、openai |
| `token-plan` | 腾讯 TokenHub Token Plan 套餐 | `tencent-token-plan` |
| `coding-plan` | 各家 Coding Plan | MiniMax Coding、Z.ai GLM、豆包 Coding、Kimi Code |

| apiProtocol | 含义 |
|-------------|------|
| `anthropic` | Anthropic Messages（默认国产网关） |
| `openai` | OpenAI Chat Completions（官方 / Ollama / LM Studio / Models.dev 兼容端） |

## 配置文件位置

按优先级查找（前者优先）：
1. `.paude/config.json` 或 `.paude/config.yaml`
2. `.pauderc.json`
3. `paude.config.json`

Settings（模型/密钥层）：
1. `.paude/settings.local.json`（项目本地，勿提交密钥）
2. `.paude/settings.json`（项目）
3. `~/.paude/settings.json`（用户）

Providers：`~/.paude/providers.json`（`pacode cc-switch`）

## CC Switch / Claude 导入

```bash
pacode cc-switch detect
pacode cc-switch import                 # CC Switch DB + Claude settings
pacode cc-switch import --from=cc-switch
pacode cc-switch import --from=claude
pacode cc-switch list
pacode cc-switch use <name>
```

读取源（存在则可用）：

- `~/.cc-switch/cc-switch.db`（[CC Switch](https://ccswitch.io) 桌面端）
- `~/.cc-switch/config.json`（旧版 JSON）
- `~/.cc-switch-cli/store.json`
- `~/.claude/settings.json` 的 `env` 块（`ANTHROPIC_BASE_URL` / `AUTH_TOKEN` / `MODEL`）

导入写入 `~/.paude/providers.json`，不覆盖你未导入的本地项以外的同名项会合并更新。

## OpenAI / Ollama / Models.dev

```bash
# OpenAI 官方
pacode cc-switch add openai --preset=openai --api-key=sk-xxx
pacode cc-switch use openai

# 本地 Ollama（先 ollama pull qwen2.5-coder）
pacode cc-switch add ollama --preset=ollama
pacode cc-switch use ollama

# LM Studio 本地服务
pacode cc-switch add lmstudio --preset=lmstudio

# Models.dev 目录（缓存 ~/.paude/cache/models-dev.json；约 100+ openai-compatible）
pacode cc-switch models-dev
pacode cc-switch models-dev --q=groq --protocol=openai
pacode cc-switch models-dev add openrouter --api-key=sk-xxx
```

环境变量：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`PACODE_API_PROTOCOL=openai`。

不支持的 Models.dev 包（如纯 Google / Bedrock 专用 SDK）不会出现在可用列表中。

## Token Plan / Coding Plan

```bash
# 只看套餐类预设
pacode cc-switch presets --plan=token-plan
pacode cc-switch presets --plan=coding-plan

# 腾讯 Token Plan（TokenHub）
pacode cc-switch add tp --preset=tencent-token-plan --api-key=套餐Key
# 或简写：
pacode cc-switch add tp --plan=token-plan --api-key=套餐Key
pacode cc-switch use tp

# 智谱 / Z.ai Coding Plan
pacode cc-switch add glm-cp --preset=glm-coding-plan --api-key=xxx

# MiniMax Coding Plan
pacode cc-switch add mm-cp --preset=minimax-coding --api-key=sk-cp-xxx
```

套餐内换模型：`pacode --model=glm-5.1` 或 `/model glm-5.1`（以套餐文档为准）。

## 多模型 / Provider 预设

```bash
pacode cc-switch presets
pacode cc-switch add deepseek --preset=deepseek --api-key=sk-xxx
pacode cc-switch use deepseek
pacode --preset=deepseek --api-key=sk-xxx -p "hello"
```

REPL / TUI：`/providers` · `/providers presets` · `/providers use <name>`

| 预设 | Base URL | 默认模型 | plan | 鉴权 |
|------|----------|----------|------|------|
| `minimax` | `api.minimaxi.com/anthropic` | `MiniMax-M3` | api | api-key |
| `minimax-coding` | 同上 | `MiniMax-M3` | coding-plan | bearer |
| `deepseek` | `api.deepseek.com/anthropic` | `deepseek-v4-pro` | api | api-key |
| `doubao` | `ark…/api/coding` | `ark-code-latest` | coding-plan | bearer |
| `glm` | `open.bigmodel.cn/api/anthropic` | `glm-5.2` | api | api-key |
| `glm-coding-plan` | `api.z.ai/api/anthropic` | `glm-5.2` | coding-plan | bearer |
| `hunyuan` | `api.hunyuan.cloud.tencent.com/anthropic` | hunyuan-2.0-… | api | api-key |
| `tencent-token-plan` | `api.lkeap…/plan/anthropic` | `tc-code-latest` | **token-plan** | bearer |
| `qwen` / `qwen-intl` | DashScope `/apps/anthropic` | `qwen3-coder-plus` | api | api-key |
| `kimi` / `kimi-coding` | `api.moonshot.cn/anthropic` | `kimi-k2.5` | api / coding-plan | … |

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `ANTHROPIC_API_KEY` / `PACODE_API_KEY` | API Key | - |
| `ANTHROPIC_AUTH_TOKEN` | Bearer（Token Plan / Coding Plan 常用） | - |
| `ANTHROPIC_BASE_URL` / `PACODE_BASE_URL` | Anthropic 兼容端点 | MiniMax 国内 |
| `CLAUDE_MODEL` / `PACODE_MODEL` | 默认模型 | `MiniMax-M3` |
| `PACODE_AUTH_STYLE` | `api-key` \| `bearer` | `api-key` |
| `PACODE_PLAN_MODE` | `api` \| `token-plan` \| `coding-plan` | - |
| `CLAUDE_MAX_TOKENS` | 最大输出 tokens | `8192` |

## 配置示例

```json
{
  "version": "1.0.0",
  "model": {
    "provider": "anthropic",
    "model": "MiniMax-M3",
    "maxTokens": 8192,
    "temperature": 0.7,
    "baseUrl": "https://api.minimaxi.com/anthropic"
  },
  "permission": {
    "mode": "default"
  },
  "context": {
    "maxTokens": 200000,
    "compactionThreshold": 0.83
  }
}
```

## Hooks 配置

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "name": "lint-check",
        "type": "PreToolUse",
        "command": "npm run lint"
      }
    ]
  }
}
```
