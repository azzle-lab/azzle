import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { selector } from "../agents/bankr-skill/azzle/scripts/lib/keccak256.mjs";
import { parseTaskId } from "../agents/bankr-skill/azzle/scripts/v2-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const skillRoot = resolve(root, "agents", "bankr-skill", "azzle");
const manifests = {
  standard: JSON.parse(readFileSync(resolve(root, "contracts", "deployments", "base-8453.json"), "utf8")),
  micro: JSON.parse(readFileSync(resolve(root, "contracts", "deployments", "base-8453-micro.json"), "utf8")),
};
const pinPath = (market) =>
  resolve(skillRoot, "references", `base-8453-${market}-v2-pinned.json`);
const identityPath = (market) =>
  resolve(skillRoot, "references", `base-8453-${market}-v2-identities.json`);
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const requiredFiles = [
  "SKILL.md",
  "catalog.json",
  "references/onboarding.md",
  "references/protocol.md",
  "references/base-8453-standard-v2-pinned.json",
  "references/base-8453-micro-v2-pinned.json",
  "references/base-8453-standard-v2-identities.json",
  "references/base-8453-micro-v2-identities.json",
  "references/signing-allowlist.json",
  "references/sdk-pin.json",
  "scripts/v2-tasks.sh",
  "scripts/v2-inspect.mjs",
  "scripts/v2-lib.mjs",
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

const allowlist = JSON.parse(readFileSync(resolve(skillRoot, "references", "signing-allowlist.json"), "utf8"));
if (allowlist.version !== "2.0.0" || String(allowlist.chainId) !== "8453") {
  fail("signing allowlist must target AZZLE V2 on Base");
}
if (selector("approve(address,uint256)") !== "0x095ea7b3") fail("keccak selector helper is wrong");
for (const [target, signatures] of Object.entries(allowlist.targets || {})) {
  if (!Array.isArray(signatures) || !signatures.length) fail(`signing allowlist missing selectors for ${target}`);
  for (const signature of signatures) {
    if (!/^0x[0-9a-f]{8}$/.test(selector(signature))) fail(`invalid selector signature ${signature}`);
  }
}
if (!allowlist.targets.taskRegistry?.includes("claim(uint256)")) fail("signing allowlist must allow taskRegistry.claim");
if (!allowlist.targets.azl?.includes("approve(address,uint256)")) fail("signing allowlist must allow AZL approve");
if (allowlist.spenders?.azl !== "escrowVault" || allowlist.spenders?.usdc !== "paymentGateway") {
  fail("signing allowlist spenders must be AZL->escrowVault and USDC->paymentGateway");
}

const sdkPin = JSON.parse(readFileSync(resolve(skillRoot, "references", "sdk-pin.json"), "utf8"));
if (sdkPin.name !== "@azzle/agents" || sdkPin.version !== "0.5.0") fail("sdk pin must be @azzle/agents@0.5.0");
if (!String(sdkPin.integrity || "").startsWith("sha512-")) fail("sdk pin must include a sha512 integrity hash");
if (!String(sdkPin.resolved || "").includes("agents-0.5.0.tgz")) fail("sdk pin resolved tarball must match 0.5.0");

for (const [market, manifest] of Object.entries(manifests)) {
  try {
    const pin = JSON.parse(readFileSync(pinPath(market), "utf8"));
    const identities = JSON.parse(readFileSync(identityPath(market), "utf8"));
    if (identities.market !== market) fail(`${market} identity pin must declare market '${market}'`);
    for (const path of ["version", "chainId", "deploymentBlock", "deployer", "factory", "governance", "bundleHash", "finalizedTx"]) {
      if (String(valueAtPath(identities, path)).toLowerCase() !== String(valueAtPath(pin, path)).toLowerCase()) {
        fail(`${market} identity metadata differs at ${path}`);
      }
    }
    if (!HASH_RE.test(identities.suiteDeployedHash)) fail(`${market} identity pin missing suiteDeployedHash`);
    const keys = ["factory", ...allowlist.graphKeys, "azl", "usdc"];
    for (const key of keys) {
      const expected = key === "azl" || key === "usdc" ? pin.external[key] : pin[key];
      const identity = identities.identities?.[key];
      if (!identity) fail(`${market} identity pin missing ${key}`);
      if (identity.address?.toLowerCase() !== String(expected).toLowerCase()) {
        fail(`${market} identity address differs at ${key}`);
      }
      if (!HASH_RE.test(identity.runtimeCodeHash)) fail(`${market} identity missing runtimeCodeHash at ${key}`);
    }
    if (!HASH_RE.test(identities.identities.usdc.implementationCodeHash)) {
      fail(`${market} identity pin must include the USDC implementation code hash`);
    }
  } catch (error) {
    fail(`${market} identity pin is invalid: ${error.message}`);
  }
}

try {
  parseTaskId("v2:standard:42");
  parseTaskId("v2:micro:1");
  for (const bad of ["42", "v2:42", "v2:standard:0", "v2:standard:01", "v2:other:1"]) {
    try {
      parseTaskId(bad);
      fail(`task parser accepted illegal id ${bad}`);
    } catch {
      /* expected */
    }
  }
} catch (error) {
  fail(`task parser self-check failed: ${error.message}`);
}

const helper = readFileSync(resolve(skillRoot, "scripts", "v2-tasks.sh"), "utf8");
if (!helper.includes("v2-inspect.mjs") || !helper.includes("verify")) {
  fail("v2-tasks.sh must route through v2-inspect.mjs including verify");
}
if (/curl .*get-task/.test(helper)) fail("v2-tasks.sh must not print unvalidated get-task API output");

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
  "base-8453-standard-v2-identities.json",
  "signing-allowlist.json",
  "sdk-pin.json",
  "loadMarketManifest",
  "parseTaskRef",
  "fail closed",
  "runtimeCodeHash",
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
  [/\bloadBaseMainnetV2Manifest\s*\(\s*\)/, "unpinned loadBaseMainnetV2Manifest() default"],
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
if (/(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.test(proseContent)) {
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
