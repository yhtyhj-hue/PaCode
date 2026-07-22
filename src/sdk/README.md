# PaCode SDK

可编程 / headless 入口，对标 Claude Code 的 `claude -p` 与 SDK 宿主集成。

## CLI

```bash
pacode -p "Summarize package.json"
pacode --print "List open TODOs in src/"
echo "Explain this repo" | pacode -p   # stdin when no positional message
```

`-p` / `--print`：跳过 boot 动画与 REPL，流式打印助手文本；工具错误时 exit 1。

## Programmatic

```ts
import { runAgent } from '@sallon/pacode';

const { text, hadError } = await runAgent({
  message: 'Read README and summarize',
  mode: 'bypass',
  connectMcp: false,
  bootstrapPlugins: false,
});
console.log(text);
```

`package.json` exports: `"."` → `dist/sdk/index.js`.

## Notes

- 默认会加载 MCP / plugins；测试请设 `connectMcp: false`、`bootstrapPlugins: false`。
- 凭证：`ANTHROPIC_API_KEY` / cc-switch / `apiKey` 选项。
