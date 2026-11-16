// The gate, run locally before anything is submitted: the same shapes the sealed
// scorer checks, in the same order. main.ts calls this after writing /output; a
// non-empty list of issues stops the run with a non-zero exit.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { boardIssue, type BoardRow, type Snapshot } from './model.ts';
import { buildDossier } from '../vendor/makefun-board.ts';

const TEXT_MAX_BYTES = 65_536;
const MAX_SCREENSHOT_BYTES = 524_288;
const MAX_DASHBOARD_FILES = 400;
const MAX_DASHBOARD_BYTES = 4_194_304;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const HTTP_IN_ATTR = /<[^>]+(?:href|src|action|poster|background|cite|data|formaction)\s*=\s*["']https?:\/\//i;
const HTTP_IN_STYLE = /<style[^>]*>[\s\S]*?https?:\/\//i;
const HTTP_IN_CSS = /https?:\/\//;
const HTTP_IN_JS_IMPORT = /(?:import\s+(?:[^'"]+\s+from\s+)?|export\s+(?:[^'"]+\s+from\s+)?|require\s*\(\s*|import\s*\()\s*["']https?:\/\//;

/** A PNG's dimensions from its IHDR chunk, or null when the bytes are not a PNG. */
function pngSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

/** A JPEG's dimensions from its first SOF marker, or null when the bytes are not a JPEG. */
function jpegSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** Every issue the output directory has, empty when the gate would pass it. */
export function validateOutput(out: string, board: BoardRow[], snapshot: Snapshot): string[] {
  const issues: string[] = [];

  // board.json: the file main.ts wrote, read back and checked again.
  const boardPath = join(out, 'board.json');
  if (!existsSync(boardPath)) {
    issues.push('board.json is missing');
    return issues;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(boardPath, 'utf8'));
  } catch {
    issues.push('board.json is not JSON');
    return issues;
  }
  const rows = (parsed as { rows?: unknown }).rows ?? parsed;
  if (!Array.isArray(rows)) issues.push('board.json has no rows array');
  else {
    if (rows.length < 100 || rows.length > 4000) issues.push(`board.json has ${rows.length} rows, outside 100..4000`);
    if (readFileSync(boardPath).length > 8 * 1024 * 1024) issues.push('board.json is over 8 MiB');
  }
  const issue = boardIssue(board, snapshot);
  if (issue !== null) issues.push(`board: ${issue}`);

  // dashboard/: files, caps, and the no-network rule.
  const dashDir = join(out, 'dashboard');
  if (!existsSync(dashDir)) {
    issues.push('dashboard/ is missing');
  } else {
    const names: string[] = [];
    let bytes = 0;
    const stack: string[] = [''];
    while (stack.length > 0) {
      const rel = stack.pop()!;
      for (const e of readdirSync(rel === '' ? dashDir : join(dashDir, rel), { withFileTypes: true })) {
        const p = rel === '' ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name.startsWith('.')) issues.push(`dashboard/${p} is a dot-directory`);
          else stack.push(p);
        } else if (e.isFile()) {
          if (!PLAIN_NAME.test(e.name)) issues.push(`dashboard/${p} has a bad name`);
          names.push(p);
          bytes += lstatSync(join(dashDir, p)).size;
        } else {
          issues.push(`dashboard/${p} is neither a file nor a directory`);
        }
      }
    }
    if (names.length > MAX_DASHBOARD_FILES) issues.push(`dashboard/ holds ${names.length} files, over ${MAX_DASHBOARD_FILES}`);
    if (bytes > MAX_DASHBOARD_BYTES) issues.push(`dashboard/ is ${bytes} bytes, over ${MAX_DASHBOARD_BYTES}`);
    if (!names.includes('index.html')) issues.push('dashboard/ has no index.html');
    if (!names.some((n) => n.endsWith('.css'))) issues.push('dashboard/ has no .css file');
    if (!names.some((n) => n.endsWith('.js'))) issues.push('dashboard/ has no .js file');
    for (const n of names) {
      const text = readFileSync(join(dashDir, n), 'utf8');
      if (n.endsWith('.html') && (HTTP_IN_ATTR.test(text) || HTTP_IN_STYLE.test(text))) issues.push(`dashboard/${n} names an http(s) address`);
      if (n.endsWith('.css') && HTTP_IN_CSS.test(text)) issues.push(`dashboard/${n} names an http(s) address`);
      if (n.endsWith('.js') && HTTP_IN_JS_IMPORT.test(text)) issues.push(`dashboard/${n} imports an http(s) address`);
    }
  }

  // screenshots/: 3 or 4 whole images, within the byte and dimension caps.
  const shotsDir = join(out, 'screenshots');
  if (!existsSync(shotsDir)) {
    issues.push('screenshots/ is missing');
  } else {
    const shots = readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort();
    if (shots.length < 3 || shots.length > 4) issues.push(`screenshots/ holds ${shots.length} images, need 3 or 4`);
    for (const name of shots) {
      if (!PLAIN_NAME.test(name)) { issues.push(`screenshots/${name} has a bad name`); continue; }
      const bytes = readFileSync(join(shotsDir, name));
      if (bytes.length > MAX_SCREENSHOT_BYTES) issues.push(`screenshots/${name} is ${bytes.length} bytes, over ${MAX_SCREENSHOT_BYTES}`);
      const size = pngSize(bytes) ?? jpegSize(bytes);
      if (size === null) issues.push(`screenshots/${name} is neither a whole PNG nor a JPEG`);
      else {
        const long = Math.max(size.w, size.h);
        const short = Math.min(size.w, size.h);
        if (long > 1440) issues.push(`screenshots/${name} is ${size.w}x${size.h}, long side over 1440`);
        if (short < 800) issues.push(`screenshots/${name} is ${size.w}x${size.h}, short side under 800`);
      }
    }
  }

  // dossier.json: byte for byte what the vendored library writes from this /output.
  const dossierPath = join(out, 'dossier.json');
  if (!existsSync(dossierPath)) {
    issues.push('dossier.json is missing');
  } else {
    let expected: Uint8Array;
    try {
      expected = buildDossier(out, {
        text_max_bytes: TEXT_MAX_BYTES,
        screenshots: { max: 4, max_bytes: MAX_SCREENSHOT_BYTES },
        dashboard: { max_files: MAX_DASHBOARD_FILES, max_bytes: MAX_DASHBOARD_BYTES },
      });
    } catch (err) {
      issues.push(`dossier: ${(err as Error).message}`);
      return issues;
    }
    const actual = readFileSync(dossierPath);
    if (actual.length > 1.5 * 1024 * 1024) issues.push(`dossier.json is ${actual.length} bytes, over 1.5 MiB`);
    if (Buffer.compare(actual, Buffer.from(expected)) !== 0) issues.push('dossier.json is not what buildDossier writes from this /output');
  }
  return issues;
}
