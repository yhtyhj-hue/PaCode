# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **SessionStart**: When session begins
- **SessionStop**: When session ends
- **Notification**: Async notifications
- **SubagentStop**: When subagent finishes

## Hook Configuration

Hooks are configured in `.paude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "name": "format-check",
        "command": "npm run lint",
        "matcher": { "tool": "Bash" }
      }
    ],
    "PostToolUse": [
      {
        "name": "auto-test",
        "command": "npm test",
        "matcher": { "tool": "Edit" }
      }
    ]
  }
}
```

## Hook Execution

- Hooks run with full user permissions
- Exit code 2 blocks the operation
- Hooks do NOT run in permission-bypass mode during initialization (security consideration)

## Best Practices

- Keep hooks fast (<2s)
- Use for validation, not complex logic
- Return exit code 2 to block dangerous operations
