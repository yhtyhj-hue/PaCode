# PaCode API 参考

## QueryEngine

```typescript
import { QueryEngine } from './agent/engine.js';
import { SessionManager } from './session/manager.js';
import { getToolRegistry } from './tools/registry.js';
import { registerBashTool } from './tools/bash.js';
import { registerReadTool } from './tools/read.js';

// 初始化
const engine = new QueryEngine({ apiKey: 'your-key' });
const sessionManager = new SessionManager();
const toolRegistry = getToolRegistry();

// 注册工具
registerBashTool(toolRegistry);
registerReadTool(toolRegistry);

// 创建会话
const session = sessionManager.createSession({ mode: PermissionMode.DEFAULT });

// 异步生成器流式处理
for await (const event of engine.query({ message: '分析代码' }, session)) {
  switch (event.type) {
    case 'content_block_delta':
      process.stdout.write(event.delta.text);
      break;
    case 'tool_use':
      console.log(`使用工具: ${event.tool.name}`);
      break;
    case 'tool_result':
      console.log(`结果: ${event.result.content}`);
      break;
  }
}
```

## SessionManager

```typescript
const manager = new SessionManager('/path/to/sessions');

// 创建会话
const session = manager.createSession({ mode: 'default' });

// 添加消息
manager.addMessage(session, { role: 'user', content: 'Hello', timestamp: Date.now() });

// 保存/恢复
manager.saveSession(session);
const restored = manager.loadSession('session-id');
```

## ToolRegistry

```typescript
const registry = new ToolRegistry();

// 注册工具
registry.register({
  name: 'MyTool',
  description: '我的工具',
  inputSchema: { type: 'object', properties: { input: { type: 'string' } }},
  concurrencySafe: true,
  permissionMode: 'default',
  async execute(input, context) {
    return { content: [{ type: 'text', text: 'result' }] };
  }
});

// 获取工具
const tool = registry.get('MyTool');
const list = registry.list();
```

## PermissionSystem

```typescript
const ps = new PermissionSystem();

const result = ps.check({
  tool: { id: '1', name: 'Bash', input: { command: 'ls' } },
  mode: 'default',
  context: session
});

if (!result.allowed) {
  console.log(`拒绝: ${result.reason}`);
}
```

## CompactionPipeline

```typescript
const pipeline = new CompactionPipeline();

const compressed = await pipeline.run({
  systemPrompt: '...',
  messages: [...],
  tools: [...],
  maxTokens: 200000,
  tokenCount: 180000  // 触发压缩
});
```

## ContextAssembler

```typescript
const assembler = new ContextAssembler();

const ctx = await assembler.assemble(session, {
  systemPrompt: 'You are helpful'
});
```

## HookRegistry

```typescript
const hooks = new HookRegistry();

hooks.register({
  name: 'lint',
  type: 'PostToolUse',
  command: 'npm run lint',
  matcher: { tool: 'Edit' }
});

hooks.execute(hook);
```

## MCPServer

```typescript
const mcp = new MCPClient();

await mcp.connect({
  name: 'github',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@anthropic/mcp-server-github']
});

const tools = mcp.getTools();
```
