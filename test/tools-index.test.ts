import { describe, it, expect } from 'vitest';
import * as tools from '../src/tools/index.js';
import { ToolRegistry } from '../src/tools/registry.js';

describe('tools index exports', () => {
  it('exports core registration helpers', () => {
    expect(typeof tools.registerCoreTools).toBe('function');
    expect(typeof tools.setupToolRegistry).toBe('function');
    expect(typeof tools.getToolRegistry).toBe('function');
  });

  it('registerCoreTools wires registry', () => {
    const registry = new ToolRegistry();
    tools.registerCoreTools(registry);
    expect(registry.has('Read')).toBe(true);
    expect(registry.has('Bash')).toBe(true);
  });
});
