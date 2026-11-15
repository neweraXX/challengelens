# ChallengeLens timing pilot

Run: pilot-2026-11-14T06-19-58-607Z. Status: finished. Requested models: raw google/gemini-3.6-flash; SERV gemini-3.1-flash-lite.
Selected arms: serv. Procedure timing-v8; max_tokens 8000 for every request.
15 dev cases × 3 repetitions per arm. Same system/user prompts and schema; temperature omitted (provider defaults). Sealed inputs are never loaded.

Accuracy requires a valid verdict matching both expected decision and reason. Denominators include all planned trials; invalid, failed, stopped and not-yet-run trials are not correct.
PREMATURE expects NOT_SUPPORTED_NOW/PREMATURE. TIMING_OK expects SUPPORTED_NOW/null for timing only, independent of outcome correctness.

| Arm | PREMATURE accuracy | TIMING_OK accuracy | Overall | Valid false SUPPORTED on PREMATURE | All parsed false SUPPORTED claims | Invalid outputs | Request errors | Not run | Abstentions | Consistent cases | p50 HTTP latency |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| raw (not selected) | n/a | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 | n/a | n/a |
| serv | 20/24 (83.3%) | 18/21 (85.7%) | 38/45 (84.4%) | 1/24 (4.2%) | 3/24 (12.5%) | 2 | 0 | 0 | 1 | 13/15 (86.7%) | 1.73 s |
| raw+gate (not selected) | n/a | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 | n/a | n/a |
| serv+gate | 16/24 (66.7%) | 13/21 (61.9%) | 29/45 (64.4%) | 0/24 (0.0%) | 0/24 (0.0%) | 2 | 0 | 0 | 14 | 13/15 (86.7%) | 1.73 s |
| checks-only | 15/24 (62.5%) | 15/21 (71.4%) | 30/45 (66.7%) | 0/24 (0.0%) | 0/24 (0.0%) | 0 | 0 | 0 | 15 | 15/15 (100.0%) | 0 HTTP calls |

Checks-only uses code templates and evidence alone: no model cutoff, approval, inference, tokens or cost. Its three identical projections match reporting denominators; repetitions are not independent.

Cases where SERV changed the outcome vs checks-only (case-majority, aggregates only):

| Direction | Cases |
| --- | --- |
| SERV blocked a checks-only PROCEED | 1 |
| SERV enabled nothing by itself (unsupported enables) | 0 |
| Other action disagreements | 0 |
| Missing SERV majority | 1 |
| Compared | 14 |


Gated rows reuse the same validated saved responses, with zero extra HTTP calls. BLOCKED_DISAGREEMENT surfaces as NOT_SUPPORTED_NOW. Accuracy and consistency compare the final decision and final reason; a blocked disagreement does not count as a correct PREMATURE reason. Invalid model outputs remain invalid and have no gated SUPPORTED claim. Gated latency/token costs reuse the underlying attempts.

### Gated abstentions by gate_reason

raw+gate: none
serv+gate: early YES needs event evidence: 9; needs proof the game finished: 3; keys disagree: 2
checks-only: early YES needs event evidence: 9; no independent cutoff: 3; needs proof the game finished: 3

