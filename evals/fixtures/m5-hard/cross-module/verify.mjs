import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const store = await import(pathToFileURL(join(process.cwd(), 'src/store.js')).href);
const format = await import(pathToFileURL(join(process.cwd(), 'src/format.js')).href);

const user = store.getUser();
if (typeof user?.name !== 'string' || typeof user?.age !== 'number') {
  console.error('getUser must return { name: string, age: number }, got', user);
  process.exit(1);
}
const text = format.label(user);
if (text !== 'Ada Lovelace (36)') {
  console.error('label expected "Ada Lovelace (36)", got', text);
  process.exit(1);
}
console.log('ok');
