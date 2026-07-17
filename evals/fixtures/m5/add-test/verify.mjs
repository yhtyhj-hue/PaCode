import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const testFile = join(process.cwd(), 'test/clamp.test.mjs');
if (!existsSync(testFile)) {
  console.error('missing test/clamp.test.mjs');
  process.exit(1);
}
execFileSync(process.execPath, [testFile], { stdio: 'inherit' });
console.log('ok');
