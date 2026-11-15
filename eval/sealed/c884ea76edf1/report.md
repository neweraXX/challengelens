# Sealed evaluation

Procedure: timing-v7 / c884ea76edf1fdfc9f285dc4fc75f9c8eaf7028bab9d895913896d95cbce75b0; gate: gate-v4; status: finished.

Blind: false. Second look: evidence keys were designed after seeing aggregate failure categories of the blind timing-v5 run; no case text was read.

Wilson 95% intervals use CASE-majority outcomes, not trials: the three repetitions are not independent. Outcome rates exclude cases without a decision majority (at least two valid decisions); these missing majorities are reported explicitly. Correct requires a majority matching both decision and reason. Consistency uses all planned cases and requires three valid matching decisions and reasons. False approvals use too-early cases with a decision majority. Gated rows reuse inference tokens and cost.

| Arm | Correct | False approvals on too-early | Abstentions | Consistency | Majority cases | Tokens | Recorded USD | Cost coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Model only | 13/30 (27.38–60.80%) | 6/15 (19.82–64.25%) | 3/30 (3.46–25.62%) | 25/30 (66.44–92.66%) | 30/30 | 330306 | 0.10675275 | 90/90 complete |
| Model + code key | 15/30 (33.15–66.85%) | 0/15 (0.00–20.39%) | 13/30 (27.38–60.80%) | 28/30 (78.68–98.15%) | 30/30 | 330306 | 0.10675275 | 90/90 complete |
| SERV | 15/30 (33.15–66.85%) | 6/15 (19.82–64.25%) | 5/30 (7.34–33.56%) | 29/30 (83.33–99.41%) | 30/30 | 145080 | 0.00000000 | 0/90 partial/unreported |
| SERV + code key | 15/30 (33.15–66.85%) | 0/15 (0.00–20.39%) | 13/30 (27.38–60.80%) | 30/30 (88.65–100.00%) | 30/30 | 145080 | 0.00000000 | 0/90 partial/unreported |

Action metrics (Wilson intervals use case majorities; precision ratio uses trials):

Model only

| Action metric | Result |
| --- | --- |
| Proceed precision | 19/37 trials; case-majority 6/12; Wilson 95% 25.4–74.6% |
| Proceed coverage | 6/15; Wilson 95% 19.8–64.3% |
| Safe on too-early | 9/15; Wilson 95% 35.7–80.2% |

Model + code key

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

SERV + code key

| Action metric | Result |
| --- | --- |
| Proceed precision | 9/9 trials; case-majority 3/3; Wilson 95% 43.9–100.0% |
| Proceed coverage | 3/15; Wilson 95% 7.0–45.2% |
| Safe on too-early | 15/15; Wilson 95% 79.6–100.0% |
