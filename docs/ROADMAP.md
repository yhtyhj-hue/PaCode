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
| M5 | 工程评测套件（改 bug / 加测 / 小重构）一次成功率 | 基线 ≥ 0.5；easy live passRate=1；**m5-hard**（多文件/失败再修/跨模块）≥ 0.5；vs CC 见 COMPARE.json |

---

## 当前基线（截至 2026-07-17）

| 能力 | 状态 |
|------|------|
| Query while-loop + 流式 + 并行 concurrencySafe | ✅ |
| 7 权限模式 + deny-first + DEFAULT 只读免确认 + 单键确认 | ✅ |
| L1 预取（prefetch workers，非假 Subagent）+ 预取后仍可 tool | ✅ |
| Edit 唯一匹配 / replaceAll；DEFAULT 确认后可 Edit/Write | ✅ |
| 5 层 compact 管道形态 | ✅ L4 结构化折叠 + L5 5xx 重试 |
| MCP stdio + SSE + HTTP + WebSocket | ✅；Bridge 会话 deferred，`/bridge`=v1-partial 远程 MCP 清单 |
| Subagent / Worktree CLI | ✅ I6：Task→worktree 隔离 + 固定 report schema |
| Team / Coordinator / NotebookEdit / ScheduleCron / Diagnostics(+LSP alias) | ✅ |
| Bash `run_in_background` + BashOutput / BashStop | ✅ |
| Ink TUI | ✅ K7：`--tui`（AskUser + 高频 slash；`/rewind <id>` 经确认后真恢复） |
| Voice / Buddy | ❌ deferred 状态面（`/voice`，J4） |
| M5 工程评测 | ✅ easy 3/3 live；**m5-hard** gate+periodic；vs CC COMPARE；mutation nudge |
| G4 多模态图片（ContentBlock + `--image` + serializer） | ✅ |
| PermissionRequest hook | ✅（stdout approve / exit 2 deny） |

---

## Phase H — 超越地基（现行 P0，约 2–3 周）

> 目标：橙色 Agentic Loop 在「可用性」上压过 CC 的毛刺；**禁止**在本阶段堆 Task×6 / Voice / 101 slash。

| # | 任务 | 验收标准 | 状态 |
|---|------|----------|------|
| H1 | **预取可选加速**：配置 `prefetch.enabled` / intent 白名单 / `PACODE_PREFETCH=0` | 关预取时：质检纯 tool loop；开预取时：只加速且可继续 Read | ✅ |
| H2 | **权限会话记忆**：批准写入 `sessionApprovals`（`Bash:npm` 指纹）；`/clear` 重置 | 同 session 不再对同类 Bash 连环确认；deny 仍最终 | ✅ |
| H3 | **Agentic Loop 钩子补全**：PermissionRequest、PostToolUseFailure、Stop 接线真实行为 | hooks 事件可在配置中生效并有测试；失败路径有用户可见结果 | ✅（PostToolUseFailure + Stop + PermissionRequest：stdout approve / exit 2 deny；REPL confirm 仍为默认 UI） |
| H4 | **工具保真**：Grep 常用旗标；Read 大文件/分页体验；Bash 超时与截断产品化文案 | 对应 unit + 至少 1 条集成 | ✅（Grep: -i/--glob/--exclude/-A/-B/-C/output_mode；Read: offset+limit, 大文件拒绝 + 提示；Bash: truncate 提示加 PaCode 操作建议） |
| H5 | **MCP HTTP 或 SSE（至少一种）** | 真实 server 可连、tool execute 不丢 `this`；类型不再谎称已支持 | ✅（client.ts createTransport switch on type: stdio/sse/http 全部接线；MCPServerConfig 加 headers 字段；transport 字段类型 union AnyTransport） |
| H6 | **AskUserQuestion 真接线**（services/ask-user 已有 → 注册为工具 + REPL） | 模型可提问；TTY 确认不与 line editor 冲突 | ✅（DEFAULT 权限；REPL pause 后注入 cooked `readLine`；工具优先 `ctx.readLine`） |
| H7 | **Eval 门禁升级**：质检 / 继续 / 深读 / 确认 UX 场景进 gate | CI 失败则禁止合并；跟踪 M1–M4 | ✅（evals/gate/m1-m4.eval.ts 4 个 gate eval 覆盖 M1 假完成率/M2 单次批 confirm/M3 深读触发/M4 Ctrl+C 取消；M3 同步加 完整读/逐行读/全读 正则；npm run test 跑 705 通过即可阻断） |
| H8 | **主循环失败可恢复**：中断、权限拒绝后可续跑同一任务 | 无卡死确认框；会话可 resume | ✅（engine 8 处 shouldAbort ABORTED 检查 + confirm-prompt Ctrl+C 取消 + `/resume` slash command 接入 SessionResume.list/load + SessionManager.restoreSession 替换当前会话） |

