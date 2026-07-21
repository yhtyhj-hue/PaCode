# PaCode CLI 命令参考

与 `src/cli/args.ts` / `showHelp()` 同步。以代码为准。

## 基本用法

```bash
pacode [options] [message]
pacode -p [message]              # Headless 打印（无 REPL）
pacode init
pacode mcp <command>
pacode cc-switch <command>       # 别名: ccs
pacode resume [session-id]
pacode resume list
pacode worktree <command>        # 别名: wt
pacode bridge serve
```

## 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-h, --help` | 显示帮助 | - |
| `-v, --version` | 显示版本 | - |
| `-p, --print` | Headless 模式（跳过 boot/REPL；失败 exit 1） | `false` |
| `-m, --mode <mode>` | 权限模式 | `default` |
| `--model <model>` | 指定模型（**无** `-M` 短选项） | `MiniMax-M3` |
| `--api-key <key>` | API 密钥 | 环境变量 |
| `--base-url <url>` | 自定义 API base URL（代理） | - |
| `--resume` | 恢复最近一次会话（REPL） | `false` |
| `--session-id <id>` | 恢复指定会话 | - |
| `--tui` | 启动 Ink TUI（或 `PACODE_TUI=1`） | `false` |
| `--image <path>` | 附加图片（可重复；png/jpeg/gif/webp） | - |
| `--name <name>` | 会话/运行名称 | - |

> 没有 `--max-tokens` CLI 选项。Token 上限走配置 / `CLAUDE_MAX_TOKENS` / 会话 effort。

## 权限模式

| 模式 | 说明 |
|------|------|
| `plan` | 仅生成计划，不执行 |
| `default` | 每次操作需确认 |
| `acceptEdits` | 自动批准文件编辑 |
| `auto` | 分类器自动决策（启发式；非神经网络） |
| `dontAsk` | 除危险操作外都批准 |
| `bypass` | 跳过所有确认（危险） |

## 子命令摘要

| 命令 | 说明 |
|------|------|
| `init` | 初始化 `.paude/` 与 `CLAUDE.md` |
| `mcp list\|add\|remove` | MCP 服务器配置 |
| `cc-switch list\|use\|add\|remove\|import\|status\|detect` | Provider 管理 |
| `resume [id]\|list` | 会话恢复 |
| `worktree list\|create\|remove` | Git worktree |
| `bridge serve` | 本地 WebSocket session relay |

## 内置工具

| 工具 | 说明 | 并发安全 |
|------|------|---------|
| `Bash` | 执行 shell 命令 | ❌ |
| `Read` | 读取文件 | ✅ |
| `Write` | 写入文件 | ❌ |
| `Edit` | 编辑文件 | ❌ |
| `Glob` | 文件匹配 | ✅ |
| `Grep` | 代码搜索 | ✅ |
| `Task` | 子代理委托 | ❌ |
| `TodoWrite` | 任务列表（驱动 CLI 实时 ■/□ 树） | ✅ |

## 示例

```bash
# 基本对话
pacode "解释这段代码的作用"

# Headless
pacode -p "总结 README"

# 启用编辑模式
pacode -m acceptEdits "添加错误处理"

# 指定模型（长选项）
pacode --model MiniMax-M3 "分析架构"

# 附加图片
pacode --image shot.png "这张截图里有什么问题？"

# 恢复会话
pacode --resume
pacode --session-id abc123

# 管道输入
echo "debug this function" | pacode
```

## 相关环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` / `PACODE_API_KEY` | MiniMax API Key |
| `ANTHROPIC_BASE_URL` / `PACODE_BASE_URL` | 默认 `https://api.minimaxi.com/anthropic` |
| `CLAUDE_MODEL` / `PACODE_MODEL` | 默认 `MiniMax-M3` |
| `PACODE_TUI` | `1` → Ink TUI |
| `PACODE_STATUSLINE_CMD` | Statusline 脚本 |
| `PACODE_PREFETCH_DAG` | `1` → 脚本 DAG（默认真 LLM explore） |
