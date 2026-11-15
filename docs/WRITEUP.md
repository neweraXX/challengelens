# ChallengeLens

ChallengeLens checks whether the timing of a Polymarket/UMA oracle proposal is supported now, before an operator posts a bond. In a selected sample of 598 disputed UMA requests (2022–2026), 266 settled TOO_EARLY. That is not the rate across all proposals.

The app offers a Live desk, pasted-market checks, 12 historical replays, a benchmark and an API. Three checks govern Proceed: SERV reads the governing clause; code computes supported timing cutoffs; evidence checks event completion as of the proposal. Sports use Polymarket's finishedTimestamp; price-touch markets use Binance 1-minute candles. Actions are PROCEED, WAIT, NEED_EVIDENCE and HOLD_FOR_REVIEW.

SERV Reasoning receives strict json_schema requests with max_tokens 8000. It quotes the governing clause and extracts decisive_local: the stated date, clock and timezone. Code converts that clock to UTC and applies the gate. Receipts include packet, evidence and procedure SHA-256 hashes, model, and SERV request ID when returned. Current versions are timing-v8 / gate-v8.

We enter OpenServ SERV Hackathon 02's Open track for the timing-check application, and Reppo for independent review of saved verdicts using taskType response. Reppo critiques scored 51 and 59 led to timing-v5; procedures/changes.jsonl records before/after. Development SERV-alone dangerous approvals fell 12/24 → 7/24 → 6/24 across reruns, an unproven, noise-level change; gated accuracy stayed 27/45. Reppo can hold Proceed, never upgrade it, and it did on a real review: a Proceed receipt scored 52 (route review) and became HOLD_FOR_REVIEW; after we added the rules' finalization wording and margin to the review input, the same case scored 69, still held (one review per format, noisy evaluators; eval/reppo/live-review-2026-11-15.json).

Blind test 2 used 60 new cases, three readings each: 28 too early, 32 timing-OK. By case-majority, model alone falsely approved 15/28 and SERV alone 19/28. Model + checks, SERV + checks and checks alone each had 0/28; the Wilson 95% upper bound is 12.1%. SERV + checks got 22/60 correct, held 37/60 for evidence, and had Proceed precision 14/14 with coverage 14/32 (44%). Checks alone got 23/60 correct, precision 15/15, coverage 15/32. SERV enabled no additional Proceed and blocked one.

The zero-false-approval result comes from deterministic checks. We do not claim SERV improves accuracy over code + evidence. Its measured contribution is structured rule reading: 90/90 valid outputs in blind test 1, 179/180 in test 2. All 360 test-2 calls completed; one invalid SERV output leaves status incomplete. Raw-model cost was $0.22; SERV cost is unreported.

Limits: small sets; settlement labels are adjudication proxies; Proceed checks timing, not outcome correctness. Sports feeds lag and lack completion timestamps. Pasted checks use Gamma's current description; the desk uses on-chain ancillary text. The desk never recommends disputing. Not financial advice. Independent; unaffiliated with Polymarket, UMA, OpenServ or Reppo.

Repository: `https://github.com/neweraXX/challengelens`

App: `https://challengelens.onrender.com`

Video: `https://youtu.be/CQxjMUFcmE4`

Post: `https://x.com/chimnon1993/status/2121840474336252368`
