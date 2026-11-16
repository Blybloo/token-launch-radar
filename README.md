# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/blybloo/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/blybloo/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Pre-token protocols ranked by what their size says a token would be worth — a size curve fitted to the protocols whose token already trades, tested out of sample, with every row's farm plan netted to the dollar.

## What it does

- Reads a frozen DefiLlama-style snapshot of 758 protocols and ranks the 40 watchlist protocols (TVL ≥ $50M, no token) plus the 158 strongest pre-token protocols below the floor, by fitted implied value.
- The value model is a log-log regression of market cap on TVL, with a seven-day growth term and shrunk category offsets, fitted at run time on the traded comps (market cap between 1% and 3× TVL, no exchanges). Age was tested as a feature and left out — it made the leave-one-out error worse.
- The board shows both out-of-sample tests: leave-one-out and a time split (fit before 2024, tested after).
- Every row carries a farm plan netted to the dollar: 7% of the implied launch value is assumed to go to farmers, split across an estimated farmer count (one per $2,500 of TVL, at least 50), minus $15 of gas and the yield the capital gives up at 4% a year over the hold. Farm when the net is $50 or more per farmer, thin from $0 to $50, skip when negative.
- The dashboard is static (no network, no fetch): it recomputes each row's implied value and farm plan from the fitted curve itself, so the detail view can say whether the recomputation matches the board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22 or newer, standard library only, no network. The run is deterministic: two runs write byte-identical output, and the program checks its own output against the gate before it reports success.

## Layout

- `main.ts` — entrypoint: read the snapshot, fit, rank, write the output, self-check the gate.
- `lib/model.ts` — the fitted size curve, the farm economics, the farm plans and the board builder.
- `lib/validate.ts` — the gate self-check (board shape, dashboard caps, no-network rule, screenshots, dossier bytes).
- `vendor/makefun-board.ts` — the make.fun board library, unchanged from the competition kit; it writes `dossier.json`.
- `dashboard/` — the static dashboard (`index.html`, `app.css`, `app.js`).
- `screenshots/` — the three screenshots the dossier carries: the board, a detail view and a filtered view.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
