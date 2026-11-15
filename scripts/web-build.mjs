import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

// Reuse repository metadata when available; a build-time override is optional.
// No key is needed for building the client bundle.
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const repository = typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url;
const candidate = process.env.VITE_REPO_URL || repository || "";
const repoUrl = candidate.replace(/^git\+/u, "").replace(/^git@github\.com:/u, "https://github.com/").replace(/\.git$/u, "");
const result = spawnSync("npm", ["--prefix", "web", "run", "build"], {
  stdio: "inherit",
  env: { ...process.env, VITE_REPO_URL: /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/u.test(repoUrl) ? repoUrl : "" },
});
process.exitCode = result.status ?? 1;
// Keep the output bind-mount directory present in a fresh checkout.
if (result.status === 0) await writeFile("web/dist/.gitkeep", "\n");
