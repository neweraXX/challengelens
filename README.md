# ChallengeLens

Check whether the timing of a Polymarket/UMA oracle proposal is supported now, before posting a bond.

Built for OpenServ SERV Hackathon 02, Reppo + Open tracks. Current procedure: **timing-v8 / gate-v8**.

In a selected sample of disputed UMA requests from 2022–2026, 266 of 598 settled with UMA's `TOO_EARLY` value. This is not the base rate across all proposals. Source: [public sample aggregates](web/public/data/stats.json).

## Try it

Hosted app: `https://challengelens.onrender.com`. It runs on Render's free plan, so the first request after idle time can take about a minute while the service wakes; the Live desk then refreshes about every three minutes. Three things to try in about two minutes:

1. Open **Live desk** (`/live`). Check the snapshot time, proposals in challenge windows, bonds and missing evidence. Open a row's rules and evidence.
2. Open **Check a market** (`/check`). Paste any Polymarket event or market URL, choose the market and proposed side, then check timing. Unsupported rules return a hold for evidence; a pasted URL does not guarantee support.
3. Open **Braves replay** (`https://challengelens.onrender.com/cases/timing-1cb1c22e47ea5596f03eb22a`). Drag the proposal past the feed's final mark. Dragging is a local preview; a fresh SERV re-check needs the hosted service's key and creates a receipt.

Home (`/`) animates **How it decides**. Historical replay (`/cases`) contains 12 cases. Benchmark (`/benchmark`) and API (`/api`) expose the measurements and integration details.

## How it decides

Three checks must line up for **Proceed**, using the checks applicable to the market:

1. **SERV reads the rules.** It quotes the governing clause and copies the stated local date, time and timezone into `decisive_local`. The app converts that clock to UTC in code.
2. **Code checks the cutoff.** Templates cover supported crypto candles and instants, observation windows, and Up/Down intervals. Estimated sports durations never prove completion.
3. **Evidence checks the event as of the proposal.** Sports use Polymarket's `finishedTimestamp`; supported price-touch markets use Binance 1-minute candles. Missing or ambiguous required evidence prevents Proceed. Fixed observations can pass their timing cutoff without proving the proposed outcome.

Read the authoritative **`action`**, rather than a model verdict in isolation:

| Action | Meaning |
| --- | --- |
| `PROCEED` | The timing checks pass. Outcome correctness is still unchecked. |
| `WAIT` | Too early under the timing check; `earliest_utc` is supplied when a fixed earliest time is known. Check again then. |
| `NEED_EVIDENCE` | `needs` and readable `need_details` list what must be confirmed. |
| `HOLD_FOR_REVIEW` | An independent review holds a previous Proceed. Reppo never upgrades an action. |

Receipts record SHA-256 packet, evidence, procedure and receipt hashes, model, gate version, proposal time and SERV request ID when returned. They preserve the inputs and decision for inspection; hashes do not certify the source facts. See [receipt format](src/gate/receipt.ts).

## What we measured

Blind test 2: **60 new cases × 3 readings**, 28 too early and 32 timing-OK; `gemini-3.1-flash-lite`, timing-v8 / gate-v8. Counts below use **case-majority** decisions; repeats are not independent samples. Intervals use Wilson 95%.

| Arm | False approvals / too early | Correct / all | Held for evidence / all | Proceed precision; coverage |
| --- | --- | --- | --- | --- |
| Model alone | 15/28 | 42/60 | 0/60 | — |
| SERV alone | 19/28 | 39/60 | 1/60 | — |
| Model + checks | 0/28 | 24/60 | 36/60 | — |
| SERV + checks | **0/28** | **22/60** | **37/60** | **14/14; 14/32 (44%)** |
| Checks only, no model | **0/28** | **23/60** | **37/60** | **15/15; 15/32** |

For 0/28 false approvals, the Wilson 95% upper bound is **12.1%**, not zero risk. SERV enabled no Proceed unavailable to checks alone and blocked one. All 360/360 calls completed; one SERV output was format-invalid, so the run's status is `incomplete`. Raw-model cost was $0.22; the API does not report SERV cost.

Blind test 1: 30 unseen cases × 3, timing-v5 / gate-v2. Model alone approved 5/12 too-early cases with a majority; SERV alone 9/15; SERV + checks 0/15 (95% upper bound 20.4%), 15/30 correct, 13/30 held for evidence and 30/30 consistent.

