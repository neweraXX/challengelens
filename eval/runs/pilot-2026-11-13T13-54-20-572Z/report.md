# ChallengeLens timing pilot

Run: pilot-2026-11-13T13-54-20-572Z. Status: finished. Requested models: raw google/gemini-3.1-flash-lite; SERV gemini-3.1-flash-lite.
Selected arms: raw, serv. Procedure timing-v5; max_tokens 8000 for every request.
15 dev cases × 3 repetitions per arm. Same system/user prompts and schema; temperature omitted (provider defaults). Sealed inputs are never loaded.

Accuracy requires a valid verdict matching both expected decision and reason. Denominators include all planned trials; invalid, failed, stopped and not-yet-run trials are not correct.
PREMATURE expects NOT_SUPPORTED_NOW/PREMATURE. TIMING_OK expects SUPPORTED_NOW/null for timing only, independent of outcome correctness.

| Arm | PREMATURE accuracy | TIMING_OK accuracy | Overall | Valid false SUPPORTED on PREMATURE | All parsed false SUPPORTED claims | Invalid outputs | Request errors | Not run | Abstentions | Consistent cases | p50 HTTP latency |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| raw | 12/24 (50.0%) | 18/21 (85.7%) | 30/45 (66.7%) | 4/24 (16.7%) | 4/24 (16.7%) | 1 | 0 | 0 | 7 | 13/15 (86.7%) | 1.83 s |
| serv | 12/24 (50.0%) | 18/21 (85.7%) | 30/45 (66.7%) | 6/24 (25.0%) | 6/24 (25.0%) | 0 | 0 | 0 | 9 | 13/15 (86.7%) | 1.98 s |
| raw+gate | 12/24 (50.0%) | 15/21 (71.4%) | 27/45 (60.0%) | 0/24 (0.0%) | 0/24 (0.0%) | 1 | 0 | 0 | 17 | 14/15 (93.3%) | 1.83 s |
| serv+gate | 12/24 (50.0%) | 14/21 (66.7%) | 26/45 (57.8%) | 0/24 (0.0%) | 0/24 (0.0%) | 0 | 0 | 0 | 19 | 14/15 (93.3%) | 1.98 s |

Gated rows reuse the same validated saved responses, with zero extra HTTP calls. BLOCKED_DISAGREEMENT surfaces as NOT_SUPPORTED_NOW. Accuracy and consistency compare the final decision and final reason; a blocked disagreement does not count as a correct PREMATURE reason. Invalid model outputs remain invalid and have no gated SUPPORTED claim. Gated latency/token costs reuse the underlying attempts.

### Gated abstentions by gate_reason

raw+gate: early YES needs event evidence: 12; no independent cutoff: 2; needs proof the game finished: 3
serv+gate: early YES needs event evidence: 12; no independent cutoff: 3; keys disagree: 1; needs proof the game finished: 3

