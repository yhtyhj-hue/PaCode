/**
 * Git 上下文命令 — 优先 origin/main..HEAD，与 Claude Code 检查项目对齐
 */

export const GIT_STATUS = 'git status -sb 2>/dev/null || ls -la';

export const GIT_DIFF_STAT =
  'git diff origin/main..HEAD --stat 2>/dev/null | head -50 || git diff HEAD~5..HEAD --stat 2>/dev/null | head -50 || echo "(no diff stat)"';

export const GIT_LOG_ONELINE =
  'git log origin/main..HEAD --oneline 2>/dev/null | head -25 || git log -8 --oneline 2>/dev/null || echo "(no git log)"';

export const GIT_DIFF_NAMES =
  'git diff origin/main..HEAD --name-only 2>/dev/null | head -80 || git diff HEAD~5..HEAD --name-only 2>/dev/null | head -80 || echo "(no changed files)"';

/** 对 diff 做确定性安全模式扫描（0 token，替代 security-review 子代理首 pass）。
 *  命令首部带 `# SECURITY_DIFF_SCAN` 标记，供 format-results 识别走脱敏路径。 */
export const SECURITY_DIFF_SCAN = `{ : 'SECURITY_DIFF_SCAN'; }; git diff origin/main..HEAD 2>/dev/null | grep -iE '(password|secret|api[_-]?key|private[_-]?key|BEGIN (RSA|OPENSSH)|aws_access|Bearer )' | head -25 || echo "(no suspicious patterns in diff)"`;

export const NPM_TEST_SUMMARY_CMD =
  'npm test 2>&1 | grep -E "Test Files|Tests " | tail -2 || echo "(npm test unavailable)"';

export const CI_CHECK_CMD =
  'test -d .github/workflows && ls .github/workflows/*.yml 2>/dev/null | wc -l | tr -d " " || echo "0"';

/** 质检防幻觉：coverage 是否仍被 git 跟踪（0 = 已 ignore / 未跟踪） */
export const COVERAGE_TRACKED_CMD =
  'echo "tracked=$(git ls-files coverage/ 2>/dev/null | wc -l | tr -d " ")"; echo "gitignore=$(grep -n "^coverage/" .gitignore 2>/dev/null || echo missing)"';

/** 质检防幻觉：engine 与 agent-scheduler 是调用关系而非双循环 */
export const ARCH_WIRE_CMD =
  "printf 'engine_imports_scheduler='; grep -c agent-scheduler src/agent/engine.ts 2>/dev/null || echo 0; printf 'prefetch_calls='; grep -cE 'runParallelAgentPrefetch|runIntentPrefetch|resolveDagPlan' src/agent/engine.ts 2>/dev/null || echo 0; printf 'scheduler_has_llm='; (grep -rlE 'new Anthropic|consumeModelStream' src/services/agent-scheduler --exclude=git-context.ts --exclude=format-results.ts 2>/dev/null | grep -q . && echo yes || echo no)";
