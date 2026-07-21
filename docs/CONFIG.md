# PaCode 配置指南

默认走 **MiniMax-M3**（Anthropic 兼容网关）。不读取 Claude Code 的 `~/.claude/settings.json`。

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
  },
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `ANTHROPIC_API_KEY` / `PACODE_API_KEY` | MiniMax API Key | - |
| `ANTHROPIC_BASE_URL` / `PACODE_BASE_URL` | Anthropic 兼容端点 | `https://api.minimaxi.com/anthropic` |
| `CLAUDE_MODEL` / `PACODE_MODEL` | 默认模型 | `MiniMax-M3` |
| `CLAUDE_MAX_TOKENS` | 最大输出 tokens | `8192` |

国际站端点：`https://api.minimax.io/anthropic`

## Hooks 配置

在配置文件的 `hooks` 部分：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "name": "lint-check",
        "type": "PreToolUse",
        "command": "npm run lint"
      }
    ],
    "PostToolUse": [
      {
        "name": "auto-format",
        "type": "PostToolUse",
        "command": "prettier --write"
      }
    ]
  }
}
```
