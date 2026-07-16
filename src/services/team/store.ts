/**
 * J2: 进程内 Team 消息总线（非 prefetch；真成员 inbox）
 */

import type { Team, TeamMember, TeamMessage, TeamSummary } from './types.js';

const MAX_TEAMS = 20;
const MAX_MEMBERS = 8;
const MAX_MESSAGES = 200;

function validateMemberName(name: string): boolean {
  return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/.test(name);
}

export class TeamStore {
  private teams = new Map<string, Team>();
  private seq = 0;

  create(input: {
    name: string;
    description?: string;
    members: TeamMember[];
  }): { ok: true; team: Team } | { ok: false; error: string } {
    const name = input.name?.trim();
    if (!name || name.length > 64) {
      return { ok: false, error: 'Team name required (1–64 chars)' };
    }
    if (!Array.isArray(input.members) || input.members.length === 0) {
      return { ok: false, error: 'At least one member required' };
    }
    if (input.members.length > MAX_MEMBERS) {
      return { ok: false, error: `Max ${MAX_MEMBERS} members` };
    }

    const seen = new Set<string>();
    const members: TeamMember[] = [];
    for (const m of input.members) {
      if (!validateMemberName(m.name)) {
        return {
          ok: false,
          error: `Invalid member name: ${m.name}. Use [a-zA-Z0-9][a-zA-Z0-9._-]*`,
        };
      }
      if (seen.has(m.name)) {
        return { ok: false, error: `Duplicate member: ${m.name}` };
      }
      seen.add(m.name);
      members.push({
        name: m.name,
        role: (m.role || 'worker').slice(0, 32),
        subagentType: m.subagentType?.slice(0, 64),
      });
    }

    this.seq += 1;
    const id = `team_${Date.now().toString(36)}_${this.seq}`;
    const team: Team = {
      id,
      name,
      description: input.description?.slice(0, 500),
      members,
      messages: [],
      createdAt: Date.now(),
    };
    this.teams.set(id, team);
    this.trimTeams();
    return { ok: true, team };
  }

  get(id: string): Team | undefined {
    return this.teams.get(id);
  }

  list(): TeamSummary[] {
    return Array.from(this.teams.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({
        id: t.id,
        name: t.name,
        memberCount: t.members.length,
        messageCount: t.messages.length,
        unreadCount: t.messages.filter((m) => !m.read).length,
        createdAt: t.createdAt,
      }));
  }

  send(input: {
    teamId: string;
    from: string;
    to: string;
    content: string;
  }): { ok: true; message: TeamMessage; delivered: number } | { ok: false; error: string } {
    const team = this.teams.get(input.teamId);
    if (!team) return { ok: false, error: `Unknown team_id: ${input.teamId}` };

    if (!team.members.some((m) => m.name === input.from)) {
      return { ok: false, error: `Unknown from member: ${input.from}` };
    }

    const to = input.to.trim();
    const content = input.content?.trim();
    if (!content) return { ok: false, error: 'content required' };
    if (content.length > 8000) {
      return { ok: false, error: 'content max 8000 chars' };
    }

    // 广播拆成每人一条，避免一人 markRead 吃掉其他人的未读
    const recipients =
      to === '*'
        ? team.members.filter((m) => m.name !== input.from).map((m) => m.name)
        : [to];

    if (to !== '*') {
      if (!team.members.some((m) => m.name === to)) {
        return { ok: false, error: `Unknown to member: ${to}` };
      }
      if (to === input.from) {
        return { ok: false, error: 'Cannot send to self; use action=receive to read inbox' };
      }
    }
    if (recipients.length === 0) {
      return { ok: false, error: 'No recipients' };
    }

    const body = content.slice(0, 8000);
    const now = Date.now();
    let first: TeamMessage | null = null;
    for (const recipient of recipients) {
      const message: TeamMessage = {
        id: `msg_${Date.now().toString(36)}_${++this.seq}`,
        from: input.from,
        to: recipient,
        content: body,
        createdAt: now,
        read: false,
      };
      team.messages.push(message);
      if (!first) first = message;
    }
    if (team.messages.length > MAX_MESSAGES) {
      team.messages = team.messages.slice(-MAX_MESSAGES);
    }
    return { ok: true, message: first!, delivered: recipients.length };
  }

  /** 领取发给该成员的未读消息 */
  receive(
    teamId: string,
    member: string,
    options: { markRead?: boolean } = {}
  ): { ok: true; messages: TeamMessage[] } | { ok: false; error: string } {
    const team = this.teams.get(teamId);
    if (!team) return { ok: false, error: `Unknown team_id: ${teamId}` };
    if (!team.members.some((m) => m.name === member)) {
      return { ok: false, error: `Unknown member: ${member}` };
    }

    const markRead = options.markRead !== false;
    const pending = team.messages.filter((m) => !m.read && m.to === member);
    if (markRead) {
      for (const m of pending) m.read = true;
    }
    return { ok: true, messages: pending };
  }

  clear(): void {
    this.teams.clear();
    this.seq = 0;
  }

  private trimTeams(): void {
    if (this.teams.size <= MAX_TEAMS) return;
    const sorted = Array.from(this.teams.values()).sort((a, b) => a.createdAt - b.createdAt);
    for (const t of sorted.slice(0, this.teams.size - MAX_TEAMS)) {
      this.teams.delete(t.id);
    }
  }
}

let instance: TeamStore | null = null;

export function getTeamStore(): TeamStore {
  if (!instance) instance = new TeamStore();
  return instance;
}

export function resetTeamStore(): void {
  instance = null;
}
