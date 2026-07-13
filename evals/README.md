# PaCode Eval Harness

两类 eval，职责分离：

| 车道 | 目录 | 运行方式 | 特点 |
|------|------|----------|------|
| **Gate** | `evals/gate/` | `npm run eval:gate` | 确定性、本地、免费、< 2s |
| **Periodic** | `evals/periodic/` | `npm run eval:periodic` | 可选 LLM 调用，需 `ANTHROPIC_API_KEY` |

## 目录结构

```
evals/
├── lib/           # 共享类型与评分工具
├── gate/          # 确定性 eval（Vitest）
│   └── *.eval.ts
└── periodic/      # 质量 eval（Vitest，无 API key 时 skip）
    └── *.eval.ts
```

## 添加 Gate Eval

1. 在 `evals/gate/` 新建 `*.eval.ts`
2. 使用 `describe('eval:gate:…')` 命名，便于过滤
3. 只调用确定性 API（无 LLM、无网络）
4. 断言行为 + 边界条件

## 添加 Periodic Eval

1. 在 `evals/periodic/` 新建 `*.eval.ts`
2. 用 `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` 包裹
3. 定义 pass threshold（`score >= threshold`）
4. 发布前 / 夜间 CI 运行

## 与 Gate Tests 的区别

- **Gate tests**（`test/`）：单元/集成测试，验证实现正确性
- **Gate evals**（`evals/gate/`）：行为/回归 eval，验证用户可见质量指标
- **Periodic evals**：需要 LLM 的质量测量，允许非确定性但有阈值
