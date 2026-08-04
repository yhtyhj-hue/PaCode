/**
 * 缺 API Key 时的配置引导（启动动画与 -p 共用）
 * 圆角分区 + 青绿强调，贴近合成预览观感。
 */

import {
  formatBox,
  getUiWidth,
  BOLD,
  DIM,
  RESET,
  TEAL,
  YELLOW,
  CYAN,
  GREEN,
} from './repl-ui.js';

/** 返回纯文本引导，调用方可直接 console.log */
export function formatSetupGuide(): string {
  const width = Math.min(72, getUiWidth());
  const pathA = formatBox(
    [
      `${GREEN}${BOLD}路径 A · 推荐 · 默认 MiniMax${RESET} ${DIM}（三步）${RESET}`,
      `${DIM}1)${RESET} 打开 ${CYAN}https://platform.minimaxi.com/${RESET} 创建 API Key`,
      `   ${DIM}国际站：https://platform.minimax.io/${RESET}`,
      `${DIM}2)${RESET} 写入环境变量后重开终端：`,
      `   ${YELLOW}export ANTHROPIC_API_KEY=${RESET}${DIM}你的密钥${RESET}`,
      `   ${DIM}# 等价：export PACODE_API_KEY=…${RESET}`,
      `${DIM}3)${RESET} 再运行： ${TEAL}${BOLD}pacode${RESET}`,
    ],
    { width, borderColor: DIM, padding: 2 }
  );

  const pathB = formatBox(
    [
      `${TEAL}${BOLD}路径 B · 其它厂商${RESET} ${DIM}（DeepSeek / 豆包 / GLM / 混元 / 千问 / OpenAI …）${RESET}`,
      `${DIM}1)${RESET} ${YELLOW}pacode cc-switch presets${RESET}`,
      `${DIM}2)${RESET} ${YELLOW}pacode cc-switch add <名字> --preset=deepseek --api-key=sk-xxx${RESET}`,
      `${DIM}3)${RESET} ${YELLOW}pacode cc-switch use <名字>${RESET}`,
      `${DIM}4)${RESET} ${TEAL}${BOLD}pacode${RESET}`,
    ],
    { width, borderColor: DIM, padding: 2 }
  );

  const note = formatBox(
    [
      `${DIM}说明${RESET}`,
      `${DIM}·${RESET} 环境变量名沿用 ${YELLOW}ANTHROPIC_API_KEY${RESET}，兼容 Anthropic 协议生态；`,
      `  默认连的是 MiniMax 网关，不是 Anthropic 官方。`,
      `${DIM}·${RESET} 详细配置见仓库 ${CYAN}docs/CONFIG.md${RESET}`,
    ],
    { width, borderColor: DIM, padding: 2 }
  );

  return [
    '',
    `${DIM}还不能对话：缺少 API Key。按下面任选一条路径配置即可。${RESET}`,
    '',
    pathA,
    '',
    pathB,
    '',
    note,
  ].join('\n');
}
