# services/web-fetch

A safe, dependency-free WebFetch tool for PaCode. Mirrors Claude Code's `WebFetchTool`: fetches a URL, extracts plain text from HTML (preserving links as markdown), and strips prompt-injection carriers before returning the result to the agent.

## Public API

```ts
import { registerWebFetchTool } from '../../services/web-fetch/index.js';

const registry = new ToolRegistry();
registerWebFetchTool(registry);
// registry.get('WebFetch') is now available.
```

Re-exported:

- `webFetch(url, options?) -> Promise<WebFetchOutput>` — pure entry point, useful outside the tool layer.
- `htmlToText(html) -> string` — vanilla HTML-to-text converter (anchors → `[label](url)`).
- `sanitizePromptInjection(text) -> { text, warnings }` — strips HTML comments, CSS-hidden blocks, base64 blobs, and known override patterns.
- `WebFetchException` — thrown for transport-level errors.
- `WebFetchInput`, `WebFetchOptions`, `WebFetchOutput`, `WebFetchError`, `WebFetchErrorKind`, `SanitizationWarning` — types.

## Tool contract

| Field             | Value                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | `WebFetch`                                                                                                                                          |
| `permissionMode`  | `PermissionMode.DEFAULT`                                                                                                                           |
| `concurrencySafe` | `true`                                                                                                                                              |
| Input schema      | `{ url: string (required), prompt?: string }`                                                                                                       |
| Output            | Text block with `URL`, `Status`, `Content-Type`, `Bytes`, optional `Sanitized` flag, the extracted body, and a sanitization-warnings footer. |

## Security boundaries

1. **URL allowlist.** Only `http:` and `https:` are accepted. `file:`, `javascript:`, `data:`, `vbscript:`, etc. are rejected with `invalid_url` before any network call.
2. **Prompt-injection defense.** Every fetch result is passed through `sanitizePromptInjection`, which removes:
   - HTML comments (`<!-- ... -->`)
   - Inline `<style>` blocks and `<head>` (no CSS in the body text)
   - Elements with `style="display:none"`, `visibility:hidden`, `opacity:0`, `font-size:0`, `color:transparent`
   - Long base64 blobs (>= 120 chars) → masked to `[base64:N chars]`
   - Common "ignore previous instructions", "you are now", "<system>" override patterns
3. **Size cap.** Default 5 MiB per response. Streams are read incrementally; once the cap is exceeded the request is cancelled and an `oversized` error is raised.
4. **Timeout.** Default 10 s. Implemented via `AbortController` so both the URL fetch and any redirect chain share the same deadline.
5. **Redirect loop guard.** Manual redirect handling caps at 3 hops by default; excess returns `redirect_loop`.
6. **HTTP status errors.** 4xx / 5xx responses return `http_status` with the status code attached. The tool layer surfaces them as `isError: true` text.

## Behavior summary

```
GET URL
  -> validate URL (allowlist)
  -> set timeout / size cap / redirect cap
  -> fetch with manual redirect handling
  -> stream-read body (cancel on size overflow)
  -> sanitizePromptInjection(rawBody)
  -> htmlToText if Content-Type is HTML, else pass through
  -> return WebFetchOutput { url, finalUrl, status, contentType, text, bytes, warnings, sanitized }
```

## Test coverage

`test/services/web-fetch.test.ts` — HTML extraction, links, injection, errors, tool registration.

```
npx vitest run test/services/web-fetch.test.ts
```

## Known limitations

- **No JS rendering.** Pages that rely on JavaScript to render content will return whatever the server sent in the initial HTML. This matches Claude Code's WebFetchTool.
- **No character-encoding negotiation.** Body is decoded as UTF-8. Pages in legacy encodings may show as mojibake.
- **Single connection per request.** Manual redirect handling does not preserve cookies across hops.
- **No robots.txt / rate-limit awareness.** The tool treats the URL as untrusted input; the caller is responsible for any domain-specific etiquette.
- **Inline `style` attribute detection is heuristic.** Common CSS-hiding properties are caught; determined attackers can still smuggle via exotic CSS.
- **Override-pattern regex list is fixed.** New adversarial patterns are not detected until the list is updated.

## Differences vs. Claude Code's WebFetchTool

- Claude Code uses a fuller HTML→markdown converter; PaCode converts HTML→text and **preserves `<a href>` as `[label](url)`**. Other structures stay plain-text biased.
- We always sanitize the body. Claude Code relies on the model to ignore embedded instructions; we strip known carriers and surface warnings in a footer.
- Redirect handling is identical (manual, capped), but we report `redirect_loop` as a first-class error kind.
- No cookie jar across redirects; no robots.txt / rate-limit awareness (caller responsibility).

## Integration

Registered from `src/tools/bootstrap.ts` via `registerWebFetchTool` (already wired).
