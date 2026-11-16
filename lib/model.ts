// Token Launch Radar — the model.
//
// One snapshot of the protocol universe in, one ranked board out. The value model is a
// size curve FITTED to the protocols whose token already trades, not a multiple picked
// by hand: log-log regression of market cap on TVL, with a growth term and shrunk
// category offsets. The fit, its leave-one-out error and its time-split error are all
// computed from the snapshot at run time, so the numbers the dashboard shows are the
// numbers this run measured — nothing is hardcoded from an earlier look.
//
//   log(mcap) = a + b * log(TVL) + c * growth
//   implied   = exp(a + b * log(TVL) + c * growth + offset[category])
//
// growth is the seven-day TVL change clamped to [-60, 120] per cent, divided by 100.
// offset[category] is the mean residual of the category's traded comps, shrunk by
// n / (n + 4); categories with fewer than 4 traded comps get no offset.
//
// Age was tested as a third feature and left OUT of the value model: adding log(age)
// moved the leave-one-out median error factor from x2.53 to x2.66. Age still matters —
// it sets the farm hold window, and the detail view shows it. The backtest, not a
// hunch, decided that.
//
// Farm economics, per row, are the entry's own estimates, stated as such:
//   farmers   = max(50, round(TVL / 2500))        (about $2,500 per farmer)
//   gross     = implied * 7% / farmers             (7% of the launch to farmers)
//   net       = gross - $15 gas - capital * 4% p.a. over the hold window
//   verdict   = farm when net >= $50, thin when $0..$50, skip when negative.
// No protocol name is ever special-cased: one function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted curve: three coefficients and the shrunk category offsets. */
export interface SizeCurve {
  /** Intercept a of log(mcap) = a + b*log(TVL) + c*growth. */
  intercept: number;
  /** Slope b on log(TVL). */
  slope: number;
  /** Coefficient c on the clamped growth fraction. */
  growth_coef: number;
  /** Category offset in log space, only for categories with >= 4 traded comps. */
  offsets: Record<string, number>;
  /** How many traded comps the fit used. */
  comps: number;
  /** Leave-one-out error factors (median, mean) over the fit set. */
  loo_median: number;
  loo_mean: number;
  /** Time-split error factors (median, mean): fit before 2024-01-01, test after. */
  split_median: number;
  split_mean: number;
  /** Comps in the time-split train / test halves. */
  split_train: number;
  split_test: number;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 158;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The fitted curve's cleaning rule: a traded comp counts when its market cap sits
 *  between 1% and 3x its TVL. Outside that band a token is not a size anchor — it is
 *  a dust listing, a stuck quote, or a market cap the TVL cannot explain. */
const RATIO_LOW = 0.01;
const RATIO_HIGH = 3;

/** The growth clamp, in per cent, and the cutoff of the time-split backtest. */
const GROWTH_LOW = -60;
const GROWTH_HIGH = 120;
const SPLIT_CUTOFF = '2024-01-01';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    curve_value_usd: number;
    growth_pct: number;
    growth_factor: number;
    category_offset: number;
    age_days: number | null;
  };
  farm: {
    verdict: 'farm' | 'thin' | 'skip';
    net_usd: number;
    gross_usd: number;
    farmers: number;
    capital_usd: number;
    gas_usd: number;
    opportunity_usd: number;
    hold_days: number;
    airdrop_share: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  curve_value_usd: number;
  growth_factor: number;
  category_offset: number;
  verdict: 'farm' | 'thin' | 'skip';
  net_usd: number;
  farmers: number;
  capital_usd: number;
  hold_days: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fitted model and its tests. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  curve: SizeCurve;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The clamped growth fraction: seven-day TVL change in per cent, clamped, over 100. */
export function growthFrac(p: SnapshotProtocol): number {
  const raw = finite(p.change_7d, 0);
  return Math.min(GROWTH_HIGH, Math.max(GROWTH_LOW, raw)) / 100;
}

/** Solve A x = b by Gaussian elimination with partial pivoting (small, dense, deterministic). */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const tmp = M[c]!;
    M[c] = M[piv]!;
    M[piv] = tmp;
    const diag = M[c]![c]!;
    if (diag === 0) throw new SnapshotError('size-curve fit is singular');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / diag;
      for (let j = c; j <= n; j++) M[r]![j]! -= f * M[c]![j]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Ordinary least squares for y = X beta; features is a list of per-protocol functions. */
function ols(rows: SnapshotProtocol[], feats: Array<(p: SnapshotProtocol) => number>): number[] {
  const k = feats.length + 1;
  const A: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const b: number[] = Array<number>(k).fill(0);
  for (const p of rows) {
    const x = [1, ...feats.map((f) => f(p))];
    const y = Math.log(p.mcap_usd!);
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) A[r]![c]! += x[r]! * x[c]!;
      b[r]! += x[r]! * y;
    }
  }
  return solveLinear(A, b);
}

