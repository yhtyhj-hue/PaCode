# MCP SSE 与 Streamable HTTP transport

本目录提供 PaCode 对远程 MCP server 的两种客户端 transport 封装。

## 公共 API

```ts
import {
  createSseTransport,
  createHttpTransport,
  McpHttpTool,
  McpSseTool,
  registerMcpRemoteTools,
} from './src/services/mcp-sse-http/index.js';
```

`createSseTransport(url, options)` 使用 `@modelcontextprotocol/sdk/client/sse.js` 的 `SSEClientTransport`。`createHttpTransport(url, options)` 使用 `@modelcontextprotocol/sdk/client/streamableHttp.js` 的 `StreamableHTTPClientTransport`。两个工厂都会启动 transport，返回已启动但尚未完成 MCP initialize 的 transport。需要完整协议连接时，使用 SDK `Client.connect(transport)`。

```ts
const transport = await createHttpTransport('https://example.test/mcp', {
  headers: { authorization: 'Bearer token' },
  timeoutMs: 30_000,
  maxAttempts: 3,
});

const client = new Client({ name: 'pacode', version: '0.1.0' });
try {
  await client.connect(transport);
  await client.ping({ timeout: 30_000 });
} finally {
  await client.close();
}
```

## 重试与超时

- 默认 timeout 为 30 秒，由包装后的 `fetch` 对每次请求注入 `AbortSignal`。
- 默认 maxAttempts 为 3，包含第一次请求。
- 默认退避 base 500ms、cap 8s、±20% jitter。
- 408、429、5xx 和网络异常重试。其他 4xx 不重试。
- `AbortSignal` 会停止当前请求和后续退避，并抛出 `RetryAbortError`。
- Streamable HTTP SDK 自身的 SSE 重连也被配置为相同的 500ms、8s、最多两次重连区间。SDK 服务端 `retry` 值仍可能覆盖退避时间。

## 工具注册

`McpSseTool` 与 `McpHttpTool` 满足 PaCode `ToolDefinition`：默认权限 `PermissionMode.DEFAULT`，`concurrencySafe: true`。工具输入为：

```json
{
  "url": "https://example.test/mcp",
  "headers": { "authorization": "Bearer token" },
  "options": { "timeoutMs": 30000, "maxAttempts": 3 }
}
```

执行时会创建 transport，使用 SDK `Client.connect` 完成 initialize，调用 `client.ping()` 验证连接，最后关闭 client/transport。返回内容包含 `type: "PingResult"`、transport 类型、URL、session ID 和 SDK ping 结果。

## 与 `src/mcp/client.ts` 的边界

`src/mcp/client.ts` 仍是旧的连接状态登记器，不在本阶段修改。它维护 PaCode 的 `MCPServerConnection` 展示状态，但不拥有 SDK `Client`、transport 生命周期，也不负责远程 MCP 工具调用。本目录只提供可复用的 transport 工厂和 ToolRegistry 注册工具。后续集成层应在成功 `Client.connect` 后把远端工具适配为 PaCode `ToolDefinition`，并显式管理 client 与 transport 的关闭。

## 集成 import

```ts
import { getToolRegistry } from '../../tools/registry.js';
import { registerMcpRemoteTools } from '../../services/mcp-sse-http/index.js';

const registry = getToolRegistry();
registerMcpRemoteTools(registry);
```

源代码刻意不修改 `src/mcp/client.ts`、`src/tools/registry.ts`、`src/tools/bootstrap.ts`、`tsconfig.json` 或 `package.json`。

## 已知限制

- SSE transport 依赖 SDK 的 `eventsource` 实现，SDK 将 SSE transport 标记为 deprecated；能控制服务端时应优先使用 Streamable HTTP。
- 工厂返回的 transport 已调用 `start()`，但 MCP initialize 必须由上层 `Client.connect()` 完成。
- 工具当前只验证 ping，不会把远端 `tools/list` 结果自动注册成本地工具。远端工具适配属于下一层集成职责。
- 本目录假设运行环境提供 `fetch`、`AbortController`、`Headers` 和 Web Streams，这与 Node 18+ 运行时要求一致。
