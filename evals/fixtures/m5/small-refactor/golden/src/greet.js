function formatName(name) {
  return String(name ?? '').trim() || 'friend';
}

export function hello(name) {
  return `Hello, ${formatName(name)}!`;
}

export function bye(name) {
  return `Bye, ${formatName(name)}!`;
}
