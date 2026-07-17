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

## M5 工程评测

```
evals/fixtures/m5/{fix-bug,add-test,small-refactor}/
  TASK.md          # agent 提示
  broken/          # 起点
  golden/          # 参考解（gate 自检）
  verify.mjs       # 确定性评分
```

- Gate：`evals/gate/m5-engineering-tasks.eval.ts` — broken 失败 / golden 通过
- Periodic：`evals/periodic/m5-once-success.eval.ts` — live 写入 `BASELINE.json`；offline/sim 写 `BASELINE.offline.json` / `BASELINE.simulated.json`
- Gate：`evals/gate/m5-hard-engineering-tasks.eval.ts` — 多文件 / 失败再修 / 跨模块
- Periodic：`evals/periodic/m5-hard-once-success.eval.ts` + `m5-hard-cc-compare.eval.ts`
- Periodic：`evals/periodic/m5-cc-compare.eval.ts` — PaCode live vs `claude -p` 同 fixture，写入 `COMPARE.json`
- 联合冒烟：`test/smoke-joint-paths.test.ts`

## CI lanes

- `npm test` — unit + `evals/gate`（排除 `evals/periodic/**`，避免 live API 拉长/挂起）
- `npm run eval:gate` — 仅确定性门禁
- `npm run eval:periodic` / `npm run test:all` — 含 live（需 env 或 cc-switch 凭证；M5 vs CC 还需 `claude` CLI）

Live M5 使用 `resolveM5LiveCredentials()`（env **或** cc-switch）。有 cc-switch 时 `skipIf(!hasLiveCreds)` **不会**跳过。