Second look at that same set after adding evidence keys (**not blind**): SERV + checks remained 15/30 correct and 0/15 false approvals, with Proceed precision 3/3 and coverage 3/15.

**The zero-false-approval result comes from deterministic checks.** Both SERV alone and the raw model approve many too-early proposals. These results do not show SERV improving accuracy over code + evidence. Source: [aggregate results](web/public/data/sealed.json).

### Where each number comes from

| Claim | Source in this repo |
| --- | --- |
| 266 of 598 sampled disputed requests settled TOO_EARLY | `web/public/data/stats.json` |
| Blind test 1 and 2 results, intervals, call counts | `eval/sealed/*/report.md`, `eval/sealed2/*/report.md`, `web/public/data/sealed.json` |
| Valid / invalid model outputs per arm | `eval/sealed*/*/validity.json` |
| Development-set reruns (12/24, 7/24, 6/24, 31/45) | `eval/runs/*/report.md`, `eval/runs/*/regated-report.md`, `procedures/changes.jsonl` |
| Reppo critique scores 51 and 59 | `eval/reppo/*/summary.md` |
| Sports feed coverage (176 of 613) | `eval/reports/feed-coverage-2026-11-14.json` |
| Feed final mark after the proposal (30-331 s), 10 events | `eval/reports/feed-lag-observation-2026-11-14.json` |
| Live desk counts | `eval/reports/live-desk-snapshots-2026-11-14.json` |

## Where SERV Reasoning fits

SERV is the semantic reader of free-text rules: a governing-clause quote, a structured local clock, and an explanation. Requests use strict `json_schema` and `max_tokens: 8000`. The application validates outputs, converts the local clock, and applies the gate separately.

SERV produced 98%+ valid structured outputs: 90/90 in blind test 1 and 179/180 in blind test 2. The raw model had 10/90 invalid outputs in test 1. This structured interface lets the checks operate on free-text rules across supported markets; it does not establish timing accuracy or universal market coverage. See [prompt](src/judge/prompt.ts) and [client](src/judge/client.ts).

## Reppo

Reppo's evaluator panel reviews saved verdicts with `taskType: response`. Critiques scored 51 and 59 led to timing-v5: a self-consistency check and a ban on treating Gamma `endDate` as game completion. The before/after record is in [procedures/changes.jsonl](procedures/changes.jsonl).

On the development set, SERV-alone dangerous approvals changed from 12/24 to 7/24 on the first rerun and 6/24 on the second. Treat that as unproven, noise-level improvement; gated accuracy stayed 27/45. A completed Reppo review can hold Proceed on route `block`, decision `reject`, or route `review` with score <70. It can never upgrade. See [review policy](src/reppo/policy.ts).

The hold has fired on a real review. On 2026-11-15 the panel reviewed a Proceed receipt (Ethereum Up or Down, 3PM ET, proposed 3 s after the candle closed) and scored it 52, route `review`, which turned the action into `HOLD_FOR_REVIEW`. The panel noted that the response never quoted the rules' finalization wording and gave no margin context. We added both, plus a scope line, to the review input (`reppo-format-2`), and the same case scored 69, still `review`, so it is still held. One review per format and widely disagreeing evaluators (score spread about 21): an observation, not a measured improvement. Both results: [live-review-2026-11-15.json](eval/reppo/live-review-2026-11-15.json); Reppo evaluations are public by eval id.

## Limits and honesty

- Labels are UMA settlement outcomes: adjudication proxies, not ground truth about timing. Development and blind-test sets are small. Proceed coverage was 44% (14/32) on blind test 2.
- `PROCEED` checks timing only, not whether YES/NO is correct. The desk never recommends disputing or posts a bond.
- Sports feed lag of 30–331 seconds was observed. Negative feed inferences require a margin **greater than 30 minutes**; that policy is not a proven maximum feed delay. Period and Over/Yes line markets need scope-specific evidence.
- Live desk observations on 2026-11-14 are recorded in [live-desk-snapshots-2026-11-14.json](eval/reports/live-desk-snapshots-2026-11-14.json): 380 proposals and about 163,000 USDC in bonds at 05:18 UTC, 244 and 63,000 USDC at 11:03 UTC; 0 likely-too-early flags in each; at 05:21 UTC 49 proposals confirmed on time by the feed (median 3.6 seconds after its final mark) and 20 SERV readings, all Proceed with checks agreeing. Most proposals (238 of 244 at 11:03 UTC) had no deterministic key: period and line markets, games without a feed final mark, unsupported rules. These are dated observations, not current counts or a claim of no timing errors.
- Of 613 sports events closed in a roughly nine-hour window, 176 (29%) had a completion timestamp. See [feed coverage report](eval/reports/feed-coverage-2026-11-14.json).
- The desk screens proposals from known Polymarket requesters about every three minutes, with a global collection cap of 800 rows across two deployments. Check freshness and `totals.truncated`; a code screen is not a SERV reading of every row.
- Pasted-market checks use Gamma's **current** question and description. Live desk checks use the proposal's on-chain ancillary text; Gamma supplies identity and scheduling. Current metadata can differ from historical rules.

