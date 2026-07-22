/**
 * 剪贴板图片读取（macOS / Linux 尽力而为；失败返回 null）
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX_BYTES = 5 * 1024 * 1024;

export interface ClipboardImage {
  mediaType: string;
  data: string; // base64
}

function mimeFromMagic(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 6 && buf.slice(0, 4).toString() === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** 从剪贴板取图；无图或失败 → null */
export function tryReadClipboardImage(): ClipboardImage | null {
  try {
    if (process.platform === 'darwin') return readMacClipboardImage();
    if (process.platform === 'linux') return readLinuxClipboardImage();
  } catch {
    return null;
  }
  return null;
}

function readMacClipboardImage(): ClipboardImage | null {
  const path = join(tmpdir(), `pacode-clip-${randomBytes(6).toString('hex')}.png`);
  try {
    // PNG class from pasteboard → file
    execFileSync(
      'osascript',
      [
        '-e',
        `set png_data to the clipboard as «class PNGf»\nset f to open for access POSIX file "${path}" with write permission\nwrite png_data to f\nclose access f`,
      ],
      { timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (!existsSync(path)) return null;
    const buf = readFileSync(path);
    unlinkSync(path);
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    const mediaType = mimeFromMagic(buf) ?? 'image/png';
    return { mediaType, data: buf.toString('base64') };
  } catch {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* ignore */
    }
    return null;
  }
}

function readLinuxClipboardImage(): ClipboardImage | null {
  try {
    let buf: Buffer;
    try {
      buf = execFileSync('wl-paste', ['-t', 'image/png'], {
        timeout: 2000,
        maxBuffer: MAX_BYTES,
      });
    } catch {
      buf = execFileSync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], {
        timeout: 2000,
        maxBuffer: MAX_BYTES,
      });
    }
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const mediaType = mimeFromMagic(buf) ?? 'image/png';
    return { mediaType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

/** 粘贴路径若是本地图片文件则加载 */
export function tryLoadImageFromPastedPath(text: string): ClipboardImage | null {
  const path = text.trim().replace(/^['"]|['"]$/g, '');
  if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) return null;
  if (!existsSync(path)) return null;
  try {
    const buf = readFileSync(path);
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    const mediaType = mimeFromMagic(buf);
    if (!mediaType) return null;
    return { mediaType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}
