# ChallengeLens demo — 2:30

Use the eight beats below. Live numbers must match the screen at recording time. Dated reference snapshots are in `eval/reports/live-desk-snapshots-2026-11-14.json` (e.g. 244 proposals, 63,000 USDC in bonds, 238 without a deterministic key, zero likely-too-early flags at 11:03 UTC). Label any frozen capture with its date; do not present it as current.

| Time | What is on screen | Voice-over line |
| --- | --- | --- |
| 0:00–0:18 | Home; sample statistic, then the How it decides animation. | “ChallengeLens checks proposal timing before an operator posts a bond. Of 598 sampled disputed UMA requests, 266 settled TOO_EARLY. This is a selected sample, not the rate across all proposals.” |
| 0:18–0:40 | Live desk; show generation time, freshness, proposal/bond totals, feed-confirmed count, SERV-read count, flags and missing keys. Read the current totals. | “The desk screens proposals in their challenge windows about every three minutes. Here are [current proposal count] proposals and [current bond total] USDC in bonds. Missing keys remain unresolved. A feed screen and a SERV reading are separate; zero flags does not prove there are no premature proposals.” |
| 0:40–1:03 | `/check`; paste a real, currently open Polymarket URL; choose market and side; run Check timing. Show quoted clause, local clock converted to UTC, code cutoff, evidence and action. | “Paste a market, choose a side and check now. SERV quotes the rule and copies its local clock; code converts it to UTC. Code checks the cutoff, and required event evidence must agree. The action says Proceed, Wait, or what evidence is still needed.” |
| 1:03–1:28 | Braves replay; show original WAIT and feed final mark. Drag past 2025-09-17 03:36:14.500 UTC; show Local only (drag). Click the SERV re-check control; wait for Fresh SERV check, receipt and Proceed. | “This Braves proposal came before the feed's final mark. Dragging past the feed's final mark changes only the local preview. Now I request a fresh SERV reading at this proposal time. With SERV and the completion evidence agreeing, the action becomes Proceed. The receipt records the inputs and hashes.” |
| 1:28–1:51 | Benchmark, blind test 2. Show animation 19/28 SERV-alone false approvals → 0/28 SERV + checks. Keep checks-only row, 14/32 coverage and interval visible. | “On sixty new cases, SERV alone approved nineteen of twenty-eight too-early proposals. With checks: zero of twenty-eight, with a Wilson ninety-five percent upper bound of twelve point one percent. Checks alone also had zero. Deterministic checks produced this result; SERV did not improve accuracy. Proceed coverage was forty-four percent.” |
| 1:51–2:07 | Benchmark limits and missing-evidence action; highlight timing-only wording. | “Proceed checks timing, not whether the proposed outcome is correct. UMA settlements are proxy labels. Sports feeds lag, and missing evidence holds a check. The desk never recommends disputing. This is not financial advice.” |
| 2:07–2:22 | A real held receipt: run Reppo's second opinion on a Proceed receipt (e.g. the Ethereum Up or Down replay; about 3 minutes, 440 credits) and show score, route and the resulting Hold; the 2026-11-15 reviews (52, then 69 after the input format change) are in `eval/reppo/live-review-2026-11-15.json`. Show the recorded change in `procedures/changes.jsonl`. | “Reppo reviews saved verdicts. A block, rejection, or routed review scoring below seventy can hold Proceed; it never upgrades an action. On a real review the panel scored a Proceed at 52 and it was held; we added the missing context and the same case scored 69, still held. One review each, so this shows the loop works, not that accuracy improved.” |
| 2:22–2:30 | Home/API, then link card: app, repo, video. | “Try the Live desk, check a market, or drag a replay. The app, source, measurements and receipts are linked here.” |

## Shot list

Replace `<HOSTED_URL>` with the deployed origin. Local equivalent: `http://localhost:8080`.

| Shot | Exact URL or file path |
| --- | --- |
| Home / How it decides | `<HOSTED_URL>/` |
| Live desk | `<HOSTED_URL>/live` |
| Live snapshot / freshness | `<HOSTED_URL>/api/live` |
| Paste and check | `<HOSTED_URL>/check` |
| Market selection | Copy a real open event/market URL from Polymarket immediately before recording; record the exact chosen URL in production notes. The saved examples in `web/public/data/examples.json` are candidates, not verified-open promises. |
| Braves replay | `<HOSTED_URL>/cases/timing-1cb1c22e47ea5596f03eb22a` |
| Blind test results | `<HOSTED_URL>/benchmark`; aggregate source: `web/public/data/sealed.json` |
| API view | `<HOSTED_URL>/api` |
| Held receipt, if available | `<HOSTED_URL>/api/receipts/<RECEIPT_ID>`; substitute an actual completed reviewed receipt ID |
| Reppo critique and policy | `procedures/changes.jsonl`; `src/reppo/policy.ts` |
| Closing links | `<HOSTED_URL>`, `<REPO_URL>`, `<VIDEO_URL>` |

## Pre-recording checklist

- Record at **1440×900**. Choose **light** appearance and keep it consistent. Turn OS/browser **reduced motion off**; confirm Home and Benchmark animations play.
- Reload Live desk. Wait for a successful cycle and check generation time, stale state, enabled state and truncation. Use the counts actually displayed; if the service is asleep or unavailable, wake it and wait, or label a dated capture.
- Clear stale UI states by reloading `/check` and using Reset in the replay. Hide revealed settlements and old review messages; do not delete receipts or alter evidence.
- Verify the chosen Polymarket market is open and supported. Keep its URL and selected side in production notes. A NEED_EVIDENCE result is an honest demo outcome.
- Confirm SERV is configured and allow for request latency. For the Braves beat, choose a not-yet-cached proposal time after the final mark, within the slider range. Verify support beforehand at a different time; do not clear caches. Show “Cached SERV check” honestly if that is returned; do not narrate it as fresh. Pause the recording while waiting if needed, preserving the actual result.
- Confirm the Braves final mark and resulting receipt. If Proceed is not returned, show the actual action and explain its checklist; do not manufacture an approval.
- Confirm Benchmark shows the **blind test 2** animation and 19/28 → 0/28, the 12.1% bound, checks-only comparison and 14/32 coverage. Keep development and non-blind second-look results labelled separately.
- Prepare an actual completed Reppo hold if available. Otherwise use the labelled policy illustration; critique scores alone do not prove a runtime hold occurred.
- Hide dashboard keys and unrelated browser content. Replace link placeholders; attach captions and check the final cut is 2:30.