**Phase H 明确不做：** LSP、Notebook、Cron、Voice、Buddy、Team、刷 slash 到 80+、Ink TUI。

---

## Phase I — 差异化硬核（约 3–4 周，真正「超过」候选）

| # | 任务 | 差异化点 | 状态 |
|---|------|----------|------|
| I1 | **可审计 auto-memory**：对话事实写入 `.paude/memory/`，可 diff / 回滚 | 比黑盒记忆更可检查 | ✅（heuristic 提取 is-def-zh/project-uses/set-config/decision 4 类；写入 ~/.paude/memory/auto/<date>.jsonl；Stop hook 自动触发；14 测试覆盖） |
| I2 | **/rewind + 工作区 checkpoint**（按 tool 批次，慎重） | 强恢复；需快照权限与测试 | ✅（git-stash-backed checkpoint + /rewind slash：capture/list/rewindTo；read-tree -m -u --reset 强恢复；12 测试覆盖。已知限制：uncommitted 冲突时 rewind 返回 false 让用户手动 commit/stash） |
| I3 | **Reflection 绑证据**：改码后强制/可选跑测或 lint，失败则继续 loop | 有信号的反思，不是空复读 | ✅（end_turn 时若 toolCallHistory 含 Edit/Write/NotebookEdit 且 reflectionCount < 2 触发；npm/cargo/go/pytest 项目自动检测；失败输出注入 user message 强制下一轮；12 测试覆盖） |
| I4 | **Planning 闭环**：EnterPlanMode / ExitPlanMode 工具 + `/plan` 真正执行步骤（非只 prepared） | 规划→执行可追踪 | ✅ QueryEngine 逐步注入；ExitPlanMode→acceptEdits；`/plan execute` 驱动 kickoff |
| I5 | **Output styles + Compact 策略**（auto / forced / manual + 焦点） | 体感与可控性 | ✅（output-styles.ts：4 风格预设 default/cost/full/minimal；/style slash 切换 + 列表；7 测试覆盖。Compact 策略：auto/forced/manual 三模式 policy 锁定） |
| I6 | **真 Subagent + worktree 隔离**（替换「prefetch = agents」认知） | 多代理有边界，无戏服 | ✅（QueryEngine.workingDirectory；Task 默认 ephemeral worktree + 固定 SubagentReport JSON；禁嵌套 Task；Bash/Glob/Grep 尊重 cwd；不 chdir） |

---

## Phase J — 多 Agent / 协作（约 4–5 周，**依赖 H+I6**）

| # | 任务 | 状态 |
|---|------|------|
| J1 | Task 结果可见性 + TaskGet/List/Stop（先 3 个，再视需要扩到 6） | ✅（TaskStore + TaskList/Get/Stop；sync 登记 + background+Stop；/agents 展示 Task runs；曾 16→19） |
| J2 | TeamCreate / SendMessage（最小可用） | ✅（TeamStore inbox；广播拆收件；嵌套保留 SendMessage、禁 TeamCreate；核心工具 19→21） |
| J3 | Coordinator 模式（有限角色，强契约） | ✅（Coordinator assign/poll/collect；契约 j3/v1；lead→worker Task+inbox；collect 仅 SubagentReport；核心工具 21→22） |
| J4 | Voice / Buddy | ❌ 默认不做，除非单独产品决策 |

---

## Phase K — 生态与表面（随时按频率插入，不挡 H/I）

