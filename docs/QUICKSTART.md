# PaCode 快速入门

## 安装

```bash
# 克隆项目
git clone https://gitee.com/sallon/pa-code.git
cd pa-code

# 安装依赖
npm install

# 构建
npm run build

# 运行
node dist/cli/index.js "你的问题"
```

## 快速开始

```bash
# 基本使用
node dist/cli/index.js "解释这段代码的作用"

# 指定模式
node dist/cli/index.js -m acceptEdits "修复bug"

# 查看帮助
node dist/cli/index.js --help
```

## 权限模式

| 模式 | 说明 |
|------|------|
| `plan` | 仅规划，不执行 |
| `default` | 每次操作需确认 |
| `acceptEdits` | 自动批准编辑操作 |
| `auto` | ML分类器自动决策 |
| `dontAsk` | 除危险操作外都批准 |

## 示例命令

```bash
# 读取并分析文件
node dist/cli/index.js "分析 src 目录下的代码结构"

# 编辑文件
node dist/cli/index.js -m acceptEdits "在 index.ts 添加错误处理"

# 搜索代码
node dist/cli/index.js "找到所有使用 console.log 的地方"
```
