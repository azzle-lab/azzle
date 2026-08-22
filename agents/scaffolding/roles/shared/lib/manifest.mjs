import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Load base-8453.json relative to a module URL (Node 18+ compatible). */
export function loadManifest(moduleUrl, ...pathSegments) {
  const base = dirname(fileURLToPath(moduleUrl));
  const file = join(base, ...pathSegments);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const market = String(process.env.AZZLE_MARKET ?? "").trim().toLowerCase();
  if (market !== "standard" && market !== "micro") {
    throw new Error("Set AZZLE_MARKET=standard or micro");
  }
  if (manifest.market !== market) {
    throw new Error(`Manifest market '${manifest.market ?? "missing"}' does not match AZZLE_MARKET '${market}'`);
  }
  return manifest;
}

export function requireTaskRef(value, expectedMarket = process.env.AZZLE_MARKET) {
  const input = String(value ?? "");
  const raw = input.trim();
  const match = raw === input && raw.match(/^v2:(standard|micro):([1-9]\d*)$/);
  if (!match) throw new Error("Task id must be v2:standard:N or v2:micro:N");
  const market = match[1].toLowerCase();
  if (market !== expectedMarket) {
    throw new Error(`Task ${raw} belongs to '${market}', not selected market '${expectedMarket}'`);
  }
  return `v2:${market}:${match[2]}`;
}
