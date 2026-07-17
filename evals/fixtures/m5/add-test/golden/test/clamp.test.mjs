import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const { clamp } = await import(pathToFileURL(join(process.cwd(), 'src/clamp.js')).href);
if (clamp(5, 0, 10) !== 5) throw new Error('mid');
if (clamp(-1, 0, 10) !== 0) throw new Error('low');
if (clamp(99, 0, 10) !== 10) throw new Error('high');
console.log('tests ok');
