/** Regression guard for active AZZLE V2 protocol surfaces. */
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const activeRoots = [
  "README.md", "AGENTS.md", "QUICKSTART.md", "BOOTSTRAP.md", "MASTERSKILL.md", "SECURITY.md",
  "protocol", "arbitration", "reputation", "site", "launch-skills", "agents", "api", "docs", "xmtp-spec",
  "src", "examples", "azzle-force/src", "azzle-force/README.md",
];
const ignoredNames = new Set(["node_modules", ".git", ".agents", "public", "dist", "coverage", "artifacts", "cache", "typechain-types"]);
const ignoredPrefixes = ["archive/", "docs/legacy-v1/", "contracts/", "site/generated/", "agents/dist/", "azzle-force/dist/", "site/role-wallet.bundle.js", "site/film.html", "site/trailer-azl.html", "launch-skills/azzle-film.html", "launch-skills/trailer_video.html", "api/get-legacy-"];
const allowedExtensions = /\.(?:md|mjs|js|ts|tsx|json|html|yml|yaml)$/i;
const legacyAddresses = [
  "0xd931bbc52fabcc2ee5f52b3be489a92b29941054",
  "0x35c4233ae2dd247a726080aa80c232a4f98d2a2d",
  "0xabaa2dcbf3a391cdaab7eeae0cbd50c3128970cc",
  "0x5e6dce7ac4a805761be4b124277c43c33ad3e825",
];
const retiredSelectors = ["postTask", "claimTask", "fundTask", "startWork", "submitProof", "acceptMilestone", "createTask", "acceptDirectHire", "dismissWorker", "leaveTask"];
const retiredStates = ["IN_REVIEW", "PAUSED", "DELETED", "STREAMING", "HOUR_BLOCKS"];
const legacyClaims = [
  [/\$5\s*USDC\s*\+\s*1(?:,|_)?000\s*(?:\$?AZL|AZZLE)/gi, "fixed dual fee"],
  [/\b(?:job payment|task payment|task escrow|USDC escrow|escrowed?)\b[^.;\n]{0,80}\bUSDC\b/gi, "USDC task escrow"],
  [/\bUSDC\b[^.;\n]{0,80}\b(?:AgentDepositVault|deposit vault|entry collateral|topUp)\b/gi, "USDC deposit collateral"],
  [/\b(?:subgraph|The Graph)\b[^\n]{0,100}\b(?:discover|index|market|task|authoritative|source)\w*\b/gi, "retired subgraph authority"],
  [/\b(?:direct[- ]hire|acceptDirectHire|createTask)\b/gi, "direct-hire flow"],
  [/\b(?:proof[- ]review|proof review|submitProof|IN_REVIEW)\b/gi, "proof-review flow"],
  [/\b(?:fixed|flat)\s+(?:(?:1(?:,|_)?000|[0-9]+)\s*[- ]?)?(?:(?:AZL|AZZLE|token|access|claim)\s*[- ]?)?fee\b/gi, "fixed-fee claim"],
  [/\bsingle\s+(?:V2\s+)?market\b|\bthe\s+only\s+(?:V2\s+)?market\b|\b(?:standard|micro)\s+is\s+the\s+only\s+market\b/gi, "single-market claim"],
];
const legacyExplanation = /\b(?:legacy|retired|deprecated|reserved|historical|v1|removed|unsupported|does not|has no|there is no|is no|no longer|do not|never|instead of|unlike|not a separate|reject(?:ed|s)?|forbid(?:den|s)?|illegal)\b/i;
const unscopedIdExplanation = /\b(?:unscoped|bare|legacy|v1|reject(?:ed|s)?|forbid(?:den|s)?|illegal|unsupported)\b/i;
const invalidIdExplanation = /\b(?:invalid|reject(?:ed|s)?|forbid(?:den|s)?|illegal|unsupported)\b/i;
const claimScanPrefixes = [
  "README.md", "AGENTS.md", "QUICKSTART.md", "BOOTSTRAP.md", "MASTERSKILL.md",
  "protocol/", "arbitration/", "reputation/", "site/", "launch-skills/", "agents/",
  "api/", "docs/", "xmtp-spec/", "src/", "examples/", "azzle-force/",
];
const claimAllowFiles = new Set(["agents/scripts/validate-xmtp-schemas.mjs"]);
const retiredTokenPrefixes = [
  "agents/src/sdk/client", "agents/src/sdk/rpc-discovery", "agents/src/sdk/base-rpc-indexer",
  "agents/src/sdk/manifest", "api/lib/tasks-rpc", "api/lib/task-detail",
];
const strictTaskId = /^v2:(standard|micro):[1-9][0-9]*$/;

