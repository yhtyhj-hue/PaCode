/**
 * 判断用户消息是否必须用工具验证（确定性，不走 LLM 猜测）
 */

const TOOL_REQUIRED_PATTERNS: RegExp[] = [
  // 检查当前项目 / 分析这个项目 / 审查本代码库 等
  /(?:分析|检查|审查).{0,16}(?:项目|代码库|仓库|repo)/,
  /(?:项目|代码库|仓库).{0,8}(?:分析|检查|审查|状态|结构)/,
  // 质检 / 深度质检（含「给这个项目做一次深度质检」）
  /质检/,
  /(?:深度|完整|详细|彻底).{0,8}(?:质检|审计|扫描)/,
  // "做一次深度项目质检" / "做项目审计" / "执行代码扫描" 等中文变体
  /(?:做|进行|执行|跑|启动).{0,16}(?:质检|审计|扫描|评估|检查|review|audit)/,
  /(?:深度|完整|详细|彻底).{0,4}(?:项目|代码库|仓库).{0,8}(?:质检|审计|扫描|审查|review|audit)/,
  // 给/对 + 项目 + … + 质检（中间可较长）
  /(?:对|向|给|把|就|请).{0,24}(?:项目|代码库|仓库).{0,24}(?:深度|完整|详细|彻底|了解|分析|调查|摸清|质检|审查|扫描|审计|检查|做)/,
  /inspect\s+(?:the\s+)?(?:current\s+)?(?:project|codebase|repo)/i,
  /analyze\s+(?:the\s+)?(?:current\s+)?(?:project|codebase|repo)/i,
  /check\s+(?:the\s+)?(?:current\s+)?(?:project|codebase|repo|status)/i,
  /运行\s*(测试|test|构建|build)/i,
  /run\s+(?:the\s+)?tests?/i,
  /npm\s+(test|run)/i,
  /review\s+(?:the\s+)?(?:code|codebase|project|repo)/i,
  /(?:修复|修好|改好|fix).{0,40}(?:bug|错误|缺陷|代码|函数|测试|verify)/i,
  /修好|修复\s*bug|fix[- ]?bug/i,
  /refactor|小重构|提取.{0,8}函数|formatName/i,
  /新增.{0,12}测试|add.{0,16}test|write.{0,12}test|clamp\.test/i,
  /audit\s+(?:the\s+)?(?:project|codebase|repo)/i,
  /(?:project|codebase|repo).{0,24}quality\s+check/i,
  /full\s+project\s+quality\s+check/i,
  /(?:读|看|审查|检查).{0,12}(?:代码|实现|源文件|源码)/,
  /代码实现|完整代码|源文件|source\s+code/i,
  /(?:自检|自测).{0,8}(?:代码|实现)/,
  // Deep-read intents: 完整读 / 逐行读 / 全读（disable shallow prefetch）
  /(?:完整|逐行|全|全部)\s*(?:读|看|审|扫描)/,
  /read\s+(?:the\s+)?(?:full|entire|complete|whole)\s+(?:code|file|source)/i,
  /read\s+(?:line\s+by\s+line|every\s+line)/i,
];

/** 需要从代码库/命令获取事实的任务 */
export function requiresToolExecution(message: string): boolean {
  const trimmed = message.trim();
  return TOOL_REQUIRED_PATTERNS.some((re) => re.test(trimmed));
}

/** 从 session 取最近一条用户文本 */
export function getLatestUserText(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    if (typeof msg.content === 'string') return msg.content;
    const text = msg.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n');
    if (text) return text;
  }
  return '';
}
