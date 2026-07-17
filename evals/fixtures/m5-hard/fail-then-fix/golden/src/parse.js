export function parseQuery(input) {
  if (input == null || input === '') return {};
  const out = {};
  for (const part of String(input).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}