async function collect(path) {
  const statEntries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(statEntries.map(async (entry) => {
    if (ignoredNames.has(entry.name)) return [];
    const child = join(path, entry.name);
    return entry.isDirectory() ? collect(child) : [child];
  }));
  return nested.flat();
}

function scopedContext(content, index) {
  const lineStart = content.lastIndexOf("\n", index) + 1;
  const lineEnd = content.indexOf("\n", index);
  return content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
}

function isExplained(content, index) {
  return legacyExplanation.test(scopedContext(content, index));
}

const paths = [];
for (const surface of activeRoots) {
  const absolute = join(root, surface);
  try {
    const found = surface.includes(".") ? [absolute] : await collect(absolute);
    paths.push(...found);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const violations = [];
for (const path of new Set(paths)) {
  const rel = relative(root, path).split(sep).join("/");
  if (ignoredPrefixes.some((prefix) => rel.startsWith(prefix)) || !allowedExtensions.test(rel)) continue;
  const content = await readFile(path, "utf8");
  const lower = content.toLowerCase();
  for (const address of legacyAddresses) if (lower.includes(address)) violations.push(`${rel}: stale copied address ${address}`);
  const strict = claimScanPrefixes.some((prefix) => rel === prefix || rel.startsWith(prefix));
  if (retiredTokenPrefixes.some((prefix) => rel.startsWith(prefix))) {
    for (const token of [...retiredSelectors, ...retiredStates]) {
      const pattern = new RegExp(`\\b${token}\\b`, "g");
      for (const match of content.matchAll(pattern)) if (!isExplained(content, match.index)) violations.push(`${rel}: active retired token ${token}`);
    }
  }
  for (const [pattern, label] of legacyClaims) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) if (strict && !claimAllowFiles.has(rel) && !isExplained(content, match.index)) violations.push(`${rel}: ${label}`);
  }
  for (const match of content.matchAll(/\bv2:([0-9]+)\b/g)) {
    if (!claimAllowFiles.has(rel) && !unscopedIdExplanation.test(scopedContext(content, match.index))) violations.push(`${rel}: unscoped task id ${match[0]}`);
  }
  for (const match of content.matchAll(/\bv2:(standard|micro):([0-9]+)\b/gi)) {
    if (!strictTaskId.test(match[0].toLowerCase()) && !invalidIdExplanation.test(scopedContext(content, match.index))) {
      violations.push(`${rel}: non-strict task id ${match[0]}`);
    }
  }
  for (const match of content.matchAll(/\^v2:\(standard\|micro\):(?:(?:\[0-9\]|\\d)\+|\((?:\[0-9\]|\\d)\+\))\$/g)) {
    violations.push(`${rel}: permissive task-id pattern ${match[0]}`);
  }
}