## Run it yourself

Docker Compose, from this directory:

```sh
dc() { docker compose -f compose.web.yml "$@"; }
mkdir -p node_modules web/node_modules web/dist .cache/live .cache/evidence .cache/receipts   # bind-mount points on a fresh clone
dc build offline
dc run --rm offline
dc run --rm web-build
LIVE_DESK=0 dc up app
```

Open `http://localhost:8080`. The first image build needs package-download access. Offline tests, web build and saved replay need **no keys**; the `offline` and `web-build` services disable networking. Dragging replay timelines spends no inference calls. `LIVE_DESK=0` disables background collection for this run.

| Service / operation | Keys needed |
| --- | --- |
| `offline`, `web-build`, `regate`, `benchmark`, `reppo-loop` | None |
| `evidence` | None; `POLYMARKET_PROXY` only where direct Polymarket access fails |
| `infer`; supported fresh checks in `app`; SERV reads in `live-once` | `SERV_API_KEY` |
| `pilot-eval`, `sealed-eval` | `SERV_API_KEY` for SERV arm; `OPENROUTER_API_KEY` for raw arm |
| `reppo-dev`; optional second opinions in `app` | `REPPO_API_KEY` |

The desk's deterministic screen can run without SERV, but then cannot provide new SERV-confirmed actions. `app` does not need an OpenRouter key. See [REPRODUCE](docs/REPRODUCE.md) for saved-run commands, call budgets and the one-shot sealed-evaluation restriction. [render.yaml](render.yaml) configures hosting with `Dockerfile.deploy`; enter keys only in the hosting dashboard.

## API

Use the same origin as the app. Resolve a URL, select a returned `markets[].id` and outcome, then check:

```sh
BASE='http://localhost:8080' # or replace with https://challengelens.onrender.com
curl -sS "$BASE/api/market/resolve" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://polymarket.com/event/<EVENT_SLUG>"}'

curl -sS "$BASE/api/market/check" \
  -H 'Content-Type: application/json' \
  --data '{"market_id":"<MARKET_ID>","proposed_side":"YES"}'

curl -sS "$BASE/api/live"

RECEIPT_ID='<RECEIPT_ID>'
curl -sS "$BASE/api/receipts/$RECEIPT_ID"
```

`POST /api/market/check` accepts `YES`, `NO`, or a zero-based outcome index for `proposed_side`. Optional `check_time_utc` is ISO UTC; pasted-market checks round to the start of that minute. Omit it to check now. Supported uncached checks need SERV.

Check responses expose `action`, `needs`, optional `earliest_utc`, and a saved `receipt`. Receipt lookup is `GET /api/receipts/:id`. Inspect readable `need_details` in the decision/receipt. `GET /api/live` reads a snapshot and triggers no inference; inspect `generated_at`, `stale`, `enabled`, `totals` and each item's optional `action`. Missing action is not Proceed. Full integration view: `/api`.

## Repo map

| Path | Purpose |
| --- | --- |
| `src/judge/` | SERV/model requests, schema, prompt and validation |
| `src/gate/` | Cutoffs, actions, evidence requirements and receipts |
| `src/evidence/` | Sports/price evidence and proposal-time views |
| `src/live/` | Challenge-window collection and desk screening |
| `src/reppo/` | Evaluator client and hold policy |
| `src/api/server.ts`, `web/` | API and demo pages |
| `scripts/`, `compose.web.yml` | Reproduction and reporting commands |
| `web/public/data/sealed.json`, `eval/reports/` | Published aggregates and coverage reports |
| `procedures/changes.jsonl`, `docs/` | Critique/change record and submission documents |

## Licence and disclaimer

[MIT](LICENSE), copyright 2026 ChallengeLens contributors.

Independent project; not affiliated with Polymarket, UMA, OpenServ or Reppo. Timing checks only. Not financial advice.