| Arm | Case | Repetition | gate_reason |
| --- | --- | ---: | --- |
| raw+gate | timing-0fabc28953d7a6f6a48ab7c3 | 1 | early YES needs event evidence |
| raw+gate | timing-5739e5b0742d895b75fe579e | 1 | early YES needs event evidence |
| raw+gate | timing-7367529981e30893b74f7d4c | 1 | no independent cutoff |
| raw+gate | timing-7e5b08cb0bbb8a44f261ef77 | 1 | early YES needs event evidence |
| raw+gate | timing-9c9be4825222f0e577b2b6eb | 1 | early YES needs event evidence |
| raw+gate | timing-f6b726ad2b41371c9b08bbf3 | 1 | needs proof the game finished |
| raw+gate | timing-0fabc28953d7a6f6a48ab7c3 | 2 | early YES needs event evidence |
| raw+gate | timing-5739e5b0742d895b75fe579e | 2 | early YES needs event evidence |
| raw+gate | timing-7367529981e30893b74f7d4c | 2 | no independent cutoff |
| raw+gate | timing-7e5b08cb0bbb8a44f261ef77 | 2 | early YES needs event evidence |
| raw+gate | timing-9c9be4825222f0e577b2b6eb | 2 | early YES needs event evidence |
| raw+gate | timing-f6b726ad2b41371c9b08bbf3 | 2 | needs proof the game finished |
| raw+gate | timing-0fabc28953d7a6f6a48ab7c3 | 3 | early YES needs event evidence |
| raw+gate | timing-5739e5b0742d895b75fe579e | 3 | early YES needs event evidence |
| raw+gate | timing-7e5b08cb0bbb8a44f261ef77 | 3 | early YES needs event evidence |
| raw+gate | timing-9c9be4825222f0e577b2b6eb | 3 | early YES needs event evidence |
| raw+gate | timing-f6b726ad2b41371c9b08bbf3 | 3 | needs proof the game finished |
| serv+gate | timing-0fabc28953d7a6f6a48ab7c3 | 1 | early YES needs event evidence |
| serv+gate | timing-5739e5b0742d895b75fe579e | 1 | early YES needs event evidence |
| serv+gate | timing-7367529981e30893b74f7d4c | 1 | no independent cutoff |
| serv+gate | timing-7e5b08cb0bbb8a44f261ef77 | 1 | early YES needs event evidence |
| serv+gate | timing-9c9be4825222f0e577b2b6eb | 1 | early YES needs event evidence |
| serv+gate | timing-b011f1a97b470fa7094135e1 | 1 | keys disagree |
| serv+gate | timing-f6b726ad2b41371c9b08bbf3 | 1 | needs proof the game finished |
| serv+gate | timing-0fabc28953d7a6f6a48ab7c3 | 2 | early YES needs event evidence |
| serv+gate | timing-5739e5b0742d895b75fe579e | 2 | early YES needs event evidence |
| serv+gate | timing-7367529981e30893b74f7d4c | 2 | no independent cutoff |
| serv+gate | timing-7e5b08cb0bbb8a44f261ef77 | 2 | early YES needs event evidence |
| serv+gate | timing-9c9be4825222f0e577b2b6eb | 2 | early YES needs event evidence |
| serv+gate | timing-f6b726ad2b41371c9b08bbf3 | 2 | needs proof the game finished |
| serv+gate | timing-0fabc28953d7a6f6a48ab7c3 | 3 | early YES needs event evidence |
| serv+gate | timing-5739e5b0742d895b75fe579e | 3 | early YES needs event evidence |
| serv+gate | timing-7367529981e30893b74f7d4c | 3 | no independent cutoff |
| serv+gate | timing-7e5b08cb0bbb8a44f261ef77 | 3 | early YES needs event evidence |
| serv+gate | timing-9c9be4825222f0e577b2b6eb | 3 | early YES needs event evidence |
| serv+gate | timing-f6b726ad2b41371c9b08bbf3 | 3 | needs proof the game finished |

All parsed false SUPPORTED claims include rejected invalid outputs when their first parsed JSON object claimed SUPPORTED_NOW. Malformed/unparseable outputs are counted as invalid.
Consistency means the same valid decision+reason in all three runs of a case; incomplete cases are not consistent. p50 is per actual HTTP attempt, including format fallback/errors, excluding rate-limit waiting.

## Usage and collection status

| Arm | HTTP attempts | JSON-mode attempts | Plain fallback attempts | Prompt tokens | Completion tokens | Total tokens | Reasoning tokens | Total cost (USD) | Attempts reporting usage | Stop reason |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| raw | 45 | 45 | 0 | 126192 | 8800 | 134992 | 0 | 0.04474800 | 45/45 | none recorded |
| serv | 45 | 45 | 0 | 60492 | 9973 | 70465 | unreported | unreported | 45/45 | none recorded |

Token/cost totals sum provider-reported usage only, including format fallback attempts; missing fields are unreported, never zero. Cost uses usage.cost in USD. Reasoning tokens use completion_tokens_details.reasoning_tokens (or usage.reasoning_tokens) and are not added again to total tokens. Partial costs do not support a cheaper-arm claim. New JSON-mode calls use json_schema strict.

## raw: per-case results

| Case / title | Category | Label | Outcome flipped | Run 1 | Run 2 | Run 3 | Correct | Consistent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| timing-096b0fbae9b3a7989bd596a3: Will US attack Yemen in 2023? | fixed_window | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-0c1cbf3f0a15dae5928a91e1: NBA: Golden State Warriors vs. Minnesota Timberwolves 2023-02-26 | sports_in_game | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-0c88438129ac80cba43c38fd: Blues vs. Utah | sports_in_game | PREMATURE | false | INSUFFICIENT_EVIDENCE/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 0/3 | false |
| timing-0d7374fc22efb92be7f6a743: Will Trump say "Luck" this week? (December 8 - 14) | fixed_window | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-0fabc28953d7a6f6a48ab7c3: Will Trump say "Happy New Year" this week? (December 29 - January 4) | fixed_window | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-1cb1c22e47ea5596f03eb22a: Braves vs. Nationals | sports_in_game | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-4cfe8694807a8ed7a250f376: Ethereum Up or Down - December 18, 3PM ET | crypto_fixed_time | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-5739e5b0742d895b75fe579e: Will Solana reach $250 September 15-21? | crypto_fixed_time | PREMATURE | false | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | 0/3 | true |
| timing-7367529981e30893b74f7d4c: Will Trump say "Crypto" during Elon interview? | crypto_fixed_time | PREMATURE | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | INVALID: explanation must contain 1 to 60 words. | 0/3 | false |
| timing-7e5b08cb0bbb8a44f261ef77: Will Pakistan strike Iran by Saturday? | fixed_window | PREMATURE | false | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | 0/3 | true |
| timing-9c9be4825222f0e577b2b6eb: Will Trump say "MAGA" or "Make America Great Again" this week? (December 29 - January 4) | fixed_window | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-b011f1a97b470fa7094135e1: Will the price of Bitcoin be above $100,000 on November 7? | crypto_fixed_time | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-d0703d8ea538e2707c5a3427: Will US attack Yemen in 2023? | fixed_window | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-f3947712a223d177e14d82b7: NBA: Golden State Warriors vs. Sacramento Kings 2023-04-28 | sports_in_game | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-f6b726ad2b41371c9b08bbf3: Games Total: O/U 2.5 | sports_in_game | TIMING_OK | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 0/3 | true |

