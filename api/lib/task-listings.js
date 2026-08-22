/**
 * Off-chain task briefs keyed by taskId (shown on /market).
 * Same persistence backend as posting tiers — file locally, Redis on Vercel.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseTaskRef, requireLiveMarket } from "./markets.js";

const ROOT = process.cwd();
const DATA_DIR = process.env.VERCEL
  ? join("/tmp", "azzle-posting")
  : resolve(ROOT, "azzle-force", "data");
const LISTINGS_PATH = join(DATA_DIR, "task-listings.json");
const KV_LISTINGS_KEY = "posting:task-listings";
const MAX_DESCRIPTION = 10_000;

function useRedis() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
}

/** @type {import("@upstash/redis").Redis | null} */
let redisClient = null;

async function getRedis() {
  if (redisClient) return redisClient;
  const { Redis } = await import("@upstash/redis");
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  redisClient = new Redis({ url, token });
  return redisClient;
}

async function loadAll() {
  if (useRedis()) {
    const store = await (await getRedis()).get(KV_LISTINGS_KEY);
    return store ?? { listings: {} };
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(LISTINGS_PATH)) return { listings: {} };
  try {
    return JSON.parse(await readFile(LISTINGS_PATH, "utf8"));
  } catch {
    return { listings: {} };
  }
}

async function saveAll(store) {
  if (useRedis()) {
    await (await getRedis()).set(KV_LISTINGS_KEY, store);
    return;
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LISTINGS_PATH, JSON.stringify(store, null, 2), "utf8");
}

/**
 * @param {object} input
 * @param {string|number} input.taskId
 * @param {string} input.description
 * @param {number} [input.budgetUsdc]
 * @param {number} [input.deadlineDays]
 * @param {string} [input.poster]
 * @param {string} [input.txHash]
 */
export async function saveTaskListing(input) {
  const ref = parseTaskRef(input.taskId);
  const { manifest } = requireLiveMarket(ref.market);
  const taskId = ref.id;
  const description = String(input.description ?? "").trim().slice(0, MAX_DESCRIPTION);
  if (!description) return null;

  const listing = {
    id: taskId,
    taskId,
    market: ref.market,
    registryAddress: manifest.taskRegistry,
    description,
    budgetUsdc:
      input.budgetUsdc != null && Number.isFinite(Number(input.budgetUsdc))
        ? Number(input.budgetUsdc)
        : null,
    deadlineDays:
      input.deadlineDays != null && Number.isFinite(Number(input.deadlineDays))
        ? Number(input.deadlineDays)
        : null,
    poster: input.poster ? String(input.poster).trim().toLowerCase() : null,
    txHash: input.txHash ? String(input.txHash).trim() : null,
    discoveryOpen: input.discoveryOpen !== false,
    savedAt: new Date().toISOString(),
  };

  const store = await loadAll();
  store.listings = store.listings ?? {};
  store.listings[taskId] = listing;
  await saveAll(store);
  return listing;
}

export async function getTaskListing(taskIdRaw) {
  const ref = parseTaskRef(taskIdRaw);
  const { manifest } = requireLiveMarket(ref.market);
  const store = await loadAll();
  const listing = store.listings?.[ref.id] ?? null;
  if (!listing) return null;
  if (listing.market !== ref.market || listing.registryAddress !== manifest.taskRegistry) return null;
  return listing;
}
