# PaCode Keyboard Shortcuts

Reference for Claude Code-style keyboard shortcuts in PaCode.

## General Controls

| Shortcut | Action | Status |
|----------|--------|--------|
| `Ctrl+C` | Cancel current operation | ✅ Implemented |
| `Ctrl+D` | Exit PaCode | ✅ Implemented |
| `Esc` | Interrupt current input | ✅ readline |
| `Enter` | Submit message | ✅ readline |

## Permission Modes

| Shortcut | Action | Status |
|----------|--------|--------|
| `Shift+Tab` | Cycle permission modes (default → accept edits → plan) | ✅ Implemented |

## Model Picker

| Shortcut | Action | Status |
|----------|--------|--------|
| `Cmd+P` / `Meta+P` | Open model picker | 🔜 Use `/model` |
| `Cmd+T` / `Meta+T` | Toggle thinking | 🔜 Not implemented (`/effort` stub) |

## Input

| Shortcut | Action | Status |
|----------|--------|--------|
| `Ctrl+J` | Insert newline | ✅ readline |
| `Ctrl+L` | Force redraw | ✅ readline |

## Status Bar (Bottom)

Shows:
- Current permission mode
- Token usage percentage
- Current model
- Available commands

```
⏵⏵ normal mode · shift+tab to cycle · esc to interrupt · ctrl+c cancel · ctrl+d exit
                            0% context used · /model MiniMax-M3 · /help
```

## Slash Commands

| Command | Action |
|---------|--------|
| `/help` | Show all commands |
| `/exit` / `/quit` | Exit REPL |
| `/clear` | Clear conversation |
| `/compact` | Compress context |
| `/mode` | Change permission mode |
| `/model` | Show/change model |
| `/status` | Session info |
| `/context` | Context usage |
| `/cost` | Token usage |
| `/memory` | Memory location |
| `/mcp` | MCP servers |
| `/init` | Initialize project |
| `/plan` | Generate plan |
| `/agents` | List subagents |
| `/providers` | List providers |
| `/review <file>` | Review code (custom) |
| `/explain <file>` | Explain code (custom) |
| `/test <file>` | Write tests (custom) |

## Configuration

To customize, edit `~/.claude/keybindings.json`:

```json
{
  "bindings": {
    "app:exit": "ctrl+d",
    "app:interrupt": "ctrl+c",
    "chat:cycleMode": "shift+tab"
  }
}
```
