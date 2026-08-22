import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const skillRoot = resolve(root, "agents", "bankr-skill", "azzle");
const manifests = {
  standard: JSON.parse(readFileSync(resolve(root, "contracts", "deployments", "base-8453.json"), "utf8")),
  micro: JSON.parse(readFileSync(resolve(root, "contracts", "deployments", "base-8453-micro.json"), "utf8")),
};
const pinPath = (market) =>
  resolve(skillRoot, "references", `base-8453-${market}-v2-pinned.json`);

const requiredFiles = [
  "SKILL.md",
  "catalog.json",
  "references/onboarding.md",
  "references/protocol.md",
  "references/base-8453-standard-v2-pinned.json",
  "references/base-8453-micro-v2-pinned.json",
  "scripts/v2-tasks.sh",
];

const failures = [];
function fail(message) {
  failures.push(message);
}

function filesIn(directory) {
  const out = [];
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else out.push(path);
  }
  return out;
}

for (const file of requiredFiles) {
  try {
    readFileSync(resolve(skillRoot, file), "utf8");
  } catch {
    fail(`missing required file: ${file}`);
  }
}

const textFiles = filesIn(skillRoot).filter((path) => !path.endsWith(".svg"));
const content = textFiles
  .map((path) => `${relative(skillRoot, path)}\n${readFileSync(path, "utf8")}`)
  .join("\n");

function addressLeaves(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => addressLeaves(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      addressLeaves(item, prefix ? `${prefix}.${key}` : key),
    );
  }
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? [[prefix, value]]
    : [];
}

function valueAtPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

for (const [market, manifest] of Object.entries(manifests)) {
 try {
  const pinnedManifest = JSON.parse(readFileSync(pinPath(market), "utf8"));
  if (pinnedManifest.market !== market) fail(`${market} pin must declare market '${market}'`);
  for (const [path, address] of addressLeaves(manifest)) {
    if (valueAtPath(pinnedManifest, path)?.toLowerCase() !== address.toLowerCase()) {
      fail(`${market} pinned manifest address differs at ${path}`);
    }
  }
  for (const [path] of addressLeaves(pinnedManifest)) {
    if (valueAtPath(manifest, path) === undefined) {
      fail(`${market} pinned manifest has unreviewed address at ${path}`);
    }
  }
  for (const path of [
    "version",
    "chainId",
    "market",
    "deploymentBlock",
    "bundleHash",
    "external.poolId",
    "risk.creditContext",
    "finalizedTx",
  ]) {
    if (valueAtPath(pinnedManifest, path) !== valueAtPath(manifest, path)) {
      fail(`${market} pinned manifest metadata differs at ${path}`);
    }
  }
} catch (error) {
  fail(`${market} pinned manifest is invalid: ${error.message}`);
 }
}

for (const path of [
  "chainId", "external.chainId", "external.usdc", "external.weth", "external.azl",
  "external.poolManager", "external.universalRouter", "external.hook",
  "external.ethUsdFeed", "external.poolId", "observationOracle", "twapAdapter", "usdOracle",
]) {
  if (String(valueAtPath(manifests.standard, path)).toLowerCase() !==
      String(valueAtPath(manifests.micro, path)).toLowerCase()) {
    fail(`shared oracle/external invariant differs at ${path}`);
  }
}
for (const path of [
  "factory", "treasuryRouter", "pricingPolicy", "depositVault", "escrowVault",
  "reputationRegistry", "verifierBondVault", "stakingVault", "taskRegistry",
  "arbitrationModule", "usdcWethLeg", "exactInputExecutor", "paymentGateway",
  "taskScopeRegistry", "risk.creditContext",
]) {
  if (String(valueAtPath(manifests.standard, path)).toLowerCase() ===
      String(valueAtPath(manifests.micro, path)).toLowerCase()) {
    fail(`market graph must be isolated at ${path}`);
  }
}

const requiredPhrases = [
  "base-8453-standard-v2-pinned.json",
  "base-8453-micro-v2-pinned.json",
  "v2:standard:N",
  "v2:micro:N",
  "micro only when explicitly",
  "runtime code",
  "validateGraph()",
  "AZL wei (18 decimals)",
  "paymentGateway",
  "paymentGateway.intakePaused()",
  "pricingPolicy.quoteTask()",
  "depositVault.taskQuotes(taskId)",
  "depositVault.available(wallet)",
  "latched",
  "Required available",
  "Base RPC",
  "markDelivered",
  "CANCELLED",
  "explicit user confirmation",
];
for (const phrase of requiredPhrases) {
  if (!content.includes(phrase)) fail(`missing required V2 phrase: ${phrase}`);
}

