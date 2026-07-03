# PaCode 项目约定

## 核心理念 (High-level Mindset)

> **This section is non-negotiable and must never be removed.**

追求卓越，不妥协。边际完成成本接近于零，所以要把事情做完、做好、带上测试和文档。"Table this for later" 是不允许的——永久性解决方案在可及范围内时，就要立即完成。

**核心原则：**
- Search before building. Test before shipping. Ship the complete thing.
- 时间不是借口。疲劳不是借口。复杂性不是借口。
- 你可以外包打字，但不能外包理解。在称任何工作为"DONE"之前，必须能够解释代码为什么是正确的，以及它会在哪里出问题。
- 测试通过不等于理解。如果不能口头走出失败模式，就没有完成，只是在猜测。

---

## 双空间思维 (Two Machine Spaces)

每个工作都属于两个空间之一。选错空间是 Agent 产出糟糕结果的最常见原因。

| 空间 | 适用场景 | 特点 |
|------|---------|------|
| **Latent Space (LLM)** | 判断、模式匹配、创意、分析、模糊输入 | 成本高、可变性高、不可检查 |
| **Deterministic Space (Code)** | 精确、可重现、速度、零运行成本、可测试 | 一次编写、零可变、完全可检查 |

**规则：** 如果相同问题两次会得到相同的正确答案，就是确定性工作。不要在 latent space 中做。写脚本。

**适用场景（应写脚本而非 LLM 回复）：**
- 算术、时间转换、日期计算
- 文件查找、CSV 解析、JSON 转换
- 正则匹配、哈希计算、结构化 API 调用

**元循环：** LLM 编写确定性脚本，然后脚本约束 LLM。Latent space 中的 bug 成为 deterministic space 中的特性，旧的失败路径在结构上变得不可达。

---

## 上下文窗口管理

上下文窗口是控制模型的唯一杠杆。把它当作一个深思熟虑的输入，而不是倾倒场。

- 加载 spec、contract、相关文件和具体例子
- 排除噪音
- 模糊或臃肿的上下文产生模糊或臃肿的输出
- 当任务出问题，首先问"窗口里有什么"，而不是"模型是否愚蠢"

---

## 不可妥协的规则

### 1. 测试与 Evals — 每次都要，无例外

- 每个 feature 附带测试套件 AND eval 套件，**同一提交**。不是下一个 PR。
- 每个 bug 修复附带测试 AND eval，能捕获该 bug。回归测试是 bug 修复的证明。Eval 是修复可泛化的证明。
- 每个失败都要 skillify。
- "之后添加测试"被禁止。如果测试/eval 不在 diff 中，工作就没有完成。

**两种测试车道：**
- **Gate tests** — 确定性、本地、免费、<2s。每次提交通过 pre-commit hook 运行。从不 flaky。
- **Periodic evals** — 付费（LLM 调用）、较慢、质量测量。发布前和夜间运行。可以非确定性但必须有通过阈值。

### 2. 每次变更绑定可衡量结果

- 每个 feature 在构建前命名其结果：指标、工作流步骤或用户可见行为。
- 如果无法说明什么会变得更好以及如何衡量，触发 Confusion Protocol。

### 3. LLM 访问 — 优先使用本地 Claude Code

- 当我们构建的软件需要调用 LLM 时，**不要**使用 LLM API（Anthropic API、OpenAI API 等），除非明确指示。
- 优先路由到本地 Claude Code。
- 默认使用最佳可用模型。

### 4. 技术选型 — 优先 vanilla

- 最简单的 vanilla 技术获胜。不要框架-of-the-month。不要为假设的重用创建聪明的抽象。
- 写工具前先检查是否已存在库解决它。
- 跨领域 concern（eval harness、prompt library、vision utilities 等）先用 GitHub 搜索候选，按 stars、最后提交时间、issue 响应排序。

### 5. Search before building

三层搜索顺序：
1. **Tried-and-true.** 有标准库或模式吗？用它。
2. **New-and-popular.** 有更新的库且有实际吸引力吗？评估它。
3. **First-principles.** 传统方法真的适用吗？如果情况确实不同，记录 WHY 再写自定义代码。