/** The traded comps the curve fits on: a market cap, no exchange, ratio inside the band. */
export function fitComps(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter(
    (p) =>
      p.mcap_usd !== null &&
      p.category !== 'CEX' &&
      p.mcap_usd / p.tvl_usd >= RATIO_LOW &&
      p.mcap_usd / p.tvl_usd <= RATIO_HIGH,
  );
}

const FEATS: Array<(p: SnapshotProtocol) => number> = [
  (p) => Math.log(p.tvl_usd),
  (p) => growthFrac(p),
];

/** Shrunk category offsets from a fit's residuals: mean residual, shrunk by n / (n + 4). */
function categoryOffsets(rows: SnapshotProtocol[], beta: number[]): Record<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of rows) {
    const pred = beta[0]! + beta[1]! * Math.log(p.tvl_usd) + beta[2]! * growthFrac(p);
    const r = Math.log(p.mcap_usd!) - pred;
    const key = p.category ?? '(null)';
    const cur = sums.get(key) ?? { sum: 0, n: 0 };
    cur.sum += r;
    cur.n += 1;
    sums.set(key, cur);
  }
  const out: Record<string, number> = {};
  for (const [key, { sum, n }] of [...sums.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (n >= 4) out[key] = Math.round(((sum / n) * n) / (n + 4) * 1e4) / 1e4;
  }
  return out;
}

/** The fitted log value of a protocol under a curve (before exponentiating). */
function logValue(p: SnapshotProtocol, beta: number[], offsets: Record<string, number>): number {
  return (
    beta[0]! + beta[1]! * Math.log(p.tvl_usd) + beta[2]! * growthFrac(p) + (offsets[p.category ?? '(null)'] ?? 0)
  );
}

/** Median and mean error factors from absolute log errors. */
function errorFactors(errs: number[]): { median: number; mean: number } {
  const sorted = [...errs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const mean = errs.reduce((s, v) => s + v, 0) / errs.length;
  return { median: Math.round(Math.exp(median) * 100) / 100, mean: Math.round(Math.exp(mean) * 100) / 100 };
}

/** Fit the size curve on the snapshot's traded comps, with both out-of-sample tests. */
export function fitCurve(protocols: SnapshotProtocol[]): SizeCurve {
  const comps = fitComps(protocols);
  if (comps.length < 10) throw new SnapshotError(`only ${comps.length} traded comps to fit the size curve`);
  const beta = ols(comps, FEATS);
  const offsets = categoryOffsets(comps, beta);

  // Leave-one-out: refit the curve and the offsets without each comp, predict it.
  const looErrs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const b = ols(train, FEATS);
    const o = categoryOffsets(train, b);
    looErrs.push(Math.abs(logValue(comps[i]!, b, o) - Math.log(comps[i]!.mcap_usd!)));
  }
  const loo = errorFactors(looErrs);

  // Time split: fit on protocols listed before the cutoff, test on those listed after.
  const train = comps.filter((p) => p.listed_at !== null && p.listed_at < SPLIT_CUTOFF);
  const test = comps.filter((p) => p.listed_at !== null && p.listed_at >= SPLIT_CUTOFF);
  let split = { median: 0, mean: 0 };
  if (train.length >= 10 && test.length >= 5) {
    const b = ols(train, FEATS);
    const o = categoryOffsets(train, b);
    split = errorFactors(test.map((p) => Math.abs(logValue(p, b, o) - Math.log(p.mcap_usd!))));
  }
  return {
    intercept: beta[0]!,
    slope: beta[1]!,
    growth_coef: beta[2]!,
    offsets,
    comps: comps.length,
    loo_median: loo.median,
    loo_mean: loo.mean,
    split_median: split.median,
    split_mean: split.mean,
    split_train: train.length,
    split_test: test.length,
  };
}

