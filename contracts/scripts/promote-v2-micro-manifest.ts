/**
 * Promote a finalized micro-market candidate onto base-8453-micro.json.
 * Never writes the live standard manifest at base-8453.json.
 *
 * Dry-run is the default. Set V2_MICRO_MANIFEST_PROMOTE_APPLY=1 and
 * V2_MICRO_MANIFEST_PROMOTE_YES=1 to write files.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

const ROOT = path.resolve(__dirname, "..", "..");
const DEPLOYMENTS = path.join(ROOT, "contracts", "deployments");
const STANDARD = path.join(DEPLOYMENTS, "base-8453.json");
const MICRO = path.join(DEPLOYMENTS, "base-8453-micro.json");
const DEFAULT_CANDIDATE = path.join(DEPLOYMENTS, "base-8453-micro.candidate.json");
const CANDIDATE = process.env.V2_CANDIDATE_MANIFEST_PATH
  ? path.resolve(process.cwd(), process.env.V2_CANDIDATE_MANIFEST_PATH)
  : DEFAULT_CANDIDATE;

const REQUIRED = [
  "factory", "observationOracle", "twapAdapter", "usdOracle", "pricingPolicy",
  "depositVault", "escrowVault", "reputationRegistry", "verifierBondVault",
  "stakingVault", "treasuryRouter", "taskRegistry", "arbitrationModule",
  "usdcWethLeg", "exactInputExecutor", "paymentGateway", "taskScopeRegistry",
] as const;
const SHARED = ["observationOracle", "twapAdapter", "usdOracle"] as const;
const UNIQUE = REQUIRED.filter((key) => !SHARED.includes(key as typeof SHARED[number]));

function loadJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function atomicWrite(file: string, value: unknown) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, file);
}

function requireMicroManifest(file: string) {
  const manifest = loadJson(file);
  if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") {
    throw new Error(`${file} is not a V2 Base manifest`);
  }
  if (manifest.market !== "micro") throw new Error(`${file} market must be micro`);
  for (const key of REQUIRED) {
    if (!ethers.isAddress(String(manifest[key] ?? ""))) throw new Error(`${file} missing ${key}`);
  }
  return manifest;
}

async function main() {
  if (!fs.existsSync(CANDIDATE)) throw new Error(`Micro candidate not found: ${CANDIDATE}`);
  if (!fs.existsSync(STANDARD)) throw new Error(`Standard manifest not found: ${STANDARD}`);

  const candidate = requireMicroManifest(CANDIDATE);
  const standard = loadJson(STANDARD);
  for (const key of SHARED) {
    if (ethers.getAddress(candidate[key]) !== ethers.getAddress(standard[key])) {
      throw new Error(`micro ${key} must reuse the live standard oracle`);
    }
  }
  for (const key of UNIQUE) {
    if (ethers.getAddress(candidate[key]) === ethers.getAddress(standard[key])) {
      throw new Error(`micro ${key} must not reuse the live standard address`);
    }
    if (candidate[key] === ethers.ZeroAddress) throw new Error(`micro ${key} is still zero`);
  }

  if (process.env.BASE_RPC_URL?.trim()) {
    for (const key of REQUIRED) {
      const code = await ethers.provider.getCode(candidate[key]);
      if (code === "0x") throw new Error(`${key} has no bytecode at ${candidate[key]}`);
    }
  }

  const apply = process.env.V2_MICRO_MANIFEST_PROMOTE_APPLY === "1";
  const acknowledged = process.env.V2_MICRO_MANIFEST_PROMOTE_YES === "1";
  console.log(`[micro-manifest] ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`candidate: ${CANDIDATE}`);
  console.log(`canonical micro: ${MICRO}`);

  if (!apply) {
    console.log("No files written. Review, then rerun with apply and yes.");
    return;
  }
  if (!acknowledged) throw new Error("V2_MICRO_MANIFEST_PROMOTE_APPLY=1 requires V2_MICRO_MANIFEST_PROMOTE_YES=1");

  const next = { ...candidate, market: "micro" };
  delete next.status;
  atomicWrite(MICRO, next);
  atomicWrite(path.join(ROOT, "agents", "deployments", "base-8453-micro.json"), next);
  atomicWrite(path.join(ROOT, "api", "lib", "contracts-micro.json"), next);
  console.log("Micro candidate promoted. Live standard manifest was not modified.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
