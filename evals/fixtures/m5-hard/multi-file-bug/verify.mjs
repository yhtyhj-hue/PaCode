import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const math = await import(pathToFileURL(join(process.cwd(), 'src/math.js')).href);
const stats = await import(pathToFileURL(join(process.cwd(), 'src/stats.js')).href);

if (math.mul(3, 4) !== 12) {
  console.error('mul(3,4) expected 12, got', math.mul(3, 4));
  process.exit(1);
}
if (stats.mean([2, 4, 6]) !== 4) {
  console.error('mean([2,4,6]) expected 4, got', stats.mean([2, 4, 6]));
  process.exit(1);
}
if (JSON.stringify(stats.scale([1, 2], 3)) !== JSON.stringify([3, 6])) {
  console.error('scale broken', stats.scale([1, 2], 3));
  process.exit(1);
}
console.log('ok');
