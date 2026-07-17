import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const src = readFileSync(join(process.cwd(), 'src/greet.js'), 'utf-8');
if (!/function\s+formatName\b/.test(src)) {
  console.error('expected formatName helper after refactor');
  process.exit(1);
}
const mod = await import(pathToFileURL(join(process.cwd(), 'src/greet.js')).href);
if (mod.hello('Ada') !== 'Hello, Ada!') {
  console.error('hello broken');
  process.exit(1);
}
if (mod.bye('') !== 'Bye, friend!') {
  console.error('bye broken');
  process.exit(1);
}
console.log('ok');
