// Token Radar's dashboard: a static page, no framework, no network, no fetch.
// Everything it shows comes from data.js — the fitted curve, the ranked rows and the
// live set — and the page recomputes each row's implied value and farm plan from the
// curve itself, so the detail view can say, in words, whether the recomputation
// matches the board. The same assumptions as the builder (7% to farmers, about
// $2,500 of TVL per farmer, $15 of gas, 4% a year over the hold) are written here
// and in lib/model.ts, and both sides produce the same steps.

'use strict';

/* ---------- small helpers ---------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
function usd(n) {
  if (n === null || n === undefined) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function compactUsd(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return usd(n);
}
function pct(n) {
  if (n === null || n === undefined) return '—';
  const s = n > 0 ? '+' : '';
  return s + n.toFixed(1) + '%';
}
function ageLabel(days) {
  if (days === null || days === undefined) return '—';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return (days / 365).toFixed(1) + 'y';
}

/* ---------- the model, recomputed in the page ---------- */

const DATA = window.RADAR;
if (!DATA || !Array.isArray(DATA.rows)) throw new Error('data.js did not load: RADAR is missing');
const CURVE = DATA.curve;
const BY_SLUG = new Map(DATA.rows.map((r) => [r.slug, r]));

function growthFrac(row) {
  const raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
  return Math.min(120, Math.max(-60, raw)) / 100;
}
function curveValueUsd(row) {
  return Math.exp(CURVE.intercept + CURVE.slope * Math.log(row.tvl_usd));
}
function impliedOf(row) {
  const offset = CURVE.offsets[row.category || '(null)'] || 0;
  const v = curveValueUsd(row) * Math.exp(CURVE.growth_coef * growthFrac(row)) * Math.exp(offset);
  return Math.max(1, Math.min(1e14, Math.round(v)));
}
function capitalFor(row) {
  if (row.tvl_usd >= 5e9) return 250;
  if (row.tvl_usd >= 1e9) return 150;
  if (row.tvl_usd >= 1e8) return 100;
  return 50;
}
function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function farmEconomics(row) {
  const farmers = Math.max(50, Math.round(row.tvl_usd / 2500));
  const capital = capitalFor(row);
  const hold = holdDaysFor(row.age_days);
  const gross = row.implied_value_usd * 0.07 / farmers;
  const opportunity = capital * 0.04 * (hold / 365);
  const net = Math.round(gross - 15 - opportunity);
  return { farmers, capital, hold, gross, opportunity, net, verdict: net >= 50 ? 'farm' : net >= 0 ? 'thin' : 'skip' };
}
function chainOf(row) {
  return row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
}
function actionFor(row, capital, chain) {
  const c = (row.category || '').toLowerCase();
  const name = row.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
  if (c.includes('bridge')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
  if (c.includes('staking') || c.includes('restak')) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
  if (c.includes('prediction') || c.includes('dor')) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
  if (c.includes('stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
  if (c.includes('rwa')) return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
  if (c.includes('yield') && c.includes('aggregator')) return 'Deposit $' + capital + ' into ' + name + '\'s auto-compounding vault on ' + chain + ' and keep the shares.';
  if (c.includes('yield')) return 'Deposit $' + capital + ' into ' + name + '\'s highest-yield vault on ' + chain + ' and keep the position open.';
  if (c.includes('insurance')) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
  if (c.includes('launchpad')) return 'Join ' + name + '\'s next launch on ' + chain + ' with $' + capital + ' and complete its tasks.';
  if (c.includes('payment')) return 'Move $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
  if (c.includes('privacy')) return 'Shield $' + capital + ' through ' + name + ' on ' + chain + ' and keep the private receipt.';
  if (c.includes('nft')) return 'List or buy one item on ' + name + ' on ' + chain + ' worth about $' + capital + ' and keep the receipt.';
  if (c.includes('index')) return 'Buy $' + capital + ' of ' + name + '\'s index on ' + chain + ' and hold the index token.';
  if (c.includes('ai') || c.includes('decentralized ai')) return 'Stake or delegate $' + capital + ' through ' + name + ' on ' + chain + ' and keep the position open.';
  if (c.includes('token locker')) return 'Lock $' + capital + ' of tokens in ' + name + ' on ' + chain + ' and keep the lock receipt.';
  if (c.includes('liquidity manager')) return 'Deposit $' + capital + ' into a ' + name + ' managed position on ' + chain + ' and keep the shares.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}
function weeklyFor(row) {
  const c = (row.category || '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'Top up the vault by a small amount each week, or rebalance between its vaults.';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Adjust the position weekly: add a little supply, or borrow and repay a small amount.';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'Rebalance the pool position weekly and collect the fees it earned.';
  if (c.includes('bridge')) return 'Bridge a small amount each week so the address shows repeated use.';
  if (c.includes('staking') || c.includes('restak')) return 'Claim the staking rewards weekly and restake them.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'Close and reopen one small hedge each week.';
  if (c.includes('prediction') || c.includes('dor')) return 'Settle one market and open the next each week.';
  if (c.includes('yield')) return 'Harvest the vault\'s yield weekly and redeposit it.';
  if (c.includes('rwa')) return 'Claim the yield the asset paid and keep the asset held.';
  return 'Make one qualifying action each week, such as a deposit, a swap, a vote or a claim.';
}
function stepText(text, cost, time) {
  let s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
  return s;
}
function farmSteps(row, econ) {
  const chain = chainOf(row);
  const capital = econ.capital;
  const hold = econ.hold;
  const verdictLine = econ.verdict === 'farm'
    ? 'The netted verdict is farm: about $' + econ.net + ' per farmer after costs.'
    : econ.verdict === 'thin'
      ? 'The netted verdict is thin: about $' + econ.net + ' per farmer after costs, worth it only if you already use the protocol.'
      : 'The netted verdict is skip: about $' + econ.net + ' per farmer after costs, so farming loses money on these assumptions.';
  return [
    stepText('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
    stepText(actionFor(row, capital, chain), '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', '15 minutes to set up'),
    stepText(weeklyFor(row) + ' Do it from the same wallet every time.', 'about $2 of gas a week', '10 minutes a week'),
    stepText('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'),
    stepText('Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', 'no fee to check, and never pay to claim', '10 minutes'),
    stepText('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes'),
    stepText(verdictLine + ' The estimate assumes 7% of the launch goes to farmers, about ' + econ.farmers.toLocaleString('en-US') + ' farmers, $15 of gas and $' + econ.opportunity.toFixed(2) + ' of forgone yield.', 'nothing to check', '2 minutes'),
  ];
}

/* ---------- state ---------- */

const WATCH = new Set(DATA.watchlist || []);
const state = { q: '', category: '', verdict: 'all', watchOnly: false, sort: 'rank', selected: null };

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  state.q = h.get('q') || '';
  state.category = h.get('category') || '';
  state.verdict = h.get('verdict') || 'all';
  state.watchOnly = h.get('watch') === '1';
  state.sort = h.get('sort') || 'rank';
  return h.get('p');
}
function writeHash(p) {
  const h = new URLSearchParams();
  if (state.q) h.set('q', state.q);
  if (state.category) h.set('category', state.category);
  if (state.verdict !== 'all') h.set('verdict', state.verdict);
  if (state.watchOnly) h.set('watch', '1');
  if (state.sort !== 'rank') h.set('sort', state.sort);
  if (p) h.set('p', p);
  const s = h.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname);
}

/* ---------- the page ---------- */

const shell = document.querySelector('main');
const dialog = document.createElement('dialog');
dialog.className = 'detail';
dialog.setAttribute('aria-label', 'Protocol detail');
shell.after(dialog);

const counts = { farm: 0, thin: 0, skip: 0 };
for (const r of DATA.rows) counts[r.verdict]++;
const maxImplied = DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1;

function verdictBadge(v) {
  const s = el('span', 'verdict ' + v, v);
  return s;
}

function renderShell() {
  shell.textContent = '';
  const wrap = el('div', 'shell');
  shell.append(wrap);

  const top = el('div', 'top');
  const brand = el('div', 'brand');
  brand.append(el('span', 'mark'));
  brand.append(el('span', 'brand-name', 'Token Radar'));
  top.append(brand);
  const meta = el('div', 'top-meta');
  meta.append(el('span', null, 'Snapshot ' + DATA.as_of));
  meta.append(el('span', null, 'Source: ' + DATA.source));
  meta.append(el('span', null, 'Model ' + DATA.model_version));
  top.append(meta);
  wrap.append(top);

  const lede = el('div', 'lede');
  lede.append(el('h1', null, 'Pre-token protocols, ranked by what their size says a token would be worth.'));
  const ledeP = el('p', null,
    'The ranking is not a multiple picked by hand. A size curve is fitted to the ' + CURVE.comps +
    ' protocols whose token already trades, then every pre-token protocol is scored by it. ' +
    'The curve is tested twice, on the board below, so the error you see is measured, not claimed. ' +
    'Each row also carries a farm plan netted to the dollar: expected airdrop share per farmer, minus gas and the yield the capital gives up while it is locked.');
  lede.append(ledeP);
  wrap.append(lede);

  const facts = el('div', 'facts');
  const factData = [
    ['Watchlist', String(DATA.watchlist_size), 'protocols at or above the ' + compactUsd(DATA.floor_usd) + ' floor'],
    ['Board', DATA.board_size + ' rows', DATA.early_size + ' early protocols below the floor'],
    ['Leave-one-out error', '×' + CURVE.loo_median.toFixed(2), 'median factor; mean ×' + CURVE.loo_mean.toFixed(2) + ' over ' + CURVE.comps + ' comps'],
    ['Time-split error', '×' + CURVE.split_median.toFixed(2), 'median factor; fit before 2024, tested after (' + CURVE.split_test + ' comps)'],
  ];
  for (const [k, v, s] of factData) {
    const f = el('div', 'fact');
    f.append(el('span', null, k));
    f.append(el('b', null, v));
    f.append(el('small', null, s));
    facts.append(f);
  }
  wrap.append(facts);

  // Controls.
  const controls = el('div', 'controls');
  const qField = el('div', 'field');
  qField.append(el('label', null, 'Search'));
  const q = el('input');
  q.type = 'search';
  q.placeholder = 'name or slug';
  q.value = state.q;
  q.setAttribute('aria-label', 'Search by name or slug');
  q.addEventListener('input', () => { state.q = q.value.trim(); writeHash(); renderTable(); });
  qField.append(q);
  controls.append(qField);

  const catField = el('div', 'field');
  catField.append(el('label', null, 'Category'));
  const cat = el('select');
  cat.setAttribute('aria-label', 'Filter by category');
  cat.append(new Option('All categories', ''));
  const cats = [...new Set(DATA.rows.map((r) => r.category).filter(Boolean))].sort();
  for (const c of cats) cat.append(new Option(c, c));
  cat.value = state.category;
  cat.addEventListener('change', () => { state.category = cat.value; writeHash(); renderTable(); });
  catField.append(cat);
  controls.append(catField);

  const vField = el('div', 'field');
  vField.append(el('span', 'sub', 'Farm verdict'));
  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Filter by farm verdict');
  for (const [v, label] of [['all', 'All (' + DATA.rows.length + ')'], ['farm', 'Farm (' + counts.farm + ')'], ['thin', 'Thin (' + counts.thin + ')'], ['skip', 'Skip (' + counts.skip + ')']]) {
    const b = el('button', null, label);
    b.setAttribute('aria-pressed', state.verdict === v ? 'true' : 'false');
    b.addEventListener('click', () => {
      state.verdict = v;
      writeHash();
      for (const x of tabs.querySelectorAll('button')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      renderTable();
    });
    tabs.append(b);
  }
  vField.append(tabs);
  controls.append(vField);

  const watch = el('label', 'check');
  const watchBox = document.createElement('input');
  watchBox.type = 'checkbox';
  watchBox.checked = state.watchOnly;
  watchBox.addEventListener('change', () => { state.watchOnly = watchBox.checked; writeHash(); renderTable(); });
  watch.append(watchBox, document.createTextNode('Watchlist only'));
  controls.append(watch);

  const sortField = el('div', 'field');
  sortField.append(el('label', null, 'Sort'));
  const sort = el('select');
  sort.setAttribute('aria-label', 'Sort the board');
  for (const [v, label] of [['rank', 'Rank'], ['implied', 'Implied value'], ['tvl', 'TVL'], ['net', 'Net per farmer']]) sort.append(new Option(label, v));
  sort.value = state.sort;
  sort.addEventListener('change', () => { state.sort = sort.value; writeHash(); renderTable(); });
  sortField.append(sort);
  controls.append(sortField);
  wrap.append(controls);

  const panel = el('section', 'panel');
  panel.setAttribute('aria-label', 'Ranked board');
  wrap.append(panel);

  const livePanel = el('section', 'panel');
  livePanel.setAttribute('aria-label', 'Live tokens');
  const liveH = el('h2', null, 'Live tokens — the comps the curve was fitted on');
  livePanel.append(liveH);
  livePanel.append(el('p', 'note', 'The ' + CURVE.comps + ' traded protocols the size curve learns from, shown here by market cap. Their market caps are the curve\'s ground truth; the board above is its prediction for the protocols that have not launched yet.'));
  const liveWrap = el('div', 'table-wrap');
  const liveTable = el('table');
  liveTable.append(el('caption', 'sub', DATA.live_size + ' largest live-token protocols by market cap'));
  const liveHead = el('thead');
  liveHead.innerHTML = '<tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th><th class="num">7d</th></tr>';
  liveTable.append(liveHead);
  const liveBody = el('tbody');
  for (const p of DATA.live) {
    const tr = el('tr');
    const nameTd = el('td', 'name');
    nameTd.append(el('b', null, p.name), el('span', 'sub', p.slug));
    tr.append(nameTd, el('td', null, p.category || '—'), el('td', 'num', compactUsd(p.tvl_usd)), el('td', 'num', compactUsd(p.mcap_usd)), el('td', 'num', p.mcap_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) : '—'));
    const ch = el('td', 'num ' + (p.change_7d > 0 ? 'pos' : p.change_7d < 0 ? 'neg' : ''), pct(p.change_7d));
    tr.append(ch);
    liveBody.append(tr);
  }
  liveTable.append(liveBody);
  liveWrap.append(liveTable);
  livePanel.append(liveWrap);
  wrap.append(livePanel);

  const model = el('section', 'panel model');
  model.setAttribute('aria-label', 'How the ranking is made');
  model.append(el('h2', null, 'How the ranking is made'));
  const formula = el('div', 'formula');
  formula.textContent =
    'log(mcap) = ' + CURVE.intercept.toFixed(4) + ' + ' + CURVE.slope.toFixed(4) + ' · log(TVL) + ' + CURVE.growth_coef.toFixed(4) + ' · growth\n' +
    'implied = exp(log(mcap) + offset[category])\n' +
    'growth = clamp(change_7d, -60, 120) / 100';
  model.append(formula);
  const stats = el('div', 'stats-grid');
  const statData = [
    ['Traded comps fitted', String(CURVE.comps), 'mcap in [1%, 3x] of TVL, no exchanges'],
    ['Leave-one-out', '×' + CURVE.loo_median.toFixed(2) + ' median', 'mean ×' + CURVE.loo_mean.toFixed(2) + '; refit without each comp'],
    ['Time-split', '×' + CURVE.split_median.toFixed(2) + ' median', 'mean ×' + CURVE.split_mean.toFixed(2) + '; fit before 2024, ' + CURVE.split_test + ' tested'],
    ['Category offsets', Object.keys(CURVE.offsets).length + ' categories', 'mean residual, shrunk n/(n+4), n ≥ 4'],
  ];
  for (const [k, v, s] of statData) {
    const st = el('div', 'stat');
    st.append(el('span', null, k), el('b', null, v), el('span', null, s));
    stats.append(st);
  }
  model.append(stats);
  const how = el('div', null);
  how.innerHTML =
    '<p><strong>What the curve is.</strong> A log-log regression of market cap on TVL across the traded protocols, ' +
    'with a growth term for the seven-day TVL change and a shrunk offset per category. A protocol twice as large ' +
    'is not twice as valuable: the fitted slope is ' + CURVE.slope.toFixed(2) + ', so value grows slower than size.</p>' +
    '<p><strong>What was cleaned.</strong> A traded protocol counts as a comp only when its market cap sits between 1% and 3x its TVL. ' +
    'Outside that band the token is a dust listing, a stuck quote, or a market cap the TVL cannot explain — not an anchor. ' +
    'Exchanges are excluded: their market caps track trading volume, not locked value.</p>' +
    '<p><strong>What age does.</strong> Age was tested as a third feature and left out of the value model: it moved the leave-one-out ' +
    'median error from ×' + CURVE.loo_median.toFixed(2) + ' to ×2.66, so it made the fit worse. Age still sets the farm hold window ' +
    '(60 days under six months, 45 under a year, 30 after) and is shown on every row.</p>' +
    '<p><strong>What the farm verdict is.</strong> For each row: about 7% of the implied launch value is assumed to go to farmers, ' +
    'split across an estimated farmer count (one per $2,500 of TVL, at least 50), minus $15 of gas and the yield the capital ' +
    'gives up at 4% a year over the hold. Farm when the net is $50 or more per farmer, thin from $0 to $50, skip when negative. ' +
    'These are the entry\'s own estimates, stated as such — not a protocol\'s promise.</p>' +
    '<p><strong>What to be careful about.</strong> An implied value is a fitted estimate, not a price: the median comp is off by a factor of ' +
    '×' + CURVE.loo_median.toFixed(2) + ', so a row ranked at $6M could plausibly launch anywhere from $2M to $15M. Never pay to claim an ' +
    'airdrop, and only use the claim link the protocol itself publishes.</p>';
  model.append(how);
  wrap.append(model);

  const foot = el('p', 'note', 'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · board ' + DATA.board_size + ' rows (' + DATA.watchlist_size + ' watchlist, ' + DATA.early_size + ' early) · live set ' + DATA.live_size + ' rows · model ' + DATA.model_version);
  wrap.append(foot);
  renderTable();
}

function filteredRows() {
  let rows = DATA.rows.filter((r) => {
    if (state.q && !(r.name.toLowerCase().includes(state.q.toLowerCase()) || r.slug.includes(state.q.toLowerCase()))) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
    if (state.watchOnly && !WATCH.has(r.slug)) return false;
    return true;
  });
  const sorts = {
    rank: (a, b) => a.rank - b.rank,
    implied: (a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1),
    tvl: (a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1),
    net: (a, b) => b.net_usd - a.net_usd || (a.slug < b.slug ? -1 : 1),
  };
  rows = [...rows].sort(sorts[state.sort] || sorts.rank);
  return rows;
}

function renderTable() {
  const panel = document.querySelector('section.panel');
  panel.textContent = '';
  const rows = filteredRows();
  const head = el('div', null);
  head.append(el('h2', null, 'The board'));
  head.append(el('span', 'count', rows.length + ' of ' + DATA.rows.length + ' rows'));
  panel.append(head);
  if (rows.length === 0) {
    panel.append(el('p', 'empty', 'No rows match these filters.'));
    return;
  }
  const wrap = el('div', 'table-wrap');
  const table = el('table');
  table.append(el('caption', 'sub', 'Ranked by fitted implied value. Select a row for the model breakdown and farm plan.'));
  const thead = el('thead');
  thead.innerHTML = '<tr><th>#</th><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Implied value</th><th>Farm verdict</th><th class="num">Net / farmer</th></tr>';
  table.append(thead);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    tr.tabIndex = 0;
    tr.dataset.slug = r.slug;
    tr.setAttribute('data-selected', state.selected === r.slug ? 'true' : 'false');
    tr.setAttribute('aria-label', r.name + ', rank ' + r.rank + ', implied ' + compactUsd(r.implied_value_usd) + ', farm verdict ' + r.verdict);
    const open = () => openDetail(r.slug);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    tr.append(el('td', 'num', String(r.rank)));
    const nameTd = el('td', 'name');
    nameTd.append(el('b', null, r.name));
    nameTd.append(el('span', 'sub', r.slug));
    if (WATCH.has(r.slug)) nameTd.append(el('span', 'watch', 'WATCHLIST'));
    tr.append(nameTd);
    tr.append(el('td', null, r.category || '—'));
    tr.append(el('td', 'num', compactUsd(r.tvl_usd)));
    const ch = el('td', 'num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''), pct(r.change_7d));
    tr.append(ch);
    const imp = el('td', 'num');
    const impWrap = el('span', 'implied');
    const bar = el('span', 'bar');
    const fill = el('i');
    fill.style.width = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%';
    bar.append(fill);
    impWrap.append(bar, el('span', null, compactUsd(r.implied_value_usd)));
    imp.append(impWrap);
    tr.append(imp);
    const vTd = el('td');
    vTd.append(verdictBadge(r.verdict));
    tr.append(vTd);
    const net = el('td', 'num ' + (r.net_usd >= 50 ? 'pos' : r.net_usd < 0 ? 'neg' : ''), usd(r.net_usd));
    tr.append(net);
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  panel.append(wrap);
}

/* ---------- detail ---------- */

function openDetail(slug) {
  const row = BY_SLUG.get(slug);
  if (!row) return;
  state.selected = slug;
  writeHash(slug);
  const econ = farmEconomics(row);
  const recomputed = impliedOf(row);
  const offset = CURVE.offsets[row.category || '(null)'] || 0;
  const match = recomputed === row.implied_value_usd;
  dialog.textContent = '';
  const head = el('div', 'detail-head');
  const title = el('div');
  title.append(el('h2', null, row.name));
  const sub = el('div', 'sub');
  sub.textContent = 'Rank #' + row.rank + ' · ' + row.slug + ' · ' + (row.category || 'Uncategorised') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'no chain listed') + ' · ' + ageLabel(row.age_days) + ' old';
  title.append(sub);
  head.append(title);
  const close = el('button', 'close', 'Close');
  close.addEventListener('click', () => dialog.close());
  head.append(close);
  dialog.append(head);

  const val = el('div', 'detail-section');
  val.append(el('h3', null, 'Implied value'));
  const eq = el('div', 'equation');
  const eqData = [
    ['Curve value', usd(row.curve_value_usd), 'exp(' + CURVE.intercept.toFixed(4) + ' + ' + CURVE.slope.toFixed(4) + ' · log(TVL))'],
    ['Growth factor', '×' + row.growth_factor.toFixed(4), '7d ' + pct(row.change_7d) + ' clamped to ' + Math.min(120, Math.max(-60, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d)).toFixed(1) + '%'],
    ['Category offset', '×' + Math.exp(offset).toFixed(4), (row.category || 'Uncategorised') + ' offset ' + (offset >= 0 ? '+' : '') + offset.toFixed(4) + ' in log space'],
  ];
  for (const [k, v, s] of eqData) {
    const d = el('div');
    d.append(el('span', null, k), el('b', null, v), el('span', null, s));
    eq.append(d);
  }
  const total = el('div', 'wide');
  total.append(el('span', null, 'Implied value'), el('b', null, usd(row.implied_value_usd)), el('span', null, match ? 'Recomputed from the curve in this page: ' + usd(recomputed) + ' — matches the board.' : 'Recomputed from the curve in this page: ' + usd(recomputed) + ' — differs from the board by ' + usd(Math.abs(recomputed - row.implied_value_usd)) + '.'));
  eq.append(total);
  val.append(eq);
  dialog.append(val);

  const farm = el('div', 'detail-section');
  farm.append(el('h3', null, 'Farm economics'));
  const fgrid = el('div', 'equation');
  const fData = [
    ['Gross per farmer', usd(econ.gross), '7% of the launch, split across ~' + econ.farmers.toLocaleString('en-US') + ' farmers'],
    ['Gas', '$15', 'assumed, one position'],
    ['Forgone yield', usd(econ.opportunity), '$' + econ.capital + ' at 4% a year over ' + econ.hold + ' days'],
    ['Net per farmer', usd(econ.net), econ.verdict === 'farm' ? 'Farm: $50 or more after costs.' : econ.verdict === 'thin' ? 'Thin: $0 to $50 after costs.' : 'Skip: negative after costs.'],
  ];
  for (const [k, v, s] of fData) {
    const d = el('div');
    d.append(el('span', null, k), el('b', null, v), el('span', null, s));
    fgrid.append(d);
  }
  farm.append(fgrid);
  dialog.append(farm);

  const steps = el('div', 'detail-section');
  steps.append(el('h3', null, 'Farm plan — 7 steps'));
  const ol = el('ol', 'steps');
  for (const s of farmSteps(row, econ)) {
    const li = el('li');
    const costAt = s.lastIndexOf(' Cost: ');
    const timeAt = s.lastIndexOf(' Time: ');
    const main = costAt >= 0 ? s.slice(0, costAt) : s;
    const cost = costAt >= 0 ? s.slice(costAt + 7, timeAt >= 0 ? timeAt : s.length) : '';
    const time = timeAt >= 0 ? s.slice(timeAt + 7).replace(/\.$/, '') : '';
    li.append(document.createTextNode(main));
    li.append(el('span', 'cost', 'Cost: ' + cost + ' · Time: ' + time + '.'));
    ol.append(li);
  }
  steps.append(ol);
  steps.append(el('p', 'note', 'The plan is generated from this protocol\'s own record — its category, its chains, its TVL and its age — ' +
    'not from a hand-written list. Never pay to claim an airdrop, and only use the claim link the protocol itself publishes. ' +
    'The netted verdict is an estimate under the assumptions above, not a promise of a payout.'));
  dialog.append(steps);

  dialog.showModal();
  dialog.addEventListener('close', () => {
    state.selected = null;
    writeHash(null);
    renderTable();
  }, { once: true });
}

dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

/* ---------- boot ---------- */

const initial = readHash();
renderShell();
if (initial && BY_SLUG.has(initial)) openDetail(initial);
shell.setAttribute('aria-busy', 'false');
window.addEventListener('hashchange', () => {
  const p = readHash();
  renderShell();
  if (p && BY_SLUG.has(p)) openDetail(p);
});
