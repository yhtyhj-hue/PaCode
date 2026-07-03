# PaCode

> 类 Claude Code 架构的 AI 编程助手框架

## 项目概述

PaCode 是一个参考 Claude Code 架构理念设计的 AI 编程助手，完全独立实现，不使用任何 Claude Code 源代码。

### 核心特性

- 🤖 **AI Agent 循环** - 基于 Anthropic API 的智能推理循环
- 🛡️ **7 级权限系统** - 防御深度安全机制
- 📦 **8 核心工具** - Bash, Read, Edit, Write, Grep, Glob, Task, TodoWrite
- 💾 **文件化记忆** - 可版本控制的记忆系统
- 🔌 **4 层扩展机制** - Hooks → Skills → Plugins → MCP
- 📊 **5 层压缩管道** - 支持长会话运行

### 架构哲学

> "Only 1.6% of Claude Code's codebase is AI decision logic. The other 98.4% is deterministic infrastructure"

真正的工程复杂度在于：
- 权限系统与安全检查
- 上下文管理与压缩
- 工具路由与执行
- 会话持久化与恢复

## 快速开始

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行
npm start
```

## 文档

- [架构设计文档](./ARCHITECTURE.md) - 完整的架构设计说明
- [CLAUDE.md](./CLAUDE.md) - 项目约定与实现指南

## 项目结构

```
paCode/
├── cmd/              # CLI 入口
├── internal/         # 核心模块
│   ├── agent/        # Agent 引擎
│   ├── cli/          # 命令行界面
│   ├── context/      # 上下文管理
│   ├── memory/       # 记忆系统
│   ├── tools/        # 工具集
│   ├── permission/   # 权限系统
│   └── mcp/          # MCP 客户端
├── pkg/              # 公共库
├── config/           # 默认配置
├── test/             # 测试
└── docs/             # 文档
```

## 开发阶段

| 阶段 | 目标 | 状态 |
|------|------|------|
| Phase 1 | 核心框架 | 🔨 进行中 |
| Phase 2 | 安全权限 | 📋 待开始 |
| Phase 3 | 上下文管理 | 📋 待开始 |
| Phase 4 | 工具增强 | 📋 待开始 |
| Phase 5 | 扩展机制 | 📋 待开始 |
| Phase 6 | 完善测试 | 📋 待开始 |

## 技术栈

- **CLI**: TypeScript + Ink/React
- **Agent Core**: Go
- **AI**: Anthropic Messages API
- **Protocol**: MCP (Model Context Protocol)
- **Storage**: SQLite + 文件存储

## 参考资料

- [Dive into Claude Code](https://github.com/VILA-Lab/Dive-into-Claude-Code) - VILA-Lab 源码分析
- [Claude Code Architecture](https://arxiv.org/html/2604.14228v1) - 学术论文

## 许可证

MIT
