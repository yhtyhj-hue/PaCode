# PaCode 实施路线图

> 基于 ARCHITECTURE.md 与当前代码审计，按依赖顺序逐项完成。
> 每项 = 1 个会话，带测试，完成后标记 ✅。

## 当前基线

| 指标 | 状态 |
|------|------|
| 核心 Agent 循环 | ✅ |
| 8 核心工具 + 并行调度 | ✅ |
| 9 上下文源 + 压缩 L1–5 | ✅ |
| 权限 7 模式 + AUTO 分类器 + tool-gate | ✅ |
| MCP stdio + Plugins/Skills/Hooks | ✅ |
| 测试 | 397 通过（1 periodic skip），覆盖率 ≥80% |
| Eval harness | ✅ gate + periodic |

---

## Phase A — 配置与基础设施

| # | 任务 | 关键文件 | 状态 |
|---|------|---------|------|
| A1 | **统一配置引导**：合并 `loadConfig` + `SettingsManager` + cc-switch + CLI flags | `src/pkg/app-config.ts` | ✅ |
| A2 | **MCP CLI 去重**：`pacode mcp` 复用 `src/mcp/config.ts` | `src/cli/index.ts` | ✅ |
| A3 | **Compaction 配置化**：threshold / maxTokens 从 config 读取 | `src/context/compaction.ts` | ✅ |

## Phase B — 上下文与 Agent 核心

| # | 任务 | 关键文件 | 状态 |
|---|------|---------|------|
| B1 | **压缩 L4–5 真实现**：contextCollapse 消息投影 + autoCompact LLM 摘要 | `src/context/compaction.ts` | ✅ |
| B2 | **Engine 集成测试**：mock stream 覆盖 `query()` 全循环 | `test/engine-query.test.ts` | ✅ |
| B3 | **Subagent 测试 + SubagentStop hook** | `src/agent/subagent.ts` | ✅ |

## Phase C — CLI / REPL 体验

| # | 任务 | 关键文件 | 状态 |
|---|------|---------|------|
| C1 | **Plan 模式接线**：`/plan` 解析并存入 PlanModeManager | `src/cli/repl.ts` | ✅ |
| C2 | **CLI 命令测试**：mcp / init / resume / 参数解析 | `test/cli-handlers.test.ts` | ✅ |
| C3 | **REPL slash 命令测试**：/compact / /mode / plugin commands | `test/repl-handlers.test.ts` | ✅ |

## Phase D — 扩展机制

| # | 任务 | 关键文件 | 状态 |
|---|------|---------|------|
| D1 | **Plugin 工具注册**：`plugin.tools` → ToolRegistry | `src/plugins/tool-loader.ts` | ✅ |
| D2 | **Skills 结构化接入**：assembler 使用 SkillsLoader 元数据 | `src/context/assembler.ts` | ✅ |
| D3 | **Worktree CLI**：`pacode worktree list/create/remove` | `src/cli/worktree.ts` | ✅ |

## Phase E — 安全与存储

| # | 任务 | 关键文件 | 状态 |
|---|------|---------|------|
| E1 | **Bash 输出截断 + 更严格解析** | `src/tools/bash-secure.ts` | ✅ |
| E2 | **项目级 Memory**：`.paude/projects/{hash}/` | `src/memory/store.ts` | ✅ |
| E3 | **Tool permissionMode 门禁** | `src/permission/tool-gate.ts` | ✅ |

## Phase F — 质量与文档

| # | 任务 | 关键文件 | 状态 |
|---|------|---------|------|
| F1 | **覆盖率 → 80%**：补 CLI/agent/plugins 空洞 | `test/` | ✅ |
| F2 | **README + ARCHITECTURE 状态同步** | `README.md`, `ARCHITECTURE.md` | ✅ |
| F3 | **Eval harness 骨架**（gate + periodic 分离） | `evals/` | ✅ |

---

## Phase G — Claude Code 行为对齐（进行中）

| # | 任务 | 关键文件 | 状态 |
|---|------|---------|------|
| G1 | **预取不禁工具**：DAG 注入后保留 tool loop（去 suppressTools） | `src/agent/engine.ts` | ✅ |
| G2 | **Shift+Tab 切模式** + 去掉假 /vim /effort 宣传 | `cycle-mode.ts`, `repl-line-editor.ts` | ✅ |
| G3 | **Edit 唯一匹配 + replaceAll** | `src/tools/edit.ts` | ✅ |
| G4 | **图片粘贴 / 多模态输入** | REPL + ContentBlock | 🔜 |
| G5 | **MCP HTTP/SSE** | `src/mcp/client.ts` | 🔜 |
| G6 | **ML AUTO 分类器**（本地 Claude Code 路由） | `classifier.ts` | 🔜 |
| G7 | **预取走权限批确认** | `prefetch-gate.ts` | ✅ |
| G8 | **/permissions 真规则 + /cost 按模型计价** | `format-display.ts`, `cost-estimate.ts` | ✅ |

---

## 执行顺序

```
A1 → … → F3 → G1 → G2 → G3 → G7 → G8 → G4 → G5 → G6
```

## 不在本轮范围

- Ink/React TUI（依赖已装但未用，defer）
- Go agent core / SQLite（架构文档远期项）
- ML 权限分类器（需本地 Claude Code 路由，defer → G6）
- 容器级 Bash 沙箱

---

## 变更日志

| 日期 | 完成项 |
|------|--------|
| 2026-07-15 | G7–G8：预取批确认、/permissions 真规则、/cost 按模型计价 |
| 2026-07-14 | 去掉虚假执行：真实 boot 自检、MCP this 绑定、prefetch worker 文案、/plan prepared、菜单去 vim/effort |
| 2026-07-14 | Phase G1–G3：预取保留工具、Shift+Tab、Edit uniqueness |
| 2026-07-06 | Week 1–4: Agent/MCP/Hooks/Context/Parallel/Streaming/Permissions AUTO/Plugins |
| 2026-07-06 | Week 5: EnhancedRenderer/StreamingMarkdown/Plugin agents |
| 2026-07-06 | Phase A–E 全部完成；F1 覆盖率 80.3%（300 tests） |
| 2026-07-06 | 深度质检修复：非TTY deny、Bash default-deny、路径边界、max_tokens cap、cc-switch remove |
