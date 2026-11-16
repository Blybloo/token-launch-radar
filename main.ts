// Token Launch Radar's program (Node 22, standard library only).
//
// Reads the sealed snapshot, fits the size curve on the protocols whose token already
// trades, ranks every pre-token protocol by the fitted implied value, and writes the
// ranked board, the dashboard's data, the dashboard itself, its three screenshots and
// the dossier the judge reads — then checks its own output against the gate before
// it reports success.
//
//   node main.ts --input <snapshot.json|directory> [--output <dir>]
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// In the grader the snapshot is /input/snapshot.json and the output is /output. The
// run is fully deterministic: no clock, no randomness, every tie broken by slug, so
// two runs write identical bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { validateOutput } from './lib/validate.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** One --flag <value> (or --flag=<value>) out of the arguments, else `fallback`. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar, curve } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping names that start with a dot. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

// Then the run checks its own output against the gate, exactly as the scorer would.
const problems = validateOutput(out, board, snapshot);
if (problems.length > 0) {
  for (const p of problems) process.stderr.write(`token radar: gate: ${p}\n`);
  process.exit(1);
}

const farm = board.filter((r) => r.farm.verdict === 'farm').length;
const thin = board.filter((r) => r.farm.verdict === 'thin').length;
const skip = board.filter((r) => r.farm.verdict === 'skip').length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: size curve on ${curve.comps} traded comps: log(mcap) = ${curve.intercept.toFixed(4)} + ${curve.slope.toFixed(4)}*log(TVL) + ${curve.growth_coef.toFixed(4)}*growth\n` +
    `token radar: out-of-sample leave-one-out x${curve.loo_median} (median) / x${curve.loo_mean} (mean); time-split x${curve.split_median} (median) / x${curve.split_mean} (mean)\n` +
    `token radar: verdicts farm ${farm}, thin ${thin}, skip ${skip}; wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard, ${shots.length} screenshots and ${join(out, 'dossier.json')}\n` +
    `token radar: gate self-check passed\n`,
);
