export function hello(name) {
  const n = String(name ?? '').trim() || 'friend';
  return `Hello, ${n}!`;
}

export function bye(name) {
  const n = String(name ?? '').trim() || 'friend';
  return `Bye, ${n}!`;
}