| Arm | Case | Repetition | gate_reason |
| --- | --- | ---: | --- |
| serv+gate | timing-0fabc28953d7a6f6a48ab7c3 | 1 | early YES needs event evidence |
| serv+gate | timing-7e5b08cb0bbb8a44f261ef77 | 1 | early YES needs event evidence |
| serv+gate | timing-9c9be4825222f0e577b2b6eb | 1 | early YES needs event evidence |
| serv+gate | timing-f6b726ad2b41371c9b08bbf3 | 1 | needs proof the game finished |
| serv+gate | timing-0fabc28953d7a6f6a48ab7c3 | 2 | early YES needs event evidence |
| serv+gate | timing-4cfe8694807a8ed7a250f376 | 2 | keys disagree |
| serv+gate | timing-7e5b08cb0bbb8a44f261ef77 | 2 | early YES needs event evidence |
| serv+gate | timing-9c9be4825222f0e577b2b6eb | 2 | early YES needs event evidence |
| serv+gate | timing-f6b726ad2b41371c9b08bbf3 | 2 | needs proof the game finished |
| serv+gate | timing-0fabc28953d7a6f6a48ab7c3 | 3 | early YES needs event evidence |
| serv+gate | timing-4cfe8694807a8ed7a250f376 | 3 | keys disagree |
| serv+gate | timing-7e5b08cb0bbb8a44f261ef77 | 3 | early YES needs event evidence |
| serv+gate | timing-9c9be4825222f0e577b2b6eb | 3 | early YES needs event evidence |
| serv+gate | timing-f6b726ad2b41371c9b08bbf3 | 3 | needs proof the game finished |
| checks-only | timing-0fabc28953d7a6f6a48ab7c3 | 1 | early YES needs event evidence |
| checks-only | timing-0fabc28953d7a6f6a48ab7c3 | 2 | early YES needs event evidence |
| checks-only | timing-0fabc28953d7a6f6a48ab7c3 | 3 | early YES needs event evidence |
| checks-only | timing-7367529981e30893b74f7d4c | 1 | no independent cutoff |
| checks-only | timing-7367529981e30893b74f7d4c | 2 | no independent cutoff |
| checks-only | timing-7367529981e30893b74f7d4c | 3 | no independent cutoff |
| checks-only | timing-7e5b08cb0bbb8a44f261ef77 | 1 | early YES needs event evidence |
| checks-only | timing-7e5b08cb0bbb8a44f261ef77 | 2 | early YES needs event evidence |
| checks-only | timing-7e5b08cb0bbb8a44f261ef77 | 3 | early YES needs event evidence |
| checks-only | timing-9c9be4825222f0e577b2b6eb | 1 | early YES needs event evidence |
| checks-only | timing-9c9be4825222f0e577b2b6eb | 2 | early YES needs event evidence |
| checks-only | timing-9c9be4825222f0e577b2b6eb | 3 | early YES needs event evidence |
| checks-only | timing-f6b726ad2b41371c9b08bbf3 | 1 | needs proof the game finished |
| checks-only | timing-f6b726ad2b41371c9b08bbf3 | 2 | needs proof the game finished |
| checks-only | timing-f6b726ad2b41371c9b08bbf3 | 3 | needs proof the game finished |

All parsed false SUPPORTED claims include rejected invalid outputs when their first parsed JSON object claimed SUPPORTED_NOW. Malformed/unparseable outputs are counted as invalid.
Consistency means the same valid decision+reason in all three runs of a case; incomplete cases are not consistent. p50 is per actual HTTP attempt, including format fallback/errors, excluding rate-limit waiting.

## Usage and collection status

| Arm | HTTP attempts | JSON-mode attempts | Plain fallback attempts | Prompt tokens | Completion tokens | Total tokens | Reasoning tokens | Total cost (USD) | Attempts reporting usage | Stop reason |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| raw | 0 | 0 | 0 | unreported | unreported | unreported | unreported | unreported | 0/0 | Not selected (PILOT_ARMS) |
| serv | 45 | 45 | 0 | 57390 | 13670 | 71060 | unreported | unreported | 45/45 | none recorded |
| checks-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00000000 | 0/0 (no calls) | Offline | 

Token/cost totals sum provider-reported usage only, including format fallback attempts; missing fields are unreported, never zero. Cost uses usage.cost in USD. Reasoning tokens use completion_tokens_details.reasoning_tokens (or usage.reasoning_tokens) and are not added again to total tokens. Partial costs do not support a cheaper-arm claim. New JSON-mode calls use json_schema strict.

## serv: per-case results

