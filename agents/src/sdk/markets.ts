import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseMainnetV2Manifest } from "./manifest-v2.js";

export type AzzleMarket = "standard" | "micro";
export type TaskRef = `v2:${AzzleMarket}:${string}`;

export interface MarketEconomics {
  id: AzzleMarket;
  entryDepositUsd6: number;
  liveTaskReserveUsd6: number;
  accessFeeUsd6: number;
  exitCompensationUsd6: number;
  exitProtocolShareUsd6: number;
  maxTaskUsd6: number;
  openTaskCapUsd6: number;
  postingFloorUsd6: number;
  manifestFile: string;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export const MARKET_ECONOMICS: Record<AzzleMarket, MarketEconomics> = {
  standard: {
    id: "standard",
    entryDepositUsd6: 25_000_000,
    liveTaskReserveUsd6: 8_000_000,
    accessFeeUsd6: 5_000_000,
    exitCompensationUsd6: 2_500_000,
    exitProtocolShareUsd6: 2_500_000,
    maxTaskUsd6: 10_000_000_000,
    openTaskCapUsd6: 10_000_000_000,
    postingFloorUsd6: 45_000_000,
    manifestFile: "base-8453.json",
  },
  micro: {
    id: "micro",
    entryDepositUsd6: 3_000_000,
    liveTaskReserveUsd6: 1_000_000,
    accessFeeUsd6: 500_000,
    exitCompensationUsd6: 250_000,
    exitProtocolShareUsd6: 250_000,
    maxTaskUsd6: 50_000_000,
    openTaskCapUsd6: 2_500_000_000,
    postingFloorUsd6: 5_000_000,
    manifestFile: "base-8453-micro.json",
  },
};

export function normalizeMarket(value?: string | null): AzzleMarket {
  const market = String(value ?? "").trim().toLowerCase();
  if (market === "micro") return "micro";
  if (!market || market === "standard") return "standard";
  throw new Error(`Unknown market '${value}'. Use standard or micro.`);
}

/** Resolve one selected graph and reject a manifest that declares another graph. */
export function resolveExpectedMarket(
  selected?: string | null,
  manifest?: { market?: string | null }
): AzzleMarket {
  const market = normalizeMarket(selected ?? process.env.AZZLE_MARKET ?? "standard");
  if (manifest?.market == null || String(manifest.market).trim() === "") return market;
  const declared = normalizeMarket(manifest.market);
  if (declared !== market) {
    throw new Error(`Manifest market '${declared}' does not match selected market '${market}'.`);
  }
  return market;
}

export function isDeployedAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && value.toLowerCase() !== ZERO;
}

export function isMarketLive(manifest: { taskRegistry?: string; status?: string } | null | undefined): boolean {
  return Boolean(manifest && isDeployedAddress(manifest.taskRegistry) && manifest.status !== "pending");
}

export function namespacedTaskId(market: string, localId: string | number | bigint): TaskRef {
  const value = String(localId);
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Local task id must be a positive canonical integer.");
  return `v2:${normalizeMarket(market)}:${value}`;
}

export function parseTaskRef(raw: unknown, expectedMarket?: string | null) {
  if (typeof raw !== "string") {
    throw new Error("Task id must be v2:standard:N or v2:micro:N.");
  }
  const value = raw.trim();
  if (value !== raw) throw new Error("Task id must not contain surrounding whitespace.");
  const namespaced = value.match(/^v2:(standard|micro):([1-9]\d*)$/);
  if (namespaced) {
    const market = namespaced[1].toLowerCase() as AzzleMarket;
    const expected = expectedMarket == null ? undefined : normalizeMarket(expectedMarket);
    if (expected && market !== expected) {
      throw new Error(`Task ${value} belongs to '${market}', not selected market '${expected}'.`);
    }
    return { market, localId: namespaced[2], localIdBigInt: BigInt(namespaced[2]), id: namespacedTaskId(market, namespaced[2]) };
  }
  if (/^v2:\d+$/.test(value)) {
    throw new Error("Unscoped task id v2:N is illegal. Use v2:standard:N or v2:micro:N.");
  }
  if (/^\d+$/.test(value)) {
    throw new Error("Bare task id N is illegal. Use v2:standard:N or v2:micro:N.");
  }
  throw new Error("Invalid task id. Use v2:standard:N or v2:micro:N.");
}

export function loadMarketManifest(market: string = "standard"): BaseMainnetV2Manifest & { market?: string; status?: string } {
  const id = normalizeMarket(market);
  const file = join(ROOT, "contracts", "deployments", MARKET_ECONOMICS[id].manifestFile);
  const packaged = join(dirname(fileURLToPath(import.meta.url)), `../../deployments/${MARKET_ECONOMICS[id].manifestFile}`);
  const path = existsSync(file) ? file : packaged;
  const manifest = JSON.parse(readFileSync(path, "utf8")) as BaseMainnetV2Manifest & { market?: string; status?: string };
  if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") {
    throw new Error(`${id} manifest is not AZZLE V2 on Base`);
  }
  resolveExpectedMarket(id, manifest);
  return manifest;
}

export function requireLiveMarket(market: string = "standard") {
  const id = normalizeMarket(market);
  const manifest = loadMarketManifest(id);
  if (!isMarketLive(manifest)) throw new Error(`${id} market is not deployed yet`);
  return { market: id, manifest, economics: MARKET_ECONOMICS[id] };
}