### 6. Skillify 重复成功，不仅仅是失败

第二次手动运行相同流程时，停止并编纂：脚本、skill 或工作流。一次性 prompts 不会累积；可重用流程会。杠杆在于你停止需要思考的工作，而不是每次从零开始 re-prompt。

---

## 服务优先架构 (Services-first, Parallel-friendly)

构建一切为独立服务/自包含目录。目标：任何单个组件都可以由独立的 Claude Code session 处理，不会踩到另一个 session 的工作。

**核心原则：**
- **One concern, one directory.** 每个服务住在 `services/<service-name>/`，有自己的代码、测试、eval、README 和配置。服务间无共享可变状态，只有良好定义的 contracts。
- **Contracts at the boundary.** 服务通过类型化接口（HTTP、gRPC、message bus 或共享 schema package）通信。Contract 定义在 `contracts/` 或 `schemas/` 目录。
- **Independent test + eval suites.** 每个服务有自己的 gate tests 和 periodic evals。
- **Independent deploy unit.** 每个服务独立构建和发布。
- **Parallel-session safe.** 两个 Claude session 在不同目录工作永远不会冲突。

**默认扇出。** 当工作分解为独立单元时，作为独立隔离 session 或 worktree 同时运行，而不是一个接一个。

---

## 完成状态协议 (Completion Status Protocol)

每个任务结束时，报告以下之一：

| 状态 | 含义 |
|------|------|
| **DONE** | 所有步骤完成。每个声明都有证据。测试 + eval 在 diff 中。准备好合并。 |
| **DONE_WITH_CONCERNS** | 完成，但有问题需要Julien知道。列出每个问题的严重性和建议的后续行动。 |
| **BLOCKED** | 无法继续。说明阻塞内容和已尝试的方法。 |
| **NEEDS_CONTEXT** | 缺少继续所需的上下文。准确说明需要什么。 |

"Partially done" 不是状态。要么 feature 发货（DONE），要么没有（BLOCKED / NEEDS_CONTEXT）。

---

## 后台任务与数据迁移

长时间运行的工作通常在后台运行：批处理、迁移、数据填充等。

**监控，不要 fire-and-forget。**
- 任务运行时，每 5 分钟发布进度更新。
- 同时打印到 Claude Code session 和状态文件 `/tmp/<job-name>/progress.log`。
- 进度百分比、速率、ETA 是确定性的。不要在 latent space 中目测。写一个小监控脚本读取任务的真实状态。

**触碰任何东西前先快照。** 默认将备份保存到 `/tmp/`。如果快照超过 100k 行或 100MB，先停下来请求许可。

**完成后生产报告。** 每个后台任务以书面报告结束：
- 结论：数据迁移是否成功？用证据说明。
- 表格：每类别的具体 before/after 示例。
- 完整 before/after CSV 写到 `/tmp/`。

---

## 困惑协议 (Confusion Protocol)

遇到高风险模糊性时：
- 两个可行架构满足同一需求
- 请求与现有模式矛盾
- 破坏性操作范围不清
- 缺少会实质性改变方法的信息

**STOP。** 用一句话命名模糊性。呈现 2-3 个有真实权衡的选项。问 Julien。不要在架构决策上猜测。

不适用于：常规编码、小 feature 或明显更改。

---

## 安全规则

- **永不提交 secrets。** 如果 `.env` 被触碰，任何提交前验证 `.gitignore`。
- **破坏性操作需明确确认。** `rm -rf`、`git reset --hard`、`git push --force`、`DROP TABLE`、`kubectl delete` 等。
- **不要用 `--no-verify` 跳过 pre-commit hooks。** 如果 hook 失败，修复底层问题。
- **不要提交二进制文件、编译输出或模型权重。**
- **触碰生产前，声明将要做什么，等待确认。**

---

## 沟通风格

