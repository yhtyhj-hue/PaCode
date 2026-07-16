/**
 * J2 — TeamCreate / SendMessage 最小可用
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerTeamTools } from '../src/tools/team.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import { getTeamStore, resetTeamStore } from '../src/services/team/index.js';
import { registryWithoutTask } from '../src/agent/subagent.js';
import { PermissionMode } from '../src/pkg/types.js';

const ctx = {
  workingDirectory: process.cwd(),
  sessionState: {} as never,
  hooks: {} as never,
};

describe('J2 TeamStore', () => {
  beforeEach(() => resetTeamStore());
  afterEach(() => resetTeamStore());

  it('creates team and delivers send/receive', () => {
    const store = getTeamStore();
    const created = store.create({
      name: 'audit',
      members: [
        { name: 'lead', role: 'lead' },
        { name: 'explorer', role: 'worker', subagentType: 'explore' },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const sent = store.send({
      teamId: created.team.id,
      from: 'lead',
      to: 'explorer',
      content: 'Scan src/ for TODOs',
    });
    expect(sent.ok).toBe(true);

    const inbox = store.receive(created.team.id, 'explorer');
    expect(inbox.ok).toBe(true);
    if (!inbox.ok) return;
    expect(inbox.messages).toHaveLength(1);
    expect(inbox.messages[0]?.content).toContain('TODOs');

    const again = store.receive(created.team.id, 'explorer');
    expect(again.ok && again.messages.length === 0).toBe(true);
  });

  it('supports broadcast *', () => {
    const store = getTeamStore();
    const created = store.create({
      name: 'broadcast',
      members: [
        { name: 'a', role: 'lead' },
        { name: 'b', role: 'worker' },
        { name: 'c', role: 'worker' },
      ],
    });
    if (!created.ok) throw new Error('create failed');

    store.send({
      teamId: created.team.id,
      from: 'a',
      to: '*',
      content: 'standup',
    });

    const b = store.receive(created.team.id, 'b');
    const c = store.receive(created.team.id, 'c');
    expect(b.ok && b.messages[0]?.content).toBe('standup');
    expect(c.ok && c.messages[0]?.content).toBe('standup');
  });

  it('rejects invalid members', () => {
    const bad = getTeamStore().create({
      name: 'x',
      members: [{ name: '../evil', role: 'lead' }],
    });
    expect(bad.ok).toBe(false);
  });
});

describe('J2 Team tools', () => {
  beforeEach(() => resetTeamStore());
  afterEach(() => resetTeamStore());

  it('TeamCreate + SendMessage send/receive/list', async () => {
    const registry = new ToolRegistry();
    registerTeamTools(registry);

    const created = await registry.execute(
      {
        id: '1',
        name: 'TeamCreate',
        input: {
          name: 'qa',
          members: [
            { name: 'lead', role: 'lead' },
            { name: 'worker', role: 'worker', subagent_type: 'general-purpose' },
          ],
        },
      },
      ctx
    );
    expect(created.isError).toBeFalsy();
    const meta = JSON.parse((created.content[0] as { text: string }).text);
    expect(meta.team_id).toMatch(/^team_/);

    const sent = await registry.execute(
      {
        id: '2',
        name: 'SendMessage',
        input: {
          team_id: meta.team_id,
          from: 'lead',
          to: 'worker',
          content: 'run lint',
        },
      },
      ctx
    );
    expect(sent.isError).toBeFalsy();
    expect(JSON.parse((sent.content[0] as { text: string }).text).delivered).toBe(true);

    const inbox = await registry.execute(
      {
        id: '3',
        name: 'SendMessage',
        input: {
          action: 'receive',
          team_id: meta.team_id,
          from: 'worker',
        },
      },
      ctx
    );
    const body = JSON.parse((inbox.content[0] as { text: string }).text);
    expect(body.messages[0].content).toBe('run lint');

    const listed = await registry.execute(
      { id: '4', name: 'SendMessage', input: { action: 'list' } },
      ctx
    );
    expect((listed.content[0] as { text: string }).text).toContain(meta.team_id);
  });

  it('nested registry keeps SendMessage, strips TeamCreate', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    const nested = registryWithoutTask(registry);
    expect(nested.has('SendMessage')).toBe(true);
    expect(nested.has('TeamCreate')).toBe(false);
    expect(nested.has('Task')).toBe(false);
  });

  it('bootstrap registers 21 core tools', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    expect(registry.list()).toHaveLength(21);
    expect(registry.has('TeamCreate')).toBe(true);
    expect(registry.has('SendMessage')).toBe(true);
  });
});

describe('J2 PermissionMode on tools', () => {
  it('TeamCreate is DEFAULT', () => {
    const registry = new ToolRegistry();
    registerTeamTools(registry);
    expect(registry.get('TeamCreate')?.permissionMode).toBe(PermissionMode.DEFAULT);
    expect(registry.get('SendMessage')?.permissionMode).toBe(PermissionMode.DEFAULT);
  });
});
