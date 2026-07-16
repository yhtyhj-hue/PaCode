/**
 * J2: TeamCreate + SendMessage — 最小多代理消息总线
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { getTeamStore } from '../services/team/index.js';
import type { TeamMember } from '../services/team/index.js';

export function registerTeamTools(registry: { register: (t: ToolDefinition) => void }): void {
  registry.register({
    name: 'TeamCreate',
    description:
      'Create a named team with members for multi-agent collaboration. Use SendMessage to pass work between members. Not a prefetch worker pool.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name' },
        description: { type: 'string', description: 'Optional team goal' },
        members: {
          type: 'array',
          description: 'Members: [{ name, role, subagent_type? }]',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              subagent_type: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
      required: ['name', 'members'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { name, description, members: rawMembers } = input as {
        name: string;
        description?: string;
        members: Array<{ name: string; role?: string; subagent_type?: string }>;
      };

      const members: TeamMember[] = (rawMembers ?? []).map((m) => ({
        name: m.name,
        role: m.role ?? 'worker',
        subagentType: m.subagent_type,
      }));

      const result = getTeamStore().create({ name, description, members });
      if (!result.ok) {
        return { content: [{ type: 'text', text: result.error }], isError: true };
      }

      const { team } = result;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                team_id: team.id,
                name: team.name,
                description: team.description,
                members: team.members,
                hint: 'Use SendMessage with this team_id. Subagents may receive via action=receive.',
              },
              null,
              2
            ),
          },
        ],
      };
    },
  });

  registry.register({
    name: 'SendMessage',
    description:
      'Send or receive team messages. action=send (default) delivers content; action=receive drains inbox; action=list summarizes teams.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['send', 'receive', 'list'],
          description: 'send | receive | list (default send)',
        },
        team_id: { type: 'string' },
        from: { type: 'string', description: 'Sender member name (send) or inbox owner (receive)' },
        to: { type: 'string', description: 'Recipient member name or * for broadcast' },
        content: { type: 'string' },
        mark_read: {
          type: 'boolean',
          description: 'When receiving, mark messages read (default true)',
        },
      },
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        action = 'send',
        team_id: teamId,
        from,
        to,
        content,
        mark_read: markRead,
      } = input as {
        action?: 'send' | 'receive' | 'list';
        team_id?: string;
        from?: string;
        to?: string;
        content?: string;
        mark_read?: boolean;
      };

      const store = getTeamStore();

      if (action === 'list') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(store.list(), null, 2),
            },
          ],
        };
      }

      if (!teamId) {
        return {
          content: [{ type: 'text', text: 'team_id required for send/receive' }],
          isError: true,
        };
      }

      if (action === 'receive') {
        if (!from) {
          return {
            content: [{ type: 'text', text: 'from (inbox member) required for receive' }],
            isError: true,
          };
        }
        const result = store.receive(teamId, from, { markRead });
        if (!result.ok) {
          return { content: [{ type: 'text', text: result.error }], isError: true };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { team_id: teamId, member: from, messages: result.messages },
                null,
                2
              ),
            },
          ],
        };
      }

      // send
      if (!from || !to) {
        return {
          content: [{ type: 'text', text: 'from and to required for send' }],
          isError: true,
        };
      }
      const result = store.send({
        teamId,
        from,
        to,
        content: content ?? '',
      });
      if (!result.ok) {
        return { content: [{ type: 'text', text: result.error }], isError: true };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                delivered: true,
                delivered_count: result.delivered,
                message_id: result.message.id,
                team_id: teamId,
                from: result.message.from,
                to: to === '*' ? '*' : result.message.to,
              },
              null,
              2
            ),
          },
        ],
      };
    },
  });
}
