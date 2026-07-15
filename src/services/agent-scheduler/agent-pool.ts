/**
 * 并行 Agent 运行时状态 — 供 REPL /agents 统一查看
 */

export type AgentRunStatus = 'pending' | 'running' | 'done' | 'error';

export interface AgentRunSnapshot {
  id: string;
  label: string;
  agentType: string;
  status: AgentRunStatus;
  toolCalls: number;
  currentTool?: string;
  error?: string;
}

export class AgentPool {
  private runs = new Map<string, AgentRunSnapshot>();
  private queryId: string | null = null;

  beginQuery(queryId: string, agents: Omit<AgentRunSnapshot, 'status' | 'toolCalls'>[]): void {
    this.queryId = queryId;
    this.runs.clear();
    for (const a of agents) {
      this.runs.set(a.id, { ...a, status: 'pending', toolCalls: 0 });
    }
  }

  markRunning(id: string): void {
    const run = this.runs.get(id);
    if (run) {
      run.status = 'running';
    }
  }

  recordTool(id: string, toolLabel: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.toolCalls += 1;
    run.currentTool = toolLabel;
    run.status = 'running';
  }

  markDone(id: string): void {
    const run = this.runs.get(id);
    if (run) {
      run.status = 'done';
      run.currentTool = undefined;
    }
  }

  markError(id: string, error: string): void {
    const run = this.runs.get(id);
    if (run) {
      run.status = 'error';
      run.error = error;
      run.currentTool = undefined;
    }
  }

  snapshot(): AgentRunSnapshot[] {
    return Array.from(this.runs.values());
  }

  activeQueryId(): string | null {
    return this.queryId;
  }

  clear(): void {
    this.runs.clear();
    this.queryId = null;
  }
}

let poolInstance: AgentPool | null = null;

export function getAgentPool(): AgentPool {
  if (!poolInstance) poolInstance = new AgentPool();
  return poolInstance;
}

export function resetAgentPool(): void {
  poolInstance = null;
}
