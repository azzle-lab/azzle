import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ZERO = "0x0000000000000000000000000000000000000000";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const MARKETS = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    entryDepositUsd6: 25_000_000,
    liveTaskReserveUsd6: 8_000_000,
    accessFeeUsd6: 5_000_000,
    exitCompensationUsd6: 2_500_000,
    exitProtocolShareUsd6: 2_500_000,
    maxTaskUsd6: 10_000_000_000,
    openTaskCapUsd6: 10_000_000_000,
    postingFloorUsd6: 45_000_000,
    maxUsdcInput6: 500_000_000,
    manifestFile: "base-8453.json",
  }),
  micro: Object.freeze({
    id: "micro",
    entryDepositUsd6: 3_000_000,
    liveTaskReserveUsd6: 1_000_000,
    accessFeeUsd6: 500_000,
    exitCompensationUsd6: 250_000,
    exitProtocolShareUsd6: 250_000,
    maxTaskUsd6: 50_000_000,
    openTaskCapUsd6: 2_500_000_000,
    postingFloorUsd6: 5_000_000,
    maxUsdcInput6: 100_000_000,
    manifestFile: "base-8453-micro.json",
  }),
});

const cache = new Map();

export function normalizeMarket(value) {
  const market = String(value ?? "").trim().toLowerCase();
  if (market === "micro" || market === "standard") return market;
  if (!market) return "standard";
  throw new Error(`Unknown market '${value}'. Use standard or micro.`);
}

export function economicsFor(market) {
  return MARKETS[normalizeMarket(market)];
}

export function postingFloorUsd6(market) {
  return BigInt(economicsFor(market).postingFloorUsd6);
}

export function isDeployedAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && value.toLowerCase() !== ZERO;
}

export function isMarketLive(manifest) {
  return Boolean(manifest) && isDeployedAddress(manifest.taskRegistry) && manifest.status !== "pending";
}

export function loadMarketManifest(market = "standard") {
  const id = normalizeMarket(market);
  if (cache.has(id)) return cache.get(id);
  const file = join(ROOT, "contracts", "deployments", MARKETS[id].manifestFile);
  if (!existsSync(file)) {
    throw new Error(`Missing ${id} manifest at ${file}`);
  }
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") {
    throw new Error(`${id} manifest is not AZZLE V2 on Base`);
  }
  if (manifest.market && manifest.market !== id) {
    throw new Error(`${id} manifest market field is ${manifest.market}`);
  }
  cache.set(id, manifest);
  return manifest;
}

export function namespacedTaskId(market, localId) {
  const id = String(localId ?? "").trim();
  if (!/^[1-9]\d*$/.test(id)) throw new Error("Invalid local task id");
  return `v2:${normalizeMarket(market)}:${id}`;
}

export function parseTaskRef(raw) {
  const value = String(raw ?? "").trim();
  const namespaced = value.match(/^v2:(standard|micro):([1-9]\d*)$/i);
  if (namespaced) {
    return { market: namespaced[1].toLowerCase(), localId: namespaced[2], id: namespacedTaskId(namespaced[1], namespaced[2]) };
  }
  if (/^v2:\d+$/i.test(value)) {
    throw new Error("Unscoped task id v2:N is illegal. Use v2:standard:N or v2:micro:N.");
  }
  if (/^\d+$/.test(value)) {
    throw new Error("Bare numeric task ids are illegal. Use v2:standard:N or v2:micro:N.");
  }
  throw new Error("Invalid task id");
}

export function contractsFromManifest(manifest) {
  if (!manifest) return null;
  return {
    usdc: manifest.external?.usdc,
    azlToken: manifest.external?.azl,
    taskRegistry: manifest.taskRegistry,
    depositVault: manifest.depositVault,
    treasuryRouter: manifest.treasuryRouter,
    escrowVault: manifest.escrowVault,
    stakingVault: manifest.stakingVault,
    arbitrationModule: manifest.arbitrationModule,
    reputationRegistry: manifest.reputationRegistry,
    verifierBondVault: manifest.verifierBondVault,
    usdOracle: manifest.usdOracle,
    pricingPolicy: manifest.pricingPolicy,
    paymentGateway: manifest.paymentGateway,
    taskScopeRegistry: manifest.taskScopeRegistry || null,
    observationOracle: manifest.observationOracle,
    twapAdapter: manifest.twapAdapter,
    usdcWethLeg: manifest.usdcWethLeg,
    exactInputExecutor: manifest.exactInputExecutor,
    factory: manifest.factory,
    governance: manifest.governance,
    external: manifest.external,
    risk: manifest.risk,
    actionCredits: manifest.actionCredits,
  };
}

export function requireLiveMarket(market = "standard") {
  const id = normalizeMarket(market);
  const manifest = loadMarketManifest(id);
  if (!isMarketLive(manifest)) {
    throw new Error(`${id} market is not deployed yet`);
  }
  return { market: id, manifest, economics: economicsFor(id) };
}
