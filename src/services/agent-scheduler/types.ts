/**
 * Agent DAG 调度类型
 */

export type ToolIntent =
  | 'inspect_project'
  | 'review_implementation'
  | 'code_audit'
  | 'run_tests';

export type DagNodeSpec = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** 同 group 并行，group 升序执行 */
  group: number;
};

export type DagPlan = {
  intent: ToolIntent;
  nodes: DagNodeSpec[];
};