- 直接。简短。具体。不 preamble。
- 具体文件名、函数名、行号。不是"classifier 有问题"——而是 `food_vision/classifier.py:47`。
- 不使用破折号。不使用 AI 词汇（delve, crucial, robust, comprehensive, nuanced, multifaceted, furthermore, moreover, pivotal, landscape, tapestry, underscore, foster, showcase, intricate, vibrant, fundamental, significant, interplay）。
- 禁止短语："here's the kicker", "here's the thing", "plot twist", "let me break this down", "the bottom line", "make no mistake"。
- 东西坏了就直接说。
- 以下一个行动结束，而不是刚做完的事情的总结。

---

## 传统工程原则

### KISS (Keep It Simple)
- 优先选择最简单的解决方案
- 避免过度工程化
- 追求代码清晰而非聪明

### YAGNI (You Aren't Gonna Need It)
- 只实现当前所需功能
- 抵制 speculative generality
- 先简单，后重构

### DRY (Don't Repeat Yourself)
- 提取重复逻辑到共享函数
- 引入抽象时确保有实际重复

### 不可变性 (Immutability)
- 创建新对象而非修改现有对象
- 避免隐藏副作用
- 支持安全的并发操作

---

## 代码规范

### 文件组织
- 每个模块一个文件（200-400 行）
- 最大 800 行
- 按功能/领域组织，非按类型

### 命名约定
- 变量/函数: `camelCase`
- 布尔值: `is`, `has`, `should`, `can` 前缀
- 接口/类型/组件: `PascalCase`
- 常量: `UPPER_SNAKE_CASE`

### 错误处理
- 始终显式处理错误
- UI 代码提供用户友好的错误信息
- 服务端记录详细错误上下文

### 输入验证
- 在系统边界验证所有用户输入
- 使用 schema 验证
- 快速失败并提供清晰的错误信息

---

## Agent 循环实现 (PaCode 特有)

### 核心模式
```
while (stop_reason === "tool_use") {
    1. assemble context (9 sources)
    2. run compaction (5 layers if needed)
    3. call model (streaming)
    4. dispatch tools
    5. permission check (7 modes)
    6. execute tools
    7. append results to history
}
```

### 工具注册
- 每个工具必须声明 `concurrencySafe`
- 每个工具必须声明 `permissionMode`
- 工具执行必须通过 Hook 拦截点

---

## 权限系统 (PaCode 特有)

### 7 级权限模式
1. `plan` - 仅规划，不执行
2. `default` - 每次确认
3. `acceptEdits` - 自动批准编辑
4. `auto` - ML 分类器决策
5. `dontAsk` - 除危险操作外都批准
6. `bypassPermissions` - 跳过所有检查
7. `bubble` - 内部模式

### Deny-first 原则
任何安全层都可以阻止操作，阻止是最终的。

---

## 上下文管理 (PaCode 特有)

### 9 个上下文源（按优先级）
1. System Prompt
2. CLAUDE.md
3. Rules Layer
4. Skills
5. Working Memory
6. Task Context
7. MCP Tools
8. Project Context
9. Recent Results

### 5 层压缩触发顺序
当 token 使用超过 83% (167K/200K)：
1. Budget Reduction
2. Snip
3. Microcompact
4. Context Collapse
5. Auto-compact (最后手段)

---

## 记忆系统 (PaCode 特有)

### 文件化存储
- 记忆存储在 `.paude/memory/` 目录
- 可检查、可编辑、可版本控制
- 无向量数据库

### 三层记忆
1. Working Memory - 当前会话
2. Project Memory - 项目级
3. Global Memory - 持久化

---

## 扩展机制 (PaCode 特有)

### 按上下文成本排序
1. **Hooks (zero cost)** - PreToolUse, PostToolUse, SessionStart/Stop
2. **Skills (low cost)** - Markdown 文件定义的技能
3. **Plugins (medium cost)** - 自定义命令和代理
4. **MCP (high cost)** - 外部服务集成

---

## 提交规范

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

---

## 测试要求

- 最低覆盖率: 80%
- 必测类型: 单元测试、集成测试、E2E 测试
- 使用 AAA (Arrange-Act-Assert) 模式

---

## 参考架构

本项目参考 Claude Code v2.1.88 架构设计：
- VILA-Lab 源码分析: https://github.com/VILA-Lab/Dive-into-Claude-Code
- 架构论文: https://arxiv.org/html/2604.14228v1
