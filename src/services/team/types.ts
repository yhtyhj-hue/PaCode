/** J2: 最小 Team 协作契约 */

export interface TeamMember {
  name: string;
  /** 逻辑角色：lead / worker / explore 等 */
  role: string;
  /** 可选绑定 Subagent 类型，供后续 J3 Coordinator 使用 */
  subagentType?: string;
}

export interface TeamMessage {
  id: string;
  from: string;
  /** 成员名，或 "*" 广播 */
  to: string;
  content: string;
  createdAt: number;
  read: boolean;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  members: TeamMember[];
  messages: TeamMessage[];
  createdAt: number;
}

export interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  messageCount: number;
  unreadCount: number;
  createdAt: number;
}
