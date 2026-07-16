# PaCode 实施路线图

> 历史 Phase A–G：基础设施与 CC 行为对齐（多数已完成）。
> **现行主线：Phase H–K「超越 Claude Code」**——不以工具数量为 KPI，以可度量任务质量与 harness 完备度取胜。

---

## 战略原则（非谈判）

1. **Harness > 工具堆**：对标图二（Session / Turn / Agentic Loop），不是对标「40 工具 / 101 slash」。
2. **四模式可叠用**：Tool Use 做实 → Planning → Reflection（绑测试/lint）→ Multi-agent（最后）。
3. **KPI 不用数量**：用完成率、假完成率、确认次数、深读保真、可恢复性。
4. **每项同提交**：代码 + gate test（+ 相关 eval），禁止「之后再补」。

### 超越指标（必须可测）

| ID | 指标 | 目标 |
|----|------|------|
| M1 | 假完成率（声称检查/已测但无 tool 证据） | → 0（gate） |
| M2 | DEFAULT 完成一次「项目质检」人工确认次数 | ≤ 1（Bash 批） |
| M3 | 「逐行/完整读」触发真 Read 全文件（非浅预取摘要） | ≥ 90% 会话 |
| M4 | 权限确认不卡死输入框 / Ctrl+C 可取消 | 100% |
| M5 | 工程评测套件（改 bug / 加测 / 小重构）一次成功率 | 持续提升并记录基线 |

---

## 当前基线（截至 2026-07-16）

| 能力 | 状态 |
|------|------|
| Query while-loop + 流式 + 并行 concurrencySafe | ✅ |
| 7 权限模式 + deny-first + DEFAULT 只读免确认 + 单键确认 | ✅ |
| L1 预取（prefetch workers，非假 Subagent）+ 预取后仍可 tool | ✅ |
| Edit 唯一匹配 / replaceAll | ✅ |
| 5 层 compact 管道形态 | ✅ 仍可加深 |
| MCP stdio | ✅；HTTP/SSE 🔜 |
| Subagent / Worktree CLI | ⚠️ 浅 |
| Ink TUI / Voice / Team / LSP | ❌ defer 或靠后 |

---

## Phase H — 超越地基（现行 P0，约 2–3 周）

> 目标：橙色 Agentic Loop 在「可用性」上压过 CC 的毛刺；**禁止**在本阶段堆 Task×6 / Voice / 101 slash。

| # | 任务 | 验收标准 | 状态 |
|---|------|----------|------|
| H1 | **预取可选加速**：配置 `prefetch.enabled` / intent 白名单 / `PACODE_PREFETCH=0` | 关预取时：质检纯 tool loop；开预取时：只加速且可继续 Read | ✅ |
| H2 | **权限会话记忆**：批准写入 `sessionApprovals`（`Bash:npm` 指纹）；`/clear` 重置 | 同 session 不再对同类 Bash 连环确认；deny 仍最终 | ✅ |
| H3 | **Agentic Loop 钩子补全**：PermissionRequest、PostToolUseFailure、Stop 接线真实行为 | hooks 事件可在配置中生效并有测试；失败路径有用户可见结果 | ✅（PostToolUseFailure + Stop；PermissionRequest deferred — REPL 走 confirm-prompt 而非 hook 触发） |
| H4 | **工具保真**：Grep 常用旗标；Read 大文件/分页体验；Bash 超时与截断产品化文案 | 对应 unit + 至少 1 条集成 | ✅（Grep: -i/--glob/--exclude/-A/-B/-C/output_mode；Read: offset+limit, 大文件拒绝 + 提示；Bash: truncate 提示加 PaCode 操作建议） |
| H5 | **MCP HTTP 或 SSE（至少一种）** | 真实 server 可连、tool execute 不丢 `this`；类型不再谎称已支持 | ✅（client.ts createTransport switch on type: stdio/sse/http 全部接线；MCPServerConfig 加 headers 字段；transport 字段类型 union AnyTransport） |
| H6 | **AskUserQuestion 真接线**（services/ask-user 已有 → 注册为工具 + REPL） | 模型可提问；TTY 确认不与 line editor 冲突 | ⚠️ 部分（tool 已注册 + 30 测试；REPL 未在 tool dispatch 处拦截/转发 stdin — 模型调 AskUser 会与 ReplLineEditor 抢 raw mode。短期方案：工具标注 ACCEPT_EDITS 但 REPL 不 pause line editor；长期：REPL 在 tool dispatch 时显式 pause+delegate stdin） |
| H7 | **Eval 门禁升级**：质检 / 继续 / 深读 / 确认 UX 场景进 gate | CI 失败则禁止合并；跟踪 M1–M4 | 🔜 |
| H8 | **主循环失败可恢复**：中断、权限拒绝后可续跑同一任务 | 无卡死确认框；会话可 resume | ⚠️ 部分（确认 UX ✅） |

**Phase H 明确不做：** LSP、Notebook、Cron、Voice、Buddy、Team、刷 slash 到 80+、Ink TUI。

---

## Phase I — 差异化硬核（约 3–4 周，真正「超过」候选）

