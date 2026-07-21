# PaCode Skills 技能系统

## 什么是 Skill

Skill 是 Markdown 格式定义的技能模块，AI 根据描述自行判断何时使用。

## 目录结构

```
.claude/skills/
├── debug/
│   └── SKILL.md
├── refactor/
│   └── SKILL.md
├── test/
│   └── SKILL.md
└── {skill-name}/
    └── SKILL.md
```

## SKILL.md 格式

```markdown
# Skill 名称

## Description
技能描述

## When to Use
- 使用场景1
- 使用场景2

## Tools
- ToolName: 工具用途

## Workflow
1. 步骤1
2. 步骤2
3. 步骤3
```

## 示例: Debug Skill

```markdown
# Debug

## Description
系统调试技能，用于诊断和解决代码问题。

## When to Use
- 遇到错误需要调试
- 代码行为异常
- 性能问题分析

## Tools
- Bash: 运行诊断命令
- Grep: 搜索代码
- Read: 查看源文件

## Workflow
1. 收集错误信息
2. 定位问题源头
3. 分析代码逻辑
4. 提出修复方案
5. 验证修复
```

## 发现与加载

默认 **lazy**：只把 skill 名称/描述注入上下文，正文按需再读，控制 token 成本。

- **Lazy（默认）**：discovery 索引 + 命中后再加载完整 `SKILL.md`
- **Full catalog opt-in**：需要一次挂全量正文时，走 `skillsFullCatalog`（见 README）；日常对话不要开

## 创建自定义 Skill

1. 在 `.claude/skills/` 创建目录
2. 编写 `SKILL.md`
3. AI 自动发现并使用

## 内置 Skills

| Skill | 用途 |
|--------|------|
| Debug | 调试和错误排查 |
| Refactor | 代码重构 |
| Test | 测试编写 |