## serv: per-case results

| Case / title | Category | Label | Outcome flipped | Run 1 | Run 2 | Run 3 | Correct | Consistent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| timing-096b0fbae9b3a7989bd596a3: Will US attack Yemen in 2023? | fixed_window | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-0c1cbf3f0a15dae5928a91e1: NBA: Golden State Warriors vs. Minnesota Timberwolves 2023-02-26 | sports_in_game | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-0c88438129ac80cba43c38fd: Blues vs. Utah | sports_in_game | PREMATURE | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 0/3 | true |
| timing-0d7374fc22efb92be7f6a743: Will Trump say "Luck" this week? (December 8 - 14) | fixed_window | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-0fabc28953d7a6f6a48ab7c3: Will Trump say "Happy New Year" this week? (December 29 - January 4) | fixed_window | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-1cb1c22e47ea5596f03eb22a: Braves vs. Nationals | sports_in_game | PREMATURE | false | INSUFFICIENT_EVIDENCE/null | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 2/3 | false |
| timing-4cfe8694807a8ed7a250f376: Ethereum Up or Down - December 18, 3PM ET | crypto_fixed_time | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-5739e5b0742d895b75fe579e: Will Solana reach $250 September 15-21? | crypto_fixed_time | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | 1/3 | false |
| timing-7367529981e30893b74f7d4c: Will Trump say "Crypto" during Elon interview? | crypto_fixed_time | PREMATURE | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 0/3 | true |
| timing-7e5b08cb0bbb8a44f261ef77: Will Pakistan strike Iran by Saturday? | fixed_window | PREMATURE | false | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | 0/3 | true |
| timing-9c9be4825222f0e577b2b6eb: Will Trump say "MAGA" or "Make America Great Again" this week? (December 29 - January 4) | fixed_window | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-b011f1a97b470fa7094135e1: Will the price of Bitcoin be above $100,000 on November 7? | crypto_fixed_time | TIMING_OK | false | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-d0703d8ea538e2707c5a3427: Will US attack Yemen in 2023? | fixed_window | TIMING_OK | true | SUPPORTED_NOW/null | SUPPORTED_NOW/null | SUPPORTED_NOW/null | 3/3 | true |
| timing-f3947712a223d177e14d82b7: NBA: Golden State Warriors vs. Sacramento Kings 2023-04-28 | sports_in_game | PREMATURE | false | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | NOT_SUPPORTED_NOW/PREMATURE | 3/3 | true |
| timing-f6b726ad2b41371c9b08bbf3: Games Total: O/U 2.5 | sports_in_game | TIMING_OK | false | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | INSUFFICIENT_EVIDENCE/null | 0/3 | true |

## Interpretation limits

- Labels follow the instructed oracle-settlement mapping. Binary equality/flip is a timing proxy, not independent proof of timing at the proposal instant.
- Rules are decoded ancillary base bytes; historical authoritative clarifications and receipts are not verified. Current Gamma scheduling can disagree with historical rules.
- Selection is restricted to fixed-time heuristic matches, excluding by/before-date YES propositions. Candle-close, timezone and inclusive-end conventions need checking. A scheduled start plus a conservative duration estimates game end; it does not prove actual completion or handle postponements. The gate never treats an estimated sports end as proof of completion; saved older SERV judgments are retained for comparison.
- Fifteen cases, capped per event, are a development pilot. Repeated runs are not independent events; no significance or generalization claims are made.
- Providers use different IDs for the requested model family; defaults/aliases may differ. Compare the stored responses. No evidence of an OpenServ advantage is assumed.
