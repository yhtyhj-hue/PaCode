# PaCode 架构设计

## 设计哲学

> "Only 1.6% of Claude Code's codebase is AI decision logic. The other 98.4% is deterministic infrastructure"

真正的工程复杂度在于：
- 权限系统与安全检查
- 上下文管理与压缩
- 工具路由与执行
- 会话持久化与恢复

## 分层架构

```
┌─────────────────────────────────────────┐
│              User Interface              │
│           CLI / REPL / API              │
├─────────────────────────────────────────┤
│            Query Engine                  │
│      AsyncGenerator Loop                │
├──────────┬──────────┬─────────────────┤
│ Context  │  Tools   │   Permission    │
│ Assembler│ Registry │   System       │
├──────────┴──────────┴─────────────────┤
│  Compaction│ Session│  Memory Store  │
│  Pipeline │ Manager │                │
├──────────┬──────────┬─────────────────┤
│ Skills   │ Plugins │  MCP Client    │
└──────────┴──────────┴─────────────────┘
```

## 9 步查询管道

1. **Input Processing** - 解析输入
2. **Context Loading** - 加载9个上下文源
3. **Compaction** - 5层压缩管道
4. **Model Call** - 流式API调用
5. **Tool Dispatch** - 工具分发
6. **Permission Gate** - 7层权限检查
7. **Tool Execution** - 工具执行
8. **Result Processing** - 结果处理
9. **Loop Check** - 循环判断

## 5 层压缩管道

| 层 | 触发 | 压缩方式 |
|----|------|---------|
| Budget Reduction | >83% | 降低max_tokens |
| Snip | >88% | 裁剪超长输出 |
| Microcompact | >93% | 工具结果摘要 |
| Context Collapse | >96% | 非破坏性压缩 |
| Auto-compact | >99% | 模型生成摘要 |

## 7 级权限模式

```
plan → default → acceptEdits → auto → dontAsk → bypass → bubble
```

## 扩展机制

按上下文成本递增：
1. **Hooks** (zero cost)
2. **Skills** (low cost)
3. **Plugins** (medium cost)
4. **MCP** (high cost)
