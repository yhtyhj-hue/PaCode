# PaCode 工具开发指南

## 创建自定义工具

```typescript
import { ToolDefinition, ToolContext, ToolResult, PermissionMode } from '../pkg/types.js';

export function registerMyTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'MyTool',
    description: '工具描述 - AI 会根据描述决定何时使用',
    inputSchema: {
      type: 'object',
      properties: {
        param1: { type: 'string' },
        param2: { type: 'number' }
      },
      required: ['param1']
    },
    concurrencySafe: true,  // 是否可并行执行
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx) {
      // 实现逻辑
      return { content: [{ type: 'text', text: 'result' }] };
    },
  });
}
```

## 工具属性

| 属性 | 说明 | 示例 |
|------|------|------|
| `name` | 工具名 | `'Bash'` |
| `description` | AI 理解用途 | `'执行shell命令'` |
| `inputSchema` | 参数JSON Schema | 见下方 |
| `concurrencySafe` | 可并行 | `true/false` |
| `permissionMode` | 所需权限 | 见权限模式 |

## inputSchema 示例

```typescript
inputSchema: {
  type: 'object',
  properties: {
    path: { type: 'string', description: '文件路径' },
    content: { type: 'string' },
    options: {
      type: 'object',
      properties: {
        recursive: { type: 'boolean', default: false }
      }
    }
  },
  required: ['path']
}
```

## 完整示例

```typescript
export function registerGrepTool(registry) {
  registry.register({
    name: 'Grep',
    description: 'Search for pattern in files',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' }
      },
      required: ['pattern']
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { pattern, path = '.' } = input;
      const result = await execAsync(`rg "${pattern}" ${path}`);
      return { content: [{ type: 'text', text: result.stdout }] };
    },
  });
}
```

## 工具执行上下文

```typescript
interface ToolContext {
  workingDirectory: string;  // 当前工作目录
  sessionState: SessionState;  // 会话状态
  hooks: HookRegistry;     // Hook系统
}
```

## 注册到全局注册表

```typescript
// 在工具文件导出
export { registerMyTool } from './mytool.js';

// CLI 入口统一注册
import { registerMyTool } from './tools/mytool.js';
registerMyTool(toolRegistry);
```
