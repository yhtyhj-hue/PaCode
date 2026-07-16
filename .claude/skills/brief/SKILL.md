# Brief

## Description
生成项目 Brief：汇总 CLAUDE.md、package.json、README（缺文件则跳过）。

## When to Use
- 需要快速了解项目结构与约定
- 新会话冷启动、交接上下文
- 用户说「brief」「项目简介」「总结这个仓库」

## Tools
- 优先：让用户或 REPL 使用 `/brief`（确定性，零 token）
- 或用 Read 分别读取 `CLAUDE.md`、`package.json`、`README.md`

## Workflow
1. 若会话支持 slash：提示运行 `/brief`（确定性构建，不占核心工具）
2. 否则依次 Read 上述文件（缺失则跳过，勿编造）
3. 输出结构化摘要：项目名/脚本/核心约定/README 要点
4. 不要把 Brief 伪装成已执行的深度质检