| # | 任务 | 差异化点 | 状态 |
|---|------|----------|------|
| I1 | **可审计 auto-memory**：对话事实写入 `.paude/memory/`，可 diff / 回滚 | 比黑盒记忆更可检查 | 🔜 |
| I2 | **/rewind + 工作区 checkpoint**（按 tool 批次，慎重） | 强恢复；需快照权限与测试 | 🔜 |
| I3 | **Reflection 绑证据**：改码后强制/可选跑测或 lint，失败则继续 loop | 有信号的反思，不是空复读 | 🔜 |
| I4 | **Planning 闭环**：EnterPlanMode / ExitPlanMode 工具 + `/plan` 真正执行步骤（非只 prepared） | 规划→执行可追踪 | 🔜 |
| I5 | **Output styles + Compact 策略**（auto / forced / manual + 焦点） | 体感与可控性 | 🔜 |
| I6 | **真 Subagent + worktree 隔离**（替换「prefetch = agents」认知） | 多代理有边界，无戏服 | 🔜 |

---

## Phase J — 多 Agent / 协作（约 4–5 周，**依赖 H+I6**）

| # | 任务 | 状态 |
|---|------|------|
| J1 | Task 结果可见性 + TaskGet/List/Stop（先 3 个，再视需要扩到 6） | 🔜 |
| J2 | TeamCreate / SendMessage（最小可用） | 🔜 |
| J3 | Coordinator 模式（有限角色，强契约） | 🔜 |
| J4 | Voice / Buddy | ❌ 默认不做，除非单独产品决策 |

---

## Phase K — 生态与表面（随时按频率插入，不挡 H/I）

| # | 任务 | 状态 |
|---|------|------|
| K1 | SkillTool / ToolSearch（延迟加载技能目录） | 🔜 |
| K2 | ConfigTool（薄封装现有 settings） | 🔜 |
| K3 | Brief → **Skill 或 slash**，不占核心工具编制 | 🔜 |
| K4 | NotebookEdit / ScheduleCron / LSP | 🔜 P2 |
| K5 | MCP 其余 transport；Bridge 远程会话 | 🔜 |
| K6 | 高频 slash 补齐（按使用统计，不对齐 101） | 🔜 |
| K7 | Ink TUI | defer |

Windows PowerShellTool：非 macOS 主线，defer。

---

## 与旧「数量对齐方案」对照

| 旧提案 | 本路线图处置 |
|--------|----------------|
| 阶段 0：Task×6 + Config + SkillSearch + Brief 全 P0 | **拆散**：进 J1 / K1–K3；Brief 改 Skill |
| 阶段 0 合计 14→25 工具 | **取消数量 KPI** |
| 阶段 1 先 Ink + auto-memory | auto-memory → I1；Ink → K7 defer |
| 阶段 2 立刻 Coordinator / Voice | Coordinator → J（依赖真 Subagent）；Voice 默认不做 |
| 阶段 3 补 80+ slash | → K6 按频率 |
| LSP/Notebook/Cron 塞紧急档 | → K4 P2 |

---

## 执行顺序

```
[已完成] A → F → G1–G3,G7–G8
    ↓
H1 → H2 → H3 → H4 → H5 → H6 → H7（H8 并行打磨）
    ↓
I1 → I3 → I4 → I5 → I2 → I6
    ↓
J1 → J2 → J3
    ↓
K* 按需插入（永不阻塞 H）
```

遗留 G 项并入：G4 图片 → 建议紧接 H4/H6；G5 MCP → **H5**；G6 ML AUTO → I 之后或与 H2 并行（非 H 阻塞）。

---

## 历史 Phase（A–G 摘要）

- **A–F**：配置、上下文、CLI、插件、安全、覆盖率与 eval 骨架 — 全部 ✅  
- **G**：预取不禁工具、Shift+Tab、Edit uniqueness、假逻辑清理、批确认、单键确认、DEFAULT 只读免确认 — 大部 ✅；G4/G5/G6 见上并入 H/I  

细节任务表见 git 历史；本文件以 H–K 为现行合同。

---

## 不在默认范围

- 以「对齐 40 工具 / 101 commands」为成功标准  
- 未做完 H 就上 Team/Coordinator/Voice  
- 用 prefetch UI 伪装 Subagent  
- 无验收指标的「感觉超过 CC」

---

## 变更日志

| 日期 | 完成项 |
|------|--------|
| 2026-07-16 | 选项3：harness 测试验证 + H1 预取可关 + H2 会话权限记忆 |
| 2026-07-16 | 重写现行主线 Phase H–K（超越 CC）；否决数量优先排期 |
| 2026-07-16 | H3：PostToolUseFailure + Stop hook 接线（engine.executeTool 失败触发，REPL finally 触发 Stop） |
| 2026-07-16 | H4：Grep 旗标（-i/--glob/--exclude/-A/-B/-C/output_mode/max_results）+ Read offset/limit + Bash truncate 产品化文案 |
| 2026-07-16 | H5：MCP client.ts createTransport switch on type 接线 stdio/sse/http；MCPServerConfig.headers；transport 字段类型 union |
| 2026-07-15 | 单键确认 UX、DEFAULT 只读免确认、质检意图、未知 bash 弹窗非硬拒 |
| 2026-07-15 | G7–G8：预取批确认、/permissions、/cost 按模型计价 |
| 2026-07-14 | 假逻辑清理；G1–G3；boot 真自检；MCP this；prefetch 文案 |
| 2026-07-06 | Phase A–F 基线 |
