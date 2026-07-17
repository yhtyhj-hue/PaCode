import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const testFile = join(process.cwd(), 'test/parse.test.mjs');
if (!existsSync(testFile)) {
  console.error('missing test/parse.test.mjs');
  process.exit(1);
}
try {
  execFileSync(process.execPath, [testFile], { stdio: 'inherit' });
} catch {
  process.exit(1);
}
console.log('ok');
