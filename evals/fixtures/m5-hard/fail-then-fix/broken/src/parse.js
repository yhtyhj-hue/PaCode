export function parseQuery(input) {
  if (input == null || input === '') return {};
  const out = {};
  // BUG: 用逗号分割，且不 trim
  for (const part of String(input).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
