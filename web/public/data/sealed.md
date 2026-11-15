Split: sealed

# Sealed evaluation

Procedure: timing-v5 / 4a42efc9a45737347dd7ecb75364294ae078d1f814818b81efd85dcc23af81fb; gate: gate-v2; status: incomplete.

Blind: true.

Wilson 95% intervals use CASE-majority outcomes, not trials: the three repetitions are not independent. Outcome rates exclude cases without a decision majority (at least two valid decisions); these missing majorities are reported explicitly. Correct requires a majority matching both decision and reason. Consistency uses all planned cases and requires three valid matching decisions and reasons. False approvals use too-early cases with a decision majority. Gated rows reuse inference tokens and cost.

| Arm | Correct | False approvals on too-early | Abstentions | Consistency | Majority cases | Tokens | Recorded USD | Cost coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Model only | 13/27 (30.74–66.01%) | 5/12 (19.33–68.05%) | 6/27 (10.61–40.76%) | 20/30 (48.78–80.77%) | 27/30 | 267472 | 0.08969175 | 90/90 complete |
| Model + deterministic checks | 12/27 (27.59–62.69%) | 0/12 (0.00–24.25%) | 13/27 (30.74–66.01%) | 24/30 (62.69–90.49%) | 27/30 | 267472 | 0.08969175 | 90/90 complete |
| SERV | 12/30 (24.59–57.68%) | 9/15 (35.75–80.18%) | 7/30 (11.79–40.93%) | 22/30 (55.55–85.82%) | 30/30 | 137679 | 0.00000000 | 0/90 partial/unreported |
| SERV + deterministic checks | 15/30 (33.15–66.85%) | 0/15 (0.00–20.39%) | 13/30 (27.38–60.80%) | 30/30 (88.65–100.00%) | 30/30 | 137679 | 0.00000000 | 0/90 partial/unreported |

Action metrics (Wilson intervals use case majorities; precision ratio uses trials):


Split: sealed

# Sealed evaluation

Procedure: timing-v7 / c884ea76edf1fdfc9f285dc4fc75f9c8eaf7028bab9d895913896d95cbce75b0; gate: gate-v4; status: finished.

Blind: false. Second look: evidence keys were designed after seeing aggregate failure categories of the blind timing-v5 run; no case text was read.

Wilson 95% intervals use CASE-majority outcomes, not trials: the three repetitions are not independent. Outcome rates exclude cases without a decision majority (at least two valid decisions); these missing majorities are reported explicitly. Correct requires a majority matching both decision and reason. Consistency uses all planned cases and requires three valid matching decisions and reasons. False approvals use too-early cases with a decision majority. Gated rows reuse inference tokens and cost.

| Arm | Correct | False approvals on too-early | Abstentions | Consistency | Majority cases | Tokens | Recorded USD | Cost coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Model only | 13/30 (27.38–60.80%) | 6/15 (19.82–64.25%) | 3/30 (3.46–25.62%) | 25/30 (66.44–92.66%) | 30/30 | 330306 | 0.10675275 | 90/90 complete |
| Model + deterministic checks | 15/30 (33.15–66.85%) | 0/15 (0.00–20.39%) | 13/30 (27.38–60.80%) | 28/30 (78.68–98.15%) | 30/30 | 330306 | 0.10675275 | 90/90 complete |
| SERV | 15/30 (33.15–66.85%) | 6/15 (19.82–64.25%) | 5/30 (7.34–33.56%) | 29/30 (83.33–99.41%) | 30/30 | 145080 | 0.00000000 | 0/90 partial/unreported |
| SERV + deterministic checks | 15/30 (33.15–66.85%) | 0/15 (0.00–20.39%) | 13/30 (27.38–60.80%) | 30/30 (88.65–100.00%) | 30/30 | 145080 | 0.00000000 | 0/90 partial/unreported |

Action metrics (Wilson intervals use case majorities; precision ratio uses trials):

Model only

| Action metric | Result |
| --- | --- |
| Proceed precision | 19/37 trials; case-majority 6/12; Wilson 95% 25.4–74.6% |
| Proceed coverage | 6/15; Wilson 95% 19.8–64.3% |
| Safe on too-early | 9/15; Wilson 95% 35.7–80.2% |

Model + deterministic checks

| Action metric | Result |
| --- | --- |
| Proceed precision | 7/7 trials; case-majority 3/3; Wilson 95% 43.9–100.0% |
| Proceed coverage | 3/15; Wilson 95% 7.0–45.2% |
| Safe on too-early | 15/15; Wilson 95% 79.6–100.0% |

SERV

| Action metric | Result |
| --- | --- |
| Proceed precision | 24/42 trials; case-majority 8/14; Wilson 95% 32.6–78.6% |
| Proceed coverage | 8/15; Wilson 95% 30.1–75.2% |
| Safe on too-early | 9/15; Wilson 95% 35.7–80.2% |

SERV + deterministic checks

| Action metric | Result |
| --- | --- |
| Proceed precision | 9/9 trials; case-majority 3/3; Wilson 95% 43.9–100.0% |
| Proceed coverage | 3/15; Wilson 95% 7.0–45.2% |
| Safe on too-early | 15/15; Wilson 95% 79.6–100.0% |


Split: sealed2

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