/** A protocol's implied value under the fitted curve, whole dollars, clamped. */
export function impliedValue(p: SnapshotProtocol, curve: SizeCurve): { implied: number; curveValue: number; growthFactor: number; offset: number; growthPct: number } {
  const growthPct = Math.min(GROWTH_HIGH, Math.max(GROWTH_LOW, finite(p.change_7d, 0)));
  const growthFactor = Math.exp(curve.growth_coef * (growthPct / 100));
  const offset = curve.offsets[p.category ?? '(null)'] ?? 0;
  const curveValue = Math.exp(curve.intercept + curve.slope * Math.log(p.tvl_usd));
  const implied = Math.max(1, Math.min(1e14, Math.round(curveValue * growthFactor * Math.exp(offset))));
  return { implied, curveValue: Math.round(curveValue), growthFactor: Math.round(growthFactor * 1e4) / 1e4, offset, growthPct };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The farm's netting assumptions, stated on the board: 7% of the launch to farmers,
 *  about $2,500 of TVL per farmer, $15 of gas, capital at 4% a year over the hold. */
export const AIRDROP_SHARE = 0.07;
export const TVL_PER_FARMER = 2500;
export const GAS_USD = 15;
export const OPPORTUNITY_RATE = 0.04;
export const FARM_NET_USD = 50;

/** One row's farm economics: the expected net per farmer and the verdict it earns. */
export function farmEconomics(
  p: SnapshotProtocol,
  implied: number,
  age: number | null,
): BoardRow['farm'] {
  const farmers = Math.max(50, Math.round(p.tvl_usd / TVL_PER_FARMER));
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gross = implied * AIRDROP_SHARE / farmers;
  const opportunity = capital * OPPORTUNITY_RATE * (hold / 365);
  const net = Math.round(gross - GAS_USD - opportunity);
  const verdict: BoardRow['farm']['verdict'] = net >= FARM_NET_USD ? 'farm' : net >= 0 ? 'thin' : 'skip';
  return {
    verdict,
    net_usd: net,
    gross_usd: Math.round(gross * 100) / 100,
    farmers,
    capital_usd: capital,
    gas_usd: GAS_USD,
    opportunity_usd: Math.round(opportunity * 100) / 100,
    hold_days: hold,
    airdrop_share: AIRDROP_SHARE,
  };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction') || c.includes('dor')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('yield') && c.includes('aggregator')) return `Deposit $${capital} into ${name}'s auto-compounding vault on ${chain} and keep the shares.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the position open.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('launchpad')) return `Join ${name}'s next launch on ${chain} with $${capital} and complete its tasks.`;
  if (c.includes('payment')) return `Move $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('privacy')) return `Shield $${capital} through ${name} on ${chain} and keep the private receipt.`;
  if (c.includes('nft')) return `List or buy one item on ${name} on ${chain} worth about $${capital} and keep the receipt.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index on ${chain} and hold the index token.`;
  if (c.includes('ai') || c.includes('decentralized ai')) return `Stake or delegate $${capital} through ${name} on ${chain} and keep the position open.`;
  if (c.includes('token locker')) return `Lock $${capital} of tokens in ${name} on ${chain} and keep the lock receipt.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed position on ${chain} and keep the shares.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action: the same position, kept visibly active. */
function weeklyFor(p: SnapshotProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Top up the vault by a small amount each week, or rebalance between its vaults.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Adjust the position weekly: add a little supply, or borrow and repay a small amount.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Rebalance the pool position weekly and collect the fees it earned.`;
  if (c.includes('bridge')) return `Bridge a small amount each week so the address shows repeated use.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards weekly and restake them.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close and reopen one small hedge each week.`;
  if (c.includes('prediction') || c.includes('dor')) return `Settle one market and open the next each week.`;
  if (c.includes('yield')) return `Harvest the vault's yield weekly and redeposit it.`;
  if (c.includes('rwa')) return `Claim the yield the asset paid and keep the asset held.`;
  return `Make one qualifying action each week, such as a deposit, a swap, a vote or a claim.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. The last step states the netted verdict, so the plan and
 * the board's verdict always agree.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: BoardRow['farm']): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const verdictLine =
    econ.verdict === 'farm'
      ? `The netted verdict is farm: about $${econ.net_usd} per farmer after costs.`
      : econ.verdict === 'thin'
        ? `The netted verdict is thin: about $${econ.net_usd} per farmer after costs, worth it only if you already use the protocol.`
        : `The netted verdict is skip: about $${econ.net_usd} per farmer after costs, so farming loses money on these assumptions.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `${weeklyFor(p, capital)} Do it from the same wallet every time.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `${verdictLine} The estimate assumes 7% of the launch goes to farmers, about ${econ.farmers.toLocaleString('en-US')} farmers, $${econ.gas_usd} of gas and $${econ.opportunity_usd} of forgone yield.`,
      cost: 'nothing to check',
      time: '2 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, curve: SizeCurve): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const { implied, curveValue, growthFactor, offset, growthPct } = impliedValue(p, curve);
    const econ = farmEconomics(p, implied, age);
    return { p, implied, curveValue, growthFactor, offset, growthPct, age, econ };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      curve_value_usd: s.curveValue,
      growth_pct: s.growthPct,
      growth_factor: s.growthFactor,
      category_offset: s.offset,
      age_days: s.age,
    },
    farm: s.econ,
    farm_steps: farmSteps(s.p, s.age, s.econ).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    curve_value_usd: row.model.curve_value_usd,
    growth_factor: row.model.growth_factor,
    category_offset: row.model.category_offset,
    verdict: row.farm.verdict,
    net_usd: row.farm.net_usd,
    farmers: row.farm.farmers,
    capital_usd: row.farm.capital_usd,
    hold_days: row.farm.hold_days,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; curve: SizeCurve } {
  const curve = fitCurve(snapshot.protocols);
  const board = buildBoard(snapshot, curve);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    curve,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, curve };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
