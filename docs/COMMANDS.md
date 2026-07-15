# PaCode CLI 命令参考

## 基本用法

```bash
pacode [options] [message]
```

## 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-h, --help` | 显示帮助 | - |
| `-v, --version` | 显示版本 | - |
| `-m, --mode <mode>` | 权限模式 | `default` |
| `-M, --model <model>` | 指定模型 | claude-sonnet-4-5 |
| `--max-tokens <n>` | 最大输出tokens | 8192 |
| `--api-key <key>` | API密钥 | 环境变量 |

## 权限模式

| 模式 | 说明 |
|------|------|
| `plan` | 仅生成计划，不执行 |
| `default` | 每次操作需确认 |
| `acceptEdits` | 自动批准文件编辑 |
| `auto` | ML分类器自动决策 |
| `dontAsk` | 除危险操作外都批准 |
| `bypass` | 跳过所有确认（危险）|

## 内置工具

| 工具 | 说明 | 并发安全 |
|------|------|---------|
| `Bash` | 执行shell命令 | ❌ |
| `Read` | 读取文件 | ✅ |
| `Write` | 写入文件 | ❌ |
| `Edit` | 编辑文件 | ❌ |
| `Glob` | 文件匹配 | ✅ |
| `Grep` | 代码搜索 | ✅ |
| `Task` | 子代理委托 | ❌ |
| `TodoWrite` | 任务管理 | ✅ |

## 示例

```bash
# 基本对话
pacode "解释这段代码的作用"

# 启用编辑模式
pacode -m acceptEdits "添加错误处理"

# 指定模型
pacode -M opus "分析架构"

# 管道输入
echo "debug this function" | pacode
```
