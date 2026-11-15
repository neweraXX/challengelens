import { ADAPTERS } from "../config/adapters.js";
import { DEPLOYMENTS } from "../config/pilot.js";
import { decodeAncillary, pricesDiffer } from "../src/collect/ancillary.js";
import { ResponseCache } from "../src/collect/cache.js";
import { joinGamma } from "../src/collect/gamma.js";
import { collectDeployment } from "../src/collect/goldsky.js";
import { PublicHttp, safeMessage } from "../src/collect/http.js";
import { requesterCounts, writeReports } from "../src/collect/report.js";
import type { Candidate, Sample, SourceReport } from "../src/collect/types.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--offline", "--refresh"].includes(arg))) {
    throw new Error("Usage: npm run pilot -- [--offline | --refresh]");
  }
  const options = { offline: args.includes("--offline"), refresh: args.includes("--refresh") };
  if (options.offline && options.refresh) throw new Error("--offline and --refresh cannot be combined.");

  const http = new PublicHttp();
  const cache = new ResponseCache(http, options);
  const samples: Sample[] = [];
  const sources: SourceReport[] = [];
  try {
    // Sequential, capped and throttled. Both deployments are attempted even if one fails.
    for (const deployment of DEPLOYMENTS) {
      sources.push(await collectDeployment(cache, deployment, samples));
    }
    samples.sort((a, b) => a.deployment.localeCompare(b.deployment, "en") ||
      a.kind.localeCompare(b.kind, "en") || a.raw.id.localeCompare(b.raw.id, "en"));

    console.log("\nRequester frequency before adapter filtering:");
    console.log("requester\ttotal\tdisputed\tcontrols");
    for (const row of requesterCounts(samples)) {
      console.log(`${row.requester}\t${row.total}\t${row.disputed}\t${row.controls}`);
    }
    console.warn("Adapter seeds are unverified. Verify addresses and add missing adapters from the frequency table.");

    const candidates: Candidate[] = [];
    for (const sample of samples) {
      const adapter = ADAPTERS.find((entry) => entry.address.toLowerCase() === sample.raw.requester.toLowerCase());
      if (!adapter) continue;
      const ancillary = decodeAncillary(sample.raw.ancillaryData);
      const gamma = await joinGamma(cache, ancillary);
      candidates.push({
        schemaVersion: "pilot-1", chainId: 137,
        deployment: sample.deployment, frozenBlock: sample.block,
        sampleKind: sample.kind, requestCacheFile: sample.cacheFile,
        adapter: { ...adapter }, raw: sample.raw, ancillary, gamma,
        settlementDiffersFromProposal: pricesDiffer(sample.raw.proposedPrice, sample.raw.settlementPrice),
        identityVerifiedAgainstReceipts: false,
        controlDisputeAbsenceVerifiedAgainstLogs: false,
      });
      console.log(`Adapter candidate ${candidates.length}: ${sample.deployment}/${sample.raw.id}; Gamma ${gamma.status}`);
    }

    await writeReports(samples, candidates, sources, options);
    console.log(`\nWrote ${candidates.length} adapter candidates from ${samples.length} sampled requests.`);
    console.log("Outputs: data/pilot/candidates.jsonl, data/pilot/summary.md, data/pilot/audit.csv");
    const incomplete = sources.some((source) => source.error) ||
      candidates.some((candidate) => candidate.gamma.attempts.some((attempt) => attempt.error) || candidate.ancillary.error);
    if (incomplete || candidates.length === 0) {
      console.error("Pilot needs follow-up: inspect source/Gamma errors, decode errors and the adapter frequency table. Outputs may be partial.");
      process.exitCode = 1;
    }
  } finally {
    await http.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Pilot failed: ${safeMessage(error)}`);
  process.exitCode = 1;
});
