import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "contracts", "deployments", "base-8453.json"), "utf8"));
const micro = JSON.parse(await readFile(join(root, "contracts", "deployments", "base-8453-micro.json"), "utf8"));
const siteConfig = await readFile(join(root, "site", "v2-config.js"), "utf8");
const browserManifest = await readFile(join(root, "launch-skills", "js", "manifest.generated.js"), "utf8");
const apiMarkets = await readFile(join(root, "api", "lib", "markets.js"), "utf8");
const apiSiteConfig = await readFile(join(root, "api", "site-config.js"), "utf8");

if (manifest.market !== "standard" || micro.market !== "micro") {
  throw new Error("Canonical manifests must declare standard and micro markets");
}
if (String(manifest.chainId) !== "8453" || String(micro.chainId) !== "8453") {
  throw new Error("Both markets must target Base chain 8453");
}

const sharedPaths = [
  ["observationOracle"], ["twapAdapter"], ["usdOracle"],
  ["external", "usdc"], ["external", "azl"], ["external", "weth"],
  ["external", "poolManager"], ["external", "universalRouter"], ["external", "hook"],
  ["external", "ethUsdFeed"], ["external", "poolId"],
];
const isolatedKeys = [
  "factory", "pricingPolicy", "depositVault", "escrowVault", "reputationRegistry",
  "verifierBondVault", "stakingVault", "treasuryRouter", "taskRegistry",
  "arbitrationModule", "paymentGateway", "taskScopeRegistry", "usdcWethLeg",
  "exactInputExecutor",
];
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const at = (value, path) => path.reduce((current, key) => current?.[key], value);
for (const path of sharedPaths) {
  const standardValue = at(manifest, path);
  const microValue = at(micro, path);
  const valid = path.at(-1) === "poolId" ? bytes32Pattern : addressPattern;
  if (!valid.test(standardValue) || !valid.test(microValue)
    || standardValue.toLowerCase() !== microValue.toLowerCase()) {
    throw new Error(`Shared market invariant differs at ${path.join(".")}`);
  }
}
for (const key of isolatedKeys) {
  if (!addressPattern.test(manifest[key]) || !addressPattern.test(micro[key])
    || manifest[key].toLowerCase() === micro[key].toLowerCase()) {
    throw new Error(`Market graph address must be isolated at ${key}`);
  }
}
if (!bytes32Pattern.test(manifest.risk?.creditContext)
  || !bytes32Pattern.test(micro.risk?.creditContext)
  || manifest.risk.creditContext.toLowerCase() === micro.risk.creditContext.toLowerCase()) {
  throw new Error("Market graph risk.creditContext must be valid and isolated");
}

const requiredAddresses = [
  manifest.factory,
  manifest.observationOracle,
  manifest.twapAdapter,
  manifest.usdOracle,
  manifest.pricingPolicy,
  manifest.depositVault,
  manifest.escrowVault,
  manifest.reputationRegistry,
  manifest.verifierBondVault,
  manifest.stakingVault,
  manifest.treasuryRouter,
  manifest.taskRegistry,
  manifest.arbitrationModule,
  manifest.paymentGateway,
  manifest.taskScopeRegistry,
  manifest.usdcWethLeg,
  manifest.exactInputExecutor,
  manifest.governance,
  manifest.external.usdc,
  manifest.external.azl,
  manifest.external.weth,
  manifest.external.poolManager,
  manifest.external.universalRouter,
  manifest.external.hook,
  manifest.external.ethUsdFeed,
  manifest.external.poolId,
];

for (const value of requiredAddresses) {
  const valid = value === manifest.external.poolId ? bytes32Pattern : addressPattern;
  if (!valid.test(value)) throw new Error(`Canonical standard site value is invalid: ${value}`);
}
const missing = requiredAddresses.filter((address) => !siteConfig.includes(address));
if (missing.length > 0) {
  throw new Error(`V2 site config is missing canonical addresses: ${missing.join(", ")}`);
}

if (!siteConfig.includes(`deploymentBlock: ${manifest.deploymentBlock}`)) {
  throw new Error("V2 site config deploymentBlock does not match the canonical manifest");
}

for (const [market, selected] of [["standard", manifest], ["micro", micro]]) {
  for (const key of [...isolatedKeys, "observationOracle", "twapAdapter", "usdOracle"]) {
    if (!browserManifest.includes(selected[key])) {
      throw new Error(`Generated browser manifests omit ${market}.${key}`);
    }
  }
}
for (const key of isolatedKeys) {
  if (siteConfig.toLowerCase().includes(micro[key].toLowerCase())) {
    throw new Error(`Static standard site config must not contain micro.${key}`);
  }
}
if (!browserManifest.includes("export const MANIFESTS") || !browserManifest.includes("standard:") || !browserManifest.includes("micro:")) {
  throw new Error("Generated browser manifest must expose both markets");
}
if (!apiMarkets.includes("./contracts.json")
  || !apiMarkets.includes("./contracts-micro.json")
  || apiMarkets.includes("import.meta")
  || !apiSiteConfig.includes("loadMarketManifest(market)")) {
  throw new Error("Site-config API must select the requested standard or micro packaged manifest");
}

console.log("V2 site config and generated browser manifests match both isolated market graphs.");
