# AskUserQuestion Service

Interactive REPL question tool. Mirrors Claude Code's `AskUserQuestion` tool:

- Presents a question + 2-4 numbered options to the user in the terminal
- Reads selection via injected `readLine` callback (or Node `readline`)
- Returns a single id (single-select) or id array (multi-select)
- Honors an optional `default_id`, aborts on Ctrl+C, times out after 5 minutes

## Public API

```ts
import {
  registerAskUserTool,
  askUser,
  parseAnswer,
  renderPrompt,
  AskUserValidationError,
} from 'src/services/ask-user/index.js';
```

### `registerAskUserTool(registry: ToolRegistry): void`

Registers an `AskUser` tool definition on the given registry. The tool:

- `name`: `"AskUser"`
- `concurrencySafe`: `false`
- `permissionMode`: `PermissionMode.ACCEPT_EDITS`

### `askUser(input, config)`

`input`: `{ question, header?, options[], multiSelect?, default_id? }`

`config`: `{ readLine, isTTY?, timeoutMs?, maxParseRetries?, write? }`

Returns `Promise<AskUserAnswer>` where:

- `selection`: `string` or `string[]`
- `rawInput`: raw terminal input
- `aborted`: true on cancel / timeout-exceeded
- `notes`: optional diagnostic string

## Parsing rules

| Input | Single-select | Multi-select |
|-------|--------------|--------------|
| `"1"`, `"2"` | option at index (1-based) | option at index |
| `"yes"`, `"y"` | first label/description substring match (case-insensitive) | all matches |
| `"1, 3"` | error (single-select only takes one) | both options |
| `"1 3"` | error | both options |
| `""` with `default_id` | use default | use default |
| `""` without `default_id` | retry up to `maxParseRetries`, then abort | retry |

## Errors

| Class | When |
|-------|------|
| `AskUserValidationError` | bad input shape (empty question, <2 or >4 options, duplicate ids, default_id not in options) |
| `AskUserNonTTYError` | no `readLine` provided AND `process.stdin.isTTY === false` |
| `AskUserTimeoutError` | reader did not produce input within `timeoutMs` (default 5 min) |
| `AskUserAbortedError` | reader rejected with abort signal (e.g. SIGINT) |

## Design notes

- `src/cli/repl.ts` owns its own `readline` interface for the main prompt. `AskUser` uses a *separate* readline instance bound to `process.stdin` / `process.stderr` for the duration of one question; this avoids fights with the REPL line editor.
- All output goes to `process.stderr` by default (override via `config.write`) so we don't interleave with the line editor's stdout prompt.
- `parse.ts` matches id > label > description (case-insensitive substring) before falling back to a hint. Order matters: an exact id always wins over a label collision.