| Case / title | Category | Label | Outcome flipped | Run 1 | Run 2 | Run 3 | Correct | Consistent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| timing-096b0fbae9b3a7989bd596a3: Will US attack Yemen in 2023? | other | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-0c1cbf3f0a15dae5928a91e1: NBA: Golden State Warriors vs. Minnesota Timberwolves 2023-02-26 | other | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-0c88438129ac80cba43c38fd: Blues vs. Utah | other | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-0d7374fc22efb92be7f6a743: Will Trump say "Luck" this week? (December 8 - 14) | other | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-0fabc28953d7a6f6a48ab7c3: Will Trump say "Happy New Year" this week? (December 29 - January 4) | other | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-1cb1c22e47ea5596f03eb22a: Braves vs. Nationals | other | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-4cfe8694807a8ed7a250f376: Ethereum Up or Down - December 18, 3PM ET | other | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-5739e5b0742d895b75fe579e: Will Solana reach $250 September 15-21? | other | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-7367529981e30893b74f7d4c: Will Trump say "Crypto" during Elon interview? | other | PREMATURE | false | INVALID: Invalid sports metadata. | SUPPORTED_NOW/null | INVALID: Invalid sports metadata. | 0/3 | false |
| timing-7e5b08cb0bbb8a44f261ef77: Will Pakistan strike Iran by Saturday? | other | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-9c9be4825222f0e577b2b6eb: Will Trump say "MAGA" or "Make America Great Again" this week? (December 29 - January 4) | other | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | INSUFFICIENT_EVIDENCE/null | NOT_SUPPORTED_NOW/PREMATURE | 2/3 | false |
| timing-b011f1a97b470fa7094135e1: Will the price of Bitcoin be above $100,000 on November 7? | other | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-d0703d8ea538e2707c5a3427: Will US attack Yemen in 2023? | other | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-f3947712a223d177e14d82b7: NBA: Golden State Warriors vs. Sacramento Kings 2023-04-28 | other | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-f6b726ad2b41371c9b08bbf3: Games Total: O/U 2.5 | other | TIMING_OK | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 0/3 | true |

## Interpretation limits

- Labels follow the instructed oracle-settlement mapping. Binary equality/flip is a timing proxy, not independent proof of timing at the proposal instant.
- Rules are decoded ancillary base bytes; historical authoritative clarifications and receipts are not verified. Current Gamma scheduling can disagree with historical rules.
- Selection is restricted to fixed-time heuristic matches, excluding by/before-date YES propositions. Candle-close, timezone and inclusive-end conventions need checking. A scheduled start plus a conservative duration estimates game end; it does not prove actual completion or handle postponements. The gate never treats an estimated sports end as proof of completion; saved older SERV judgments are retained for comparison.
- Fifteen cases, capped per event, are a development pilot. Repeated runs are not independent events; no significance or generalization claims are made.
- Providers use different IDs for the requested model family; defaults/aliases may differ. Compare the stored responses. No evidence of an OpenServ advantage is assumed.

Evidence regating: saved responses are reused; recomputed evidence may differ from what the models originally saw. No inference rerun.

raw+gate

| Action metric | Result |
| --- | --- |
| Proceed precision | 0/0 trials; case-majority 0/0; Wilson 95% n/a |
| Proceed coverage | 0/7; Wilson 95% 0.0–35.4% |
| Safe on too-early | 0/8; Wilson 95% 0.0–32.4% |


serv+gate

| Action metric | Result |
| --- | --- |
| Proceed precision | 13/13 trials; case-majority 4/4; Wilson 95% 51.0–100.0% |
| Proceed coverage | 4/7; Wilson 95% 25.0–84.2% |
| Safe on too-early | 7/8; Wilson 95% 52.9–97.8% |


checks-only

| Action metric | Result |
| --- | --- |
| Proceed precision | 15/15 trials; case-majority 5/5; Wilson 95% 56.6–100.0% |
| Proceed coverage | 5/7; Wilson 95% 35.9–91.8% |
| Safe on too-early | 8/8; Wilson 95% 67.6–100.0% |