const canonical = JSON.parse(await readFile(join(root, "contracts", "deployments", "base-8453.json"), "utf8"));
const micro = JSON.parse(await readFile(join(root, "contracts", "deployments", "base-8453-micro.json"), "utf8"));
if (canonical.market !== "standard") violations.push("contracts/deployments/base-8453.json: market must be standard");
if (micro.market !== "micro") violations.push("contracts/deployments/base-8453-micro.json: market must be micro");
if (micro.observationOracle?.toLowerCase() !== canonical.observationOracle?.toLowerCase()
  || micro.twapAdapter?.toLowerCase() !== canonical.twapAdapter?.toLowerCase()
  || micro.usdOracle?.toLowerCase() !== canonical.usdOracle?.toLowerCase()) {
  violations.push("micro manifest must reuse the live standard oracle stack");
}
for (const key of ["factory", "pricingPolicy", "depositVault", "escrowVault", "reputationRegistry", "verifierBondVault", "stakingVault", "treasuryRouter", "taskRegistry", "arbitrationModule", "paymentGateway", "taskScopeRegistry", "usdcWethLeg", "exactInputExecutor"]) {
  if (micro[key]?.toLowerCase() === canonical[key]?.toLowerCase()) violations.push(`market graphs must be isolated at ${key}`);
}
for (const key of ["azl", "usdc", "weth", "poolManager", "universalRouter", "hook", "ethUsdFeed", "poolId"]) {
  if (micro.external?.[key]?.toLowerCase() !== canonical.external?.[key]?.toLowerCase()) violations.push(`markets must share external.${key}`);
}
for (const rel of ["agents/deployments/base-8453.json", "api/lib/contracts.json"]) {
  const actual = JSON.parse(await readFile(join(root, rel), "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) violations.push(`${rel}: differs from canonical manifest`);
}
for (const rel of ["agents/deployments/base-8453-micro.json", "api/lib/contracts-micro.json"]) {
  try {
    const actual = JSON.parse(await readFile(join(root, rel), "utf8"));
    if (JSON.stringify(actual) !== JSON.stringify(micro)) violations.push(`${rel}: differs from canonical micro manifest`);
  } catch {
    violations.push(`${rel}: missing micro manifest consumer`);
  }
}
const x402Manifest = await readFile(join(root, "agents", "x402-cloud", "x402", "manifest.ts"), "utf8");
if (
  !x402Manifest.includes("GENERATED by scripts/sync-manifest-surfaces.mjs")
  || !x402Manifest.includes(canonical.taskRegistry)
  || !x402Manifest.includes(canonical.stakingVault)
  || !x402Manifest.includes(micro.taskRegistry)
  || !x402Manifest.includes(micro.stakingVault)
  || !x402Manifest.includes("BASE_MAINNET_MANIFESTS")
  || !x402Manifest.includes("selectBaseMainnetManifest")
) {
  violations.push("agents/x402-cloud/x402/manifest.ts: stale generated dual-market manifest consumer");
}
const launchManifest = await readFile(join(root, "launch-skills", "js", "manifest.generated.js"), "utf8");
if (
  !launchManifest.includes("GENERATED by contracts/scripts/promote-manifest.ts")
  || !launchManifest.includes(canonical.taskRegistry)
  || !launchManifest.includes(canonical.stakingVault)
  || !launchManifest.includes("MANIFEST")
) {
  violations.push("launch-skills/js/manifest.generated.js: stale generated manifest consumer");
}
const x402 = JSON.parse(await readFile(join(root, "agents", "x402-cloud", "bankr.x402.json"), "utf8"));
for (const [name, service] of Object.entries(x402.services ?? {})) if (service.tokenAddress?.toLowerCase() !== canonical.external.azl.toLowerCase()) violations.push(`agents/x402-cloud/bankr.x402.json: ${name} does not charge canonical AZL`);
if (!x402.services?.["azzle-task-scope"]) violations.push("agents/x402-cloud/bankr.x402.json: missing azzle-task-scope");
for (const [name, service] of Object.entries(x402.services ?? {})) {
  const input = service.schema?.input;
  if (!input?.required?.includes("market") || input.properties?.market?.enum?.join("|") !== "standard|micro") {
    violations.push(`agents/x402-cloud/bankr.x402.json: ${name} must require standard|micro market`);
  }
}
for (const name of ["azzle-task", "azzle-task-scope"]) {
  if (x402.services?.[name]?.schema?.input?.properties?.id?.pattern !== "^v2:(standard|micro):[1-9][0-9]*$") {
    violations.push(`agents/x402-cloud/bankr.x402.json: ${name} must require a strict market-qualified task ref`);
  }
}

const sourceWallet = await readFile(join(root, "src", "azzle-chain.js"), "utf8");
if (!sourceWallet.includes("postingFloorUsd6")) {
  violations.push("src/azzle-chain.js: posting floor must be market-specific");
}
const sdkDiscovery = await readFile(join(root, "agents", "src", "sdk", "rpc-discovery.ts"), "utf8");
if (sdkDiscovery.includes("`v2:${") && !sdkDiscovery.includes("namespacedTaskId")) {
  violations.push("agents/src/sdk/rpc-discovery.ts: unscoped v2:N task ids are illegal");
}
const apiReceipt = await readFile(join(root, "api", "post-delivery-receipt.js"), "utf8");
if (apiReceipt.includes("`v2:${") && !apiReceipt.includes("parseTaskRef")) {
  violations.push("api/post-delivery-receipt.js: unscoped v2:N task ids are illegal");
}
for (const rel of ["api/lib/markets.js", "agents/src/sdk/markets.ts", "site/markets.js", "src/azzle-chain.js"]) {
  const parser = await readFile(join(root, rel), "utf8");
  if (!parser.includes("[1-9]") || !parser.includes("standard|micro")) {
    violations.push(`${rel}: task parser must reject zero, leading-zero, bare, and unscoped ids`);
  }
}
for (const token of [...retiredSelectors, "topUp", "lockedBalance", "maxWithdrawableDeposit", "approveUsdcVault", "depositToVault", "withdrawFromVault"]) if (sourceWallet.includes(token)) violations.push(`src/azzle-chain.js: retired wallet token ${token}`);
try { await access(join(root, "site", "role-wallet.bundle.js")); } catch { console.log("[protocol-surface] generated wallet bundle absent; source check used"); }

if (violations.length) {
  console.error("Protocol surface regression(s):\n" + [...new Set(violations)].map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Protocol surface check passed (${new Set(paths).size} active files scanned).`);
