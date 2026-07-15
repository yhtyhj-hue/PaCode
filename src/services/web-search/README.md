# WebSearch service

`WebSearch` 是一个对接 Brave Search API 的只读工具。它通过 Node.js 内置 `fetch` 发起请求，不引入新的 npm 依赖。

## 配置

设置 `BRAVE_API_KEY` 后执行真实搜索。未设置 key 时不会发起网络请求，而是返回包含 `[MOCK]` 标记的本地结果，方便开发和测试。

每个请求有 10 秒超时。Brave 返回的标题、摘要会经过 prompt injection 过滤和 HTML 转义，摘要最多 500 个字符。只接受 `http:` 和 `https:` 结果 URL。

## 错误分类

工具错误会标记为以下类别之一：

- `network`：连接失败或超时
- `http_status`：非 2xx HTTP 状态（429 除外）
- `rate_limit`：Brave 返回 429
- `parse`：输入无效或响应 JSON 结构无效

## 集成

在 `src/tools/bootstrap.ts` 中添加：

```ts
import { registerWebSearchTool } from '../services/web-search/index.js';

registerWebSearchTool(registry);
```

服务目录刻意位于 `src/services/web-search/`，这样会被项目的 `tsconfig.json` 编译。
