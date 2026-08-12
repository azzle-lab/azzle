/**
 * Promote a finalized V2 deployment receipt across project consumers.
 *
 * Dry-run is the default. Set V2_MANIFEST_PROMOTE_APPLY=1 and
 * V2_MANIFEST_PROMOTE_YES=1 to write files.
 *
 * This script intentionally excludes deployment archives and generated build
 * output. Historical manifests must remain historical; live consumers must not
 * retain the old V2 component addresses.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

type V2Manifest = {
  version: "2.0.0";
  chainId: "8453";
  [key: string]: unknown;
};

const ROOT = path.resolve(__dirname, "..", "..");
const DEPLOYMENTS = path.join(ROOT, "contracts", "deployments");
const CANONICAL = path.join(DEPLOYMENTS, "base-8453.json");
const DEFAULT_CANDIDATE = path.join(DEPLOYMENTS, "base-8453-v2-intake-fix.candidate.json");
const CANDIDATE = process.env.V2_CANDIDATE_MANIFEST_PATH
  ? path.resolve(process.cwd(), process.env.V2_CANDIDATE_MANIFEST_PATH)
  : DEFAULT_CANDIDATE;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git", "node_modules", "out", "out-fork", "cache", "coverage",
  "crytic-export", "fizz_data", "archive",
]);
const TEXT_EXTENSIONS = new Set([
  ".json", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".md", ".html", ".txt",
  ".yaml", ".yml", ".sh", ".css",
]);

function loadJson(file: string): V2Manifest {
  return JSON.parse(fs.readFileSync(file, "utf8")) as V2Manifest;
}

function requireV2Manifest(file: string): V2Manifest {
  const manifest = loadJson(file);
  if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") {
    throw new Error(`${file} is not a V2 Base manifest`);
  }
  for (const key of [
    "factory", "observationOracle", "twapAdapter", "usdOracle", "pricingPolicy",
    "depositVault", "escrowVault", "reputationRegistry", "verifierBondVault",
    "stakingVault", "treasuryRouter", "taskRegistry", "arbitrationModule",
    "usdcWethLeg", "exactInputExecutor", "paymentGateway", "taskScopeRegistry",
  ]) {
    if (!ethers.isAddress(String(manifest[key] ?? ""))) {
      throw new Error(`${file} is missing V2 address ${key}`);
    }
  }
  return manifest;
}

function v2Addresses(manifest: V2Manifest): Record<string, string> {
  const keys = [
    "factory", "observationOracle", "twapAdapter", "usdOracle", "pricingPolicy",
    "depositVault", "escrowVault", "reputationRegistry", "verifierBondVault",
    "stakingVault", "treasuryRouter", "taskRegistry", "arbitrationModule",
    "usdcWethLeg", "exactInputExecutor", "paymentGateway", "taskScopeRegistry",
  ];
  return Object.fromEntries(
    keys.map((key) => [key, String(manifest[key])]),
  );
}

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) walk(path.join(directory, entry.name), files);
      continue;
    }
    if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function consumerManifest(candidate: V2Manifest, current: Record<string, unknown>): Record<string, unknown> {
  const external = candidate.external as Record<string, string>;
  return {
    ...current,
    version: candidate.version,
    chainId: candidate.chainId,
    network: "base",
    usdc: external.usdc,
    azlToken: external.azl,
    deployer: candidate.deployer as string,
    EscrowVault: candidate.escrowVault as string,
    TaskRegistry: candidate.taskRegistry as string,
    ReputationRegistry: candidate.reputationRegistry as string,
    ArbitrationModule: candidate.arbitrationModule as string,
    TreasuryRouter: candidate.treasuryRouter as string,
    AgentDepositVault: candidate.depositVault as string,
    UnionStakingVault: candidate.stakingVault as string,
    TaskScopeRegistry: candidate.taskScopeRegistry as string,
  };
}

function replaceAddresses(content: string, replacements: Record<string, string>): string {
  let next = content;
  for (const [oldAddress, newAddress] of Object.entries(replacements)) {
    next = next.replace(new RegExp(oldAddress, "gi"), newAddress);
  }
  return next;
}

function atomicWrite(file: string, content: string): void {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { flag: "wx" });
  fs.renameSync(temporary, file);
}

async function assertDeployed(manifest: V2Manifest): Promise<void> {
  const entries = Object.entries(v2Addresses(manifest));
  for (const [name, address] of entries) {
    const code = await ethers.provider.getCode(address);
    if (code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(CANDIDATE)) throw new Error(`V2 candidate not found: ${CANDIDATE}`);
  if (!fs.existsSync(CANONICAL)) throw new Error(`Canonical manifest not found: ${CANONICAL}`);

  const candidate = requireV2Manifest(CANDIDATE);
  const canonical = requireV2Manifest(CANONICAL);
  if (candidate.chainId !== canonical.chainId) throw new Error("Candidate chain differs from canonical chain");
  await assertDeployed(candidate);

  const oldAddresses = v2Addresses(canonical);
  const newAddresses = v2Addresses(candidate);
  const replacements: Record<string, string> = {};
  for (const key of Object.keys(oldAddresses)) {
    if (oldAddresses[key].toLowerCase() !== newAddresses[key].toLowerCase()) {
      replacements[oldAddresses[key]] = newAddresses[key];
    }
  }

  const files = walk(ROOT);
  const changes = files
    .map((file) => {
      const current = fs.readFileSync(file, "utf8");
      const updated = replaceAddresses(current, replacements);
      return { file, current, updated };
    })
    .filter(({ current, updated }) => current !== updated);

  const apply = process.env.V2_MANIFEST_PROMOTE_APPLY === "1";
  const acknowledged = process.env.V2_MANIFEST_PROMOTE_YES === "1";
  console.log(`[v2-manifest] ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`candidate: ${CANDIDATE}`);
  console.log(`canonical: ${CANONICAL}`);
  console.log(`address replacements: ${Object.keys(replacements).length}`);
  console.log(`files containing old addresses: ${changes.length}`);
  for (const { file } of changes) console.log(`  ${path.relative(ROOT, file)}`);

  if (!apply) {
    console.log("\nNo files written. Review the list, then rerun with apply and yes.");
    return;
  }
  if (!acknowledged) throw new Error("V2_MANIFEST_PROMOTE_APPLY=1 requires V2_MANIFEST_PROMOTE_YES=1");

  const archiveDir = path.join(DEPLOYMENTS, "archive");
  fs.mkdirSync(archiveDir, { recursive: true });
  const archive = path.join(archiveDir, `base-8453.${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.copyFileSync(CANONICAL, archive, fs.constants.COPYFILE_EXCL);
  atomicWrite(CANONICAL, JSON.stringify(candidate, null, 2) + "\n");
  const agentsConsumerPath = path.join(ROOT, "agents", "deployments", "base-8453.json");
  const apiConsumerPath = path.join(ROOT, "api", "lib", "contracts.json");
  const agentsConsumer = loadJson(agentsConsumerPath) as Record<string, unknown>;
  const apiConsumer = loadJson(apiConsumerPath) as Record<string, unknown>;
  const consumer = consumerManifest(candidate, agentsConsumer);
  const apiConsumerNext = consumerManifest(candidate, apiConsumer);
  atomicWrite(agentsConsumerPath, JSON.stringify(consumer, null, 2) + "\n");
  atomicWrite(apiConsumerPath, JSON.stringify(apiConsumerNext, null, 2) + "\n");

  for (const { file, updated } of changes) {
    if (path.resolve(file) === path.resolve(CANONICAL)) continue;
    atomicWrite(file, updated);
  }

  const remaining = walk(ROOT).filter((file) => {
    const content = fs.readFileSync(file, "utf8");
    return Object.keys(replacements).some((oldAddress) => new RegExp(oldAddress, "i").test(content));
  });
  if (remaining.length > 0) {
    throw new Error(`Old V2 addresses remain in live surfaces:\n${remaining.join("\n")}`);
  }
  console.log(`Archived prior canonical manifest: ${archive}`);
  console.log("V2 candidate promoted and all non-archived live surfaces synchronized.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
