# Sealed evaluation

Procedure: timing-v8 / 4e2d3341383fcdd4b10d2be4a45225a8a95bbf92ee20d7bc0e585efbccd9260f; gate: gate-v8; status: incomplete.

Blind: true.

Wilson 95% intervals use CASE-majority outcomes, not trials: the three repetitions are not independent. Outcome rates exclude cases without a decision majority (at least two valid decisions); these missing majorities are reported explicitly. Correct requires a majority matching both decision and reason. Consistency uses all planned cases and requires three valid matching decisions and reasons. False approvals use too-early cases with a decision majority. Gated rows reuse inference tokens and cost.

| Arm | Correct | False approvals on too-early | Abstentions | Consistency | Majority cases | Tokens | Recorded USD | Cost coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Model only | 42/60 (57.49–80.10%) | 15/28 (35.81–70.47%) | 0/60 (0.00–6.02%) | 59/60 (91.14–99.71%) | 60/60 | 676937 | 0.22003425 | 180/180 complete |
| Model + deterministic checks | 24/60 (28.57–52.63%) | 0/28 (0.00–12.06%) | 36/60 (47.37–71.43%) | 60/60 (93.98–100.00%) | 60/60 | 676937 | 0.22003425 | 180/180 complete |
| SERV | 39/60 (52.36–75.83%) | 19/28 (49.34–82.07%) | 1/60 (0.29–8.86%) | 57/60 (86.30–98.29%) | 60/60 | 278133 | 0.00000000 | 0/180 partial/unreported |
| SERV + deterministic checks | 22/60 (25.62–49.32%) | 0/28 (0.00–12.06%) | 37/60 (49.02–72.91%) | 55/60 (81.93–96.39%) | 60/60 | 278133 | 0.00000000 | 0/180 partial/unreported |
| Checks only (no model) | 23/60 (27.09–50.98%) | 0/28 (0.00–12.06%) | 37/60 (49.02–72.91%) | 60/60 (93.98–100.00%) | 60/60 | 0 | 0.00000000 | 0/0 complete |

Action metrics (Wilson intervals use case majorities; precision ratio uses trials):

Cases where SERV changed the outcome vs checks-only (case-majority, aggregates only):

| Direction | Cases |
| --- | --- |
| SERV blocked a checks-only PROCEED | 1 |
| SERV enabled nothing by itself (unsupported enables) | 0 |
| Other action disagreements | 2 |
| Missing SERV majority | 0 |
| Compared | 60 |


Model only

| Action metric | Result |
| --- | --- |
| Proceed precision | 87/133 trials; case-majority 29/44; Wilson 95% 51.1–78.1% |
| Proceed coverage | 29/32; Wilson 95% 75.8–96.8% |
| Safe on too-early | 13/28; Wilson 95% 29.5–64.2% |

Model + deterministic checks

| Action metric | Result |
| --- | --- |
| Proceed precision | 45/45 trials; case-majority 15/15; Wilson 95% 79.6–100.0% |
| Proceed coverage | 15/32; Wilson 95% 30.9–63.6% |
| Safe on too-early | 28/28; Wilson 95% 87.9–100.0% |

SERV

| Action metric | Result |
| --- | --- |
| Proceed precision | 89/145 trials; case-majority 30/49; Wilson 95% 47.2–73.6% |
| Proceed coverage | 30/32; Wilson 95% 79.9–98.3% |
| Safe on too-early | 9/28; Wilson 95% 17.9–50.7% |

SERV + deterministic checks

| Action metric | Result |
| --- | --- |
| Proceed precision | 37/37 trials; case-majority 14/14; Wilson 95% 78.5–100.0% |
| Proceed coverage | 14/32; Wilson 95% 28.2–60.7% |
| Safe on too-early | 28/28; Wilson 95% 87.9–100.0% |

Checks only (no model)

| Action metric | Result |
| --- | --- |
| Proceed precision | 45/45 trials; case-majority 15/15; Wilson 95% 79.6–100.0% |
| Proceed coverage | 15/32; Wilson 95% 30.9–63.6% |
| Safe on too-early | 28/28; Wilson 95% 87.9–100.0% |
