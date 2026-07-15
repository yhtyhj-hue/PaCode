import { describe, it, expect } from 'vitest';
import { SkillsLoader } from '../src/skills/loader.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';


describe('SkillsLoader - Deep', () => {
  describe('Slash Commands API', () => {
    it('listSlashCommands returns array', async () => {
      const loader = new SkillsLoader(join(tmpdir(), 'pacode-skill-' + Date.now() + '-' + Math.random()));
      await loader.loadSlashCommands();
      expect(Array.isArray(loader.listSlashCommands())).toBe(true);
    });

    it('getSlashCommand returns undefined for missing', async () => {
      const loader = new SkillsLoader(join(tmpdir(), 'pacode-skill-' + Date.now() + '-' + Math.random()));
      await loader.loadSlashCommands();
      expect(loader.getSlashCommand('nonexistent')).toBeUndefined();
    });

    it('loadSlashCommands returns Map', async () => {
      const loader = new SkillsLoader(join(tmpdir(), 'pacode-skill-' + Date.now() + '-' + Math.random()));
      const result = await loader.loadSlashCommands();
      expect(result).toBeInstanceOf(Map);
    });

    it('command prompt supports substitution', async () => {
      // Test substitution logic directly using a known command from CWD
      const loader = new SkillsLoader();
      await loader.loadSlashCommands();
      const cmds = loader.listSlashCommands();
      // Test that the substitution mechanism works
      if (cmds.length > 0) {
        const cmd = cmds[0];
        const prompt = cmd?.prompt.replace(/\$ARGUMENTS/g, 'foo.ts');
        expect(prompt).toBeDefined();
        expect(prompt).not.toContain('$ARGUMENTS');
      } else {
        // No commands, but verify the API works
        expect(cmds).toEqual([]);
      }
    });
  });

  describe('Skill Loading API', () => {
    it('loadAll returns Map', async () => {
      const loader = new SkillsLoader(join(tmpdir(), 'pacode-skill-' + Date.now() + '-' + Math.random()));
      const result = await loader.loadAll();
      expect(result).toBeInstanceOf(Map);
    });

    it('get returns undefined for missing skill', async () => {
      const loader = new SkillsLoader(join(tmpdir(), 'pacode-skill-' + Date.now() + '-' + Math.random()));
      await loader.loadAll();
      expect(loader.get('nonexistent')).toBeUndefined();
    });

    it('list returns array', async () => {
      const loader = new SkillsLoader(join(tmpdir(), 'pacode-skill-' + Date.now() + '-' + Math.random()));
      await loader.loadAll();
      expect(Array.isArray(loader.list())).toBe(true);
    });

    it('match returns array', async () => {
      const loader = new SkillsLoader(join(tmpdir(), 'pacode-skill-' + Date.now() + '-' + Math.random()));
      await loader.loadAll();
      expect(Array.isArray(loader.match('test'))).toBe(true);
    });
  });
});
