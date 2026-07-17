import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const mod = await import(pathToFileURL(join(process.cwd(), 'src/add.js')).href);
const { add } = mod;
if (add(2, 3) !== 5) {
  console.error('add(2,3) expected 5, got', add(2, 3));
  process.exit(1);
}
if (add(-1, 1) !== 0) {
  console.error('add(-1,1) expected 0');
  process.exit(1);
}
console.log('ok');
