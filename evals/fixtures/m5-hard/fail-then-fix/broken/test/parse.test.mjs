import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const { parseQuery } = await import(
  pathToFileURL(join(process.cwd(), 'src/parse.js')).href
);

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`${label}: expected ${e}, got ${a}`);
    process.exit(1);
  }
}

assertEqual(parseQuery(''), {}, 'empty');
assertEqual(parseQuery('a=1;b=2'), { a: '1', b: '2' }, 'basic');
assertEqual(parseQuery('a=1;a=9'), { a: '9' }, 'override');
assertEqual(parseQuery(' x = 1 ; y = 2 '), { x: '1', y: '2' }, 'trim');
console.log('parse tests ok');
