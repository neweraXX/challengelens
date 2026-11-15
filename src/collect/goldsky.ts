import {
  CONTROLS_PER_DEPLOYMENT, DISPUTED_PER_DEPLOYMENT, PAGE_SIZE, SCHEMA_URL,
} from "../../config/pilot.js";
import type { ResponseCache } from "./cache.js";
import { safeMessage } from "./http.js";
import type { FrozenBlock, OracleRequest, Sample, SampleKind, SourceReport } from "./types.js";

export const FIELDS = `
  id requester identifier time ancillaryData
  proposer proposedPrice disputer state
  requestTimestamp requestBlockNumber requestHash requestLogIndex
  proposalTimestamp proposalBlockNumber proposalHash proposalLogIndex
  proposalExpirationTimestamp
  disputeTimestamp disputeHash
  settlementPrice settlementTimestamp settlementHash
  currency bond finalFee reward customLiveness eventBased
`;

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string }[];
}

interface Deployment {
  name: string;
  url: string;
}

async function showSchema(cache: ResponseCache): Promise<void> {
  console.error(`Schema reference: ${SCHEMA_URL}`);
  try {
    const schema = await cache.text("schema", SCHEMA_URL);
    console.error(`Public schema cached at ${schema.cacheFile}`);
    const requestType = schema.value.match(/type\s+OptimisticPriceRequest\b[^\{]*\{[\s\S]*?\n\}/u)?.[0];
    console.error(requestType?.slice(0, 12_000) ?? "Request type not found; inspect the cached schema manually.");
    console.error("Compare the fields above with the query. The master schema may differ from the deployed schema; do not silently drop identity fields.");
  } catch (error) {
    console.error(`Could not fetch the schema: ${safeMessage(error)}`);
  }
}

async function query<T>(
  cache: ResponseCache,
  deployment: Deployment,
  document: string,
  variables: Record<string, unknown>,
): Promise<{ data: T; cacheFile: string }> {
  const response = await cache.json<GraphQLResponse<T>>(`goldsky-${deployment.name}`, deployment.url, {
    method: "POST", body: JSON.stringify({ query: document, variables }),
  });
  if (response.value.errors?.length) {
    const messages = response.value.errors.map((error) => safeMessage(new Error(error.message))).join("\n");
    console.error(`GraphQL errors [${deployment.name}] (${response.cacheFile}):\n${messages}`);
    console.error(`Query:\n${document}\nVariables: ${JSON.stringify(variables)}`);
    await showSchema(cache);
    throw new Error(`GraphQL failed for ${deployment.name}; inspect the printed errors, query and schema.`);
  }
  if (!response.value.data) throw new Error(`Missing GraphQL data for ${deployment.name}; inspect ${response.cacheFile}`);
  return { data: response.value.data, cacheFile: response.cacheFile };
}

function noDisputer(value: unknown): boolean {
  return value === null || value === undefined || value === "" ||
    (typeof value === "string" && /^0x0+$/iu.test(value));
}

function isRequest(value: unknown): value is OracleRequest {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.id.length > 0 &&
    typeof row.requester === "string" && /^0x[0-9a-f]{40}$/iu.test(row.requester) &&
    typeof row.ancillaryData === "string" && typeof row.identifier === "string" &&
    typeof row.time === "string" && typeof row.requestTimestamp === "string" &&
    row.state === "Settled";
}

async function paginate(
  cache: ResponseCache,
  deployment: Deployment,
  block: FrozenBlock,
  kind: SampleKind,
  filter: string,
  limit: number,
  samples: Sample[],
  report: SourceReport,
): Promise<number> {
  let after = "";
  let count = 0;
  const document = `query Candidates($block: Int!, $after: ID!, $first: Int!) {
    optimisticPriceRequests(
      block: {number: $block}
      first: $first
      orderBy: id
      orderDirection: asc
      where: {id_gt: $after, state: Settled, ${filter}}
    ) { ${FIELDS} }
  }`;

  while (count < limit) {
    const first = Math.min(PAGE_SIZE, limit - count);
    const page = await query<{ optimisticPriceRequests: unknown }>(cache, deployment, document, {
      block: block.number, after, first,
    });
    const rows = page.data.optimisticPriceRequests;
    if (!Array.isArray(rows)) throw new Error(`Expected optimisticPriceRequests array for ${deployment.name}.`);
    if (rows.length > first) throw new Error(`Goldsky returned more than the requested page size for ${deployment.name}.`);
    let previous = after;
    // Validate the entire page before adding it to the sample.
    for (const row of rows) {
      if (!isRequest(row)) throw new Error(`Invalid request fields for ${deployment.name}; inspect ${page.cacheFile}`);
      if (row.id <= previous) throw new Error(`Non-increasing IDs for ${deployment.name}; refusing unsafe pagination.`);
      previous = row.id;
      if (kind === "disputed" && !/^[1-9]\d*$/u.test(String(row.disputeTimestamp))) {
        throw new Error(`Disputed query returned a missing/zero dispute timestamp; inspect ${page.cacheFile}`);
      }
      if (kind === "undisputed_control" && (!noDisputer(row.disputer) ||
          ![null, undefined, "0"].includes(row.disputeTimestamp))) {
        throw new Error(`Control query returned dispute fields; verify null conventions in ${page.cacheFile}`);
      }
    }
    for (const row of rows as OracleRequest[]) {
      samples.push({ deployment: deployment.name, block, kind, cacheFile: page.cacheFile, raw: row });
    }
    count += rows.length;
    if (kind === "disputed") report.disputed += rows.length;
    else report.controls += rows.length;
    console.log(`${deployment.name}: ${kind} ${count}/${limit} at block ${block.number}`);
    if (rows.length < first) break;
    after = previous;
  }
  return count;
}

export async function collectDeployment(
  cache: ResponseCache,
  deployment: Deployment,
  samples: Sample[],
): Promise<SourceReport> {
  const report: SourceReport = {
    deployment: deployment.name, block: null, disputed: 0, controls: 0,
    controlFilter: "disputer: null", error: null,
  };
  try {
    const meta = await query<{
      _meta: { block: { number: number; hash: string | null }; hasIndexingErrors: boolean } | null;
    }>(cache, deployment, "query Snapshot { _meta { block { number hash } hasIndexingErrors } }", {});
    const indexed = meta.data._meta;
    if (!indexed || !Number.isSafeInteger(indexed.block?.number) || indexed.block.number <= 0 ||
        typeof indexed.hasIndexingErrors !== "boolean") {
      throw new Error(`No usable indexed block in ${deployment.name}; inspect ${meta.cacheFile}`);
    }
    if (indexed.hasIndexingErrors) throw new Error(`Indexing errors in ${deployment.name}; refusing this snapshot.`);
    const block: FrozenBlock = {
      number: indexed.block.number, hash: indexed.block.hash ?? null,
      hasIndexingErrors: indexed.hasIndexingErrors,
    };
    report.block = block;
    await paginate(cache, deployment, block, "disputed", 'disputeTimestamp_gt: "0"',
      DISPUTED_PER_DEPLOYMENT, samples, report);
    const controls = await paginate(cache, deployment, block, "undisputed_control", "disputer: null",
      CONTROLS_PER_DEPLOYMENT, samples, report);
    if (controls === 0) {
      // Some deployments encode absence as zero instead of null. We still check
      // both dispute fields on every returned row; receipts are a later B2 check.
      report.controlFilter = 'disputeTimestamp: "0" (null-disputer query returned no rows)';
      await paginate(cache, deployment, block, "undisputed_control", 'disputeTimestamp: "0"',
        CONTROLS_PER_DEPLOYMENT, samples, report);
    }
  } catch (error) {
    report.error = safeMessage(error);
    console.error(`${deployment.name}: ${report.error}`);
  }
  return report;
}