const forbidden = [
  [/api\.studio\.thegraph\.com/i, "retired subgraph URL"],
  [/raw\.githubusercontent\.com\/Dabus123\/azzle\/main\/contracts\/deployments\/base-8453\.json/i, "mutable upstream deployment manifest"],
  [/\b(fetch|reload)\b.{0,80}\bmanifest\b.{0,80}\b(before|immediately before)\b.{0,40}\bwrite\b/i, "mutable manifest refresh instruction"],
  [/\bclaim\b.{0,120}\bcurrent\b.{0,40}\bquote\b/i, "current quote presented as claim cost"],
  [/AZZLE_SUBGRAPH_URL/i, "retired subgraph environment variable"],
  [new RegExp(`Subgraph${"Indexer"}`, "i"), "retired SDK indexer"],
  [/subgraph-open-tasks/i, "retired discovery script"],
  [/\bpostTask\b/, "legacy postTask selector"],
  [/\bclaimTask\b/, "legacy claimTask selector"],
  [/\bfundTask\b/, "legacy fundTask selector"],
  [/\bstartWork\b/, "legacy startWork selector"],
  [/\bsubmitProof\b/, "legacy submitProof selector"],
  [/\bacceptMilestone\b/, "legacy acceptMilestone selector"],
  [/\bIN_REVIEW\b/, "legacy IN_REVIEW state"],
  [/\bPAUSED\b/, "legacy PAUSED state"],
  [/\bDELETED\b/, "legacy DELETED state"],
  [/\b20 USDC\b/i, "legacy $20 entry deposit"],
  [/\b1,000 (?:AZL|AZZLE)\b/i, "legacy fixed AZL access fee"],
  [/\bUSDC escrow\b/i, "legacy USDC task escrow"],
  [/0x0a47c3a2d515ec3a23f225a7bac1b0a1654e4d48/i, "legacy TaskRegistry address"],
  [/0xd1f3058650ab22250d139dba5b2b48118071dc36/i, "legacy EscrowVault address"],
  [/0x62808379CbDEfe7E8b2FcD659158E49463c34e5D/i, "legacy AgentDepositVault address"],
  [/0x6bEBf56a67c8B38cB4d8FF328252FbE9662201b6/i, "legacy TreasuryRouter address"],
];
for (const [pattern, label] of forbidden) {
  if (pattern.test(content)) fail(`contains ${label}`);
}

const proseContent = textFiles
  .filter((path) => !path.endsWith(".json"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
if (/0x[0-9a-fA-F]{40}/.test(proseContent)) {
  fail("contract/token addresses must remain in reviewed pins, not prose");
}
for (const invalid of ["task 42", "scope 42", "id=v2:42"]) {
  if (content.includes(invalid)) fail(`contains non-canonical sample task reference: ${invalid}`);
}

try {
  const catalog = JSON.parse(readFileSync(resolve(skillRoot, "catalog.json"), "utf8"));
  if (catalog.slug !== "azzle") fail("catalog slug must be azzle");
  if (catalog.install?.repoPath !== "azzle") fail("catalog repoPath must be azzle");
} catch (error) {
  fail(`catalog.json is invalid: ${error.message}`);
}

const bash = spawnSync(
  "bash",
  ["-n", resolve(skillRoot, "scripts", "v2-tasks.sh")],
  { encoding: "utf8" },
);
const bashUnavailable = process.platform === "win32" || bash.error?.code === "ENOENT";
if (bash.error && !bashUnavailable) {
  fail(`could not run Bash syntax check: ${bash.error.message}`);
} else if (!bashUnavailable && bash.status !== 0) {
  fail(`v2-tasks.sh failed Bash syntax check: ${bash.stderr.trim()}`);
}

if (failures.length) {
  console.error("Bankr AZZLE skill validation failed:");
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`Bankr AZZLE skill is canonical V2 (${textFiles.length} files checked).`);
