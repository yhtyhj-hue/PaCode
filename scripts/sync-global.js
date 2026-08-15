#!/usr/bin/env node
/**
 * sync:global — copy dist/cli to the global @sallon/pacode install so the
 * `pacode` command picks up the latest build without `npm install -g`.
 *
 * Idempotent: skips when global isn't installed.
 * Override target: `npm run sync:global -- --target /custom/path/to/pacode`
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const targetArgIdx = args.indexOf('--target');
const targetDir =
  targetArgIdx >= 0 && args[targetArgIdx + 1]
    ? args[targetArgIdx + 1]
    : join(process.env.HOME ?? '', '.nvm/versions/node', 'v' + process.version.slice(1), 'lib/node_modules/@sallon/pacode');

const srcDir = join(process.cwd(), 'dist', 'cli');
if (!existsSync(srcDir)) {
  console.error('dist/cli not found — run `npm run build` first.');
  process.exit(1);
}
if (!existsSync(targetDir)) {
  console.error(`Target ${targetDir} does not exist.`);
  console.error('Pass --target <dir> to specify a custom global install location.');
  process.exit(1);
}

const targetCliDir = join(targetDir, 'dist', 'cli');
mkdirSync(targetCliDir, { recursive: true });

function walkAndCopy(fromDir, toDir) {
  for (const entry of readdirSync(fromDir)) {
    const from = join(fromDir, entry);
    const to = join(toDir, entry);
    const s = statSync(from);
    if (s.isDirectory()) {
      mkdirSync(to, { recursive: true });
      walkAndCopy(from, to);
    } else if (s.isFile()) {
      copyFileSync(from, to);
    }
  }
}

// Clean stale files in target that no longer exist in source
function pruneExtras(fromDir, toDir) {
  if (!existsSync(toDir)) return;
  for (const entry of readdirSync(toDir)) {
    const from = join(fromDir, entry);
    const to = join(toDir, entry);
    if (!existsSync(from)) {
      rmSync(to, { recursive: true, force: true });
    } else if (statSync(from).isDirectory() && statSync(to).isDirectory()) {
      pruneExtras(from, to);
    }
  }
}

walkAndCopy(srcDir, targetCliDir);
pruneExtras(srcDir, targetCliDir);

// Also copy bin/pacode.js entry (root bin shim)
const srcBin = join(process.cwd(), 'bin', 'pacode.js');
const targetBin = join(targetDir, 'bin', 'pacode.js');
if (existsSync(srcBin) && existsSync(dirname(targetBin))) {
  mkdirSync(dirname(targetBin), { recursive: true });
  copyFileSync(srcBin, targetBin);
  try {
    execSync(`chmod 755 ${targetBin}`);
  } catch {}
}

const fileCount = readdirSync(targetCliDir).length;
console.log(`synced ${fileCount} entries → ${targetDir}`);