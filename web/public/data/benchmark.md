# pilot-2026-11-14T06-19-58-607Z · timing-v8 · gate-v8

| Arm | Strict correct | False approvals | Abstentions | Consistent cases |
| --- | --- | --- | --- | --- |
| raw+gate | 0/45 | 0/24 | 0/45 | 0/15 |
| serv+gate | 29/45 | 0/24 | 14/45 | 13/15 |
| checks-only | 30/45 | 0/24 | 15/45 | 15/15 |

Cases where SERV changed the outcome vs checks-only (case-majority, aggregates only):

| Direction | Cases |
| --- | --- |
| SERV blocked a checks-only PROCEED | 1 |
| SERV enabled nothing by itself (unsupported enables) | 0 |
| Other action disagreements | 0 |
| Missing SERV majority | 1 |
| Compared | 14 |


# pilot-2026-11-13T07-36-18-842Z · timing-v3 · gate-v8

| Arm | Strict correct | False approvals | Abstentions | Consistent cases |
| --- | --- | --- | --- | --- |
| raw+gate | 24/45 | 0/24 | 21/45 | 15/15 |
| serv+gate | 0/45 | 0/24 | 0/45 | 0/15 |
| checks-only | 21/45 | 0/24 | 24/45 | 15/15 |

Cases where SERV changed the outcome vs checks-only (case-majority, aggregates only):

| Direction | Cases |
| --- | --- |
| SERV blocked a checks-only PROCEED | 0 |
| SERV enabled nothing by itself (unsupported enables) | 0 |
| Other action disagreements | 0 |
| Missing SERV majority | 15 |
| Compared | 0 |


# pilot-2026-11-12T11-46-44-050Z · timing-v3 · gate-v8

| Arm | Strict correct | False approvals | Abstentions | Consistent cases |
| --- | --- | --- | --- | --- |
| raw+gate | 0/45 | 0/24 | 0/45 | 0/15 |
| serv+gate | 24/45 | 0/24 | 21/45 | 15/15 |
| checks-only | 21/45 | 0/24 | 24/45 | 15/15 |

Cases where SERV changed the outcome vs checks-only (case-majority, aggregates only):

| Direction | Cases |
| --- | --- |
| SERV blocked a checks-only PROCEED | 0 |
| SERV enabled nothing by itself (unsupported enables) | 0 |
| Other action disagreements | 1 |
| Missing SERV majority | 0 |
| Compared | 15 |
