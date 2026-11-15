const GOLDSKY =
  "https://api.goldsky.com/api/public/project_clus2fndawbcc01w31192938i/subgraphs/";

export const DEPLOYMENTS = [
  { name: "oov2", url: `${GOLDSKY}polygon-optimistic-oracle-v2/1.1.0/gn` },
  { name: "managed-oov2", url: `${GOLDSKY}polygon-managed-optimistic-oracle-v2/1.0.5/gn` },
] as const;

export const SCHEMA_URL =
  "https://raw.githubusercontent.com/UMAprotocol/subgraphs/master/packages/optimistic-oracle-v2/schema.graphql";
export const GAMMA_URL = "https://gamma-api.polymarket.com";
export const PAGE_SIZE = 200;
export const DISPUTED_PER_DEPLOYMENT = 300;
export const CONTROLS_PER_DEPLOYMENT = 50;
export const REQUEST_DELAY_MS = 350;
