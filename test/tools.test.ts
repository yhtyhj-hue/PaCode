/**
 * Tool Registry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolDefinition, PermissionMode } from '../src/pkg/types.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves tools', () => {
    const tool: ToolDefinition = {
      name: 'TestTool',
      description: 'test',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.DEFAULT,
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    };
    registry.register(tool);
    expect(registry.get('TestTool')).toBeTruthy();
  });

  it('lists all registered tools', () => {
    registry.register({
      name: 'Tool1',
      description: '',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.DEFAULT,
      async execute() {
        return { content: [] };
      },
    });
    registry.register({
      name: 'Tool2',
      description: '',
      inputSchema: {},
      concurrencySafe: false,
      permissionMode: PermissionMode.DEFAULT,
      async execute() {
        return { content: [] };
      },
    });
    expect(registry.list().length).toBe(2);
  });

  it('unregisters tools', () => {
    registry.register({
      name: 'Removable',
      description: '',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.DEFAULT,
      async execute() {
        return { content: [] };
      },
    });
    expect(registry.has('Removable')).toBe(true);
    registry.unregister('Removable');
    expect(registry.has('Removable')).toBe(false);
  });
});
