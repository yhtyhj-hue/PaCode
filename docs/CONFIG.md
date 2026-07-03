# PaCode 配置指南

## 配置文件位置

按优先级查找（前者优先）：
1. `.paude/config.json` 或 `.paude/config.yaml`
2. `.pauderc.json`
3. `paude.config.json`

## 配置示例

```json
{
  "version": "1.0.0",
  "model": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-0",
    "maxTokens": 8192,
    "temperature": 0.7
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

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API密钥 |
| `CLAUDE_MODEL` | 默认模型 |
| `CLAUDE_MAX_TOKENS` | 最大输出tokens |

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
