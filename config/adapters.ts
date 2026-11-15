// Verify these Polygon UMA CTF adapter addresses, deployment dates,
// and ancillary->questionID behavior against verified contracts/events.
// These are discovery seeds, NOT a verified allowlist for a production judge.
export const ADAPTERS = [
  // 2026-11-11: empirical top requesters from the pilot frequency table.
  // Verify on Polygonscan before treating as an allowlist.
  { address: "0x65070be91477460d8a7aeeb94ef92fe056c2f2a7", label: "Polymarket UMA CTF adapter (top requester)", verified: false },
  { address: "0x6a9d222616c90fca5754cd1333cfd9b7fb6a4f74", label: "Polymarket UMA CTF adapter v2", verified: false },
  { address: "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d", label: "Polymarket NegRisk UMA CTF adapter", verified: false },
  { address: "0x53703dd6129d723066b6362510e5ae2fecd48218", label: "observed live 2026-11-14, unverified label", verified: false },
  { address: "0x69c47de9d4d3dad79590d61b9e05918e03775f24", label: "observed live 2026-11-14, unverified label", verified: false },
] as const;
