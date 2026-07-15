/**
 * @deprecated 使用 services/agent-scheduler
 */
export {
  resolveDagPlan,
  buildDagPlan,
  classifyToolIntent,
  formatDagResults as formatBootstrapResults,
  executeDagPlan,
} from '../services/agent-scheduler/index.js';
import { buildDagPlan } from '../services/agent-scheduler/intents.js';
import { ToolCall } from '../pkg/types.js';

export function createProjectBootstrapCalls(): ToolCall[] {
  return buildDagPlan('inspect_project').nodes.map((n, i) => ({
    id: `bootstrap_${n.id}_${i + 1}`,
    name: n.name,
    input: n.input,
  }));
}

export const PROJECT_BOOTSTRAP_NOTE = 'Running intent DAG prefetch before model summary.';
