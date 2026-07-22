/**
 * 缺 API Key 时的配置引导（启动动画与 -p 共用，避免两套文案）
 */

/** 返回纯文本引导，调用方可直接 console.log */
export function formatSetupGuide(): string {
  return `
${'─'.repeat(56)}
还不能对话：缺少 API Key。按下面任选一条路径配置即可。

路径 A · 推荐 · 默认 MiniMax（三步）
  1) 打开 https://platform.minimaxi.com/ 创建 API Key
     （国际站：https://platform.minimax.io/）
  2) 写入环境变量后重开终端：
       export ANTHROPIC_API_KEY=你的密钥
       # 等价别名：export PACODE_API_KEY=你的密钥
  3) 再运行：
       pacode

路径 B · 其它厂商（DeepSeek / 豆包 / GLM / 混元 / 千问 / OpenAI …）
  1) pacode cc-switch presets
  2) pacode cc-switch add <名字> --preset=deepseek --api-key=sk-xxx
  3) pacode cc-switch use <名字>
  4) pacode

说明
  · 环境变量名沿用 ANTHROPIC_API_KEY，是为了兼容 Anthropic 协议生态；
    默认连的是 MiniMax 网关，不是 Anthropic 官方。
  · 详细配置见仓库 docs/CONFIG.md
${'─'.repeat(56)}
`.trimEnd();
}