| # | 任务 | 状态 |
|---|------|------|
| K1 | SkillTool / ToolSearch（延迟加载技能目录） | ✅（SkillTool load/list/search；ToolSearch；assembler 默认 lazy index；skillsFullCatalog opt-in；核心工具 22→24） |
| K2 | ConfigTool（薄封装现有 settings） | ✅（get/set/list；writable 白名单；apiKey 脱敏；写入 user/project/local；核心工具 24→25） |
| K3 | Brief → **Skill 或 slash**，不占核心工具编制 | ✅（`/brief` 确定性构建 + `.claude/skills/brief`；无 BriefTool） |
| K4 | NotebookEdit / ScheduleCron / Diagnostics(+LSP 别名) | ✅（诊断非真 language server） |
| K5 | MCP 其余 transport；Bridge 远程会话 | ✅ sse/http/**websocket**；Bridge 会话 deferred；`/bridge` v1-partial 远程 MCP 清单 |
| K6 | 高频 slash 补齐（按使用统计，不对齐 101） | ✅（+ `/voice`） |
| K7 | Ink TUI | ✅ AskUser + 高频 slash；`/rewind <id>` askConfirm → rewindToDetailed |
| J4 | Voice / Buddy | deferred 产品面（`/voice` 状态契约，非 STT） |

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

遗留 G 项并入：G4 图片 → ✅（serializer + CLI `--image`）；G5 MCP → **H5**；G6 ML AUTO → **G6/v1-pluggable 已落地**（默认 v0 deterministic；真 ML 延后）。

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
| 2026-07-17 | **TUI /resume**：list + confirm 后恢复会话（与 REPL 共用 resume-display） |
| 2026-07-17 | **G6/v1 pluggable + TUI /plan 只读**：ClassifierBackend 可注入；TUI list/report |
| 2026-07-17 | **G6/v0 + Bridge v1-partial + TUI /agents**：确定性分类器契约；远程 MCP 清单；TUI 对齐 |
| 2026-07-17 | **J3 /agents assign_many 可见性**：per-assignment status 行（poll 同源） |
| 2026-07-17 | **I4 plan execution report**：done/failed 可审计摘要；`/plan report`；complete 保留 failed |
| 2026-07-17 | **I4 step retry + J3 assign_many**：失败有界重试/skip；并行多 worker |
| 2026-07-17 | **I4/I3/J3 补全**：plan step drive；reflection engine 环测；Coordinator live E2E |
| 2026-07-17 | **M5-hard** + mutation nudge：multi-file / fail-then-fix / cross-module |
| 2026-07-17 | **M5 vs Claude Code**：`claude -p` 同 fixture 并排；`COMPARE.json`；无 CLI/凭证则 skip |
| 2026-07-17 | **M5 live once-success**：cc-switch 凭证；空 messages / message_stop 覆盖 tool_use / mergeToolCalls；BASELINE passRate=1（3/3） |
| 2026-07-17 | K7 `/rewind`：TUI 确认后调用 rewindToDetailed（取消/脏树错误可测） |
| 2026-07-17 | K7 加深：AskUser→Ink askText；TUI slash 对齐 doctor/diff/cost/style/bridge/voice/permissions/brief/rewind |
| 2026-07-17 | **K7 Ink TUI**：`--tui` / `PACODE_TUI=1` 最小 Ink REPL（权限确认 + transcript + /help/clear/mode） |
| 2026-07-17 | **对标 CC P0–P2**：M5 simulated+live wiring；retry 500/502/503；BashOutput；PermissionRequest；L4 结构化 compact；MCP websocket；Diagnostics 别名；`/voice`；工具时间线；rewind 结构化错误 |
| 2026-07-17 | 联合冒烟 + M5 工程评测基线 + G4 图片（--image / ContentBlock）+ Edit 后自动 checkpoint |
| 2026-07-17 | 二次质检：approvedKeys；apiKey 禁 project；ExitPlanMode/PLAN 白名单；DONT_ASK←bash-secure；cron 下限；hooks execFile；AskUser interrupt |
| 2026-07-17 | 质检 P0/P1：Bash 确认可执行 + 2>&1；symlink 嵌套写逃逸；DEFAULT Edit/Write；预取证据门闩；AskUser readLine；LSP 工作区；coverage/docs |
| 2026-07-17 | K4 P2：NotebookEdit + ScheduleCron + LSP(diagnostics) |
| 2026-07-17 | K5：MCP sse/http bootstrap 放行 + auth headers；Bridge deferred `/bridge` |
| 2026-07-17 | K6：高频 slash（doctor/diff + 菜单对齐 resume/rewind/style） |
| 2026-07-17 | K2+K3：ConfigTool + Brief（/brief slash + brief skill，无 BriefTool） |
| 2026-07-17 | K1：SkillTool + ToolSearch；Skills 上下文改为 lazy index |
| 2026-07-17 | J3：Coordinator assign/poll/collect（j3/v1 强契约） |
| 2026-07-17 | J2：TeamCreate + SendMessage（list/receive）最小协作总线 |
| 2026-07-17 | J1：TaskList/Get/Stop + TaskStore 可见性（background Stop） |
| 2026-07-17 | I6：真 Subagent + worktree 隔离（Task isolate_worktree、SubagentReport、工具 cwd） |
| 2026-07-16 | 选项3：harness 测试验证 + H1 预取可关 + H2 会话权限记忆 |
| 2026-07-16 | 重写现行主线 Phase H–K（超越 CC）；否决数量优先排期 |
| 2026-07-16 | H3：PostToolUseFailure + Stop hook 接线（engine.executeTool 失败触发，REPL finally 触发 Stop） |
| 2026-07-16 | H4：Grep 旗标（-i/--glob/--exclude/-A/-B/-C/output_mode/max_results）+ Read offset/limit + Bash truncate 产品化文案 |
| 2026-07-16 | H5：MCP client.ts createTransport switch on type 接线 stdio/sse/http；MCPServerConfig.headers；transport 字段类型 union |
| 2026-07-15 | 单键确认 UX、DEFAULT 只读免确认、质检意图、未知 bash 弹窗非硬拒 |
| 2026-07-15 | G7–G8：预取批确认、/permissions、/cost 按模型计价 |
| 2026-07-14 | 假逻辑清理；G1–G3；boot 真自检；MCP this；prefetch 文案 |
| 2026-07-06 | Phase A–F 基线 |
