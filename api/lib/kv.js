/**
 * Shared KV for Herd / posting. Prefers Vercel Redis TCP URL
 * (REDIS_URL_ or REDIS_URL), then Upstash / Vercel KV REST.
 */
function redisUrl() {
  return process.env.REDIS_URL_
    || process.env.REDIS_URL
    || process.env.STORAGE_URL
    || "";
}

function useRestRedis() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
    || (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
  );
}

export function useKv() {
  return Boolean(redisUrl() || useRestRedis());
}

export function kvBackend() {
  if (redisUrl()) return "redis";
  if (useRestRedis()) return "redis";
  return "none";
}

/** @type {import("redis").RedisClientType | null} */
let tcpClient = null;
/** @type {import("@upstash/redis").Redis | null} */
let restClient = null;

async function getTcp() {
  if (tcpClient?.isOpen) return tcpClient;
  const { createClient } = await import("redis");
  const url = redisUrl();
  if (!url) throw new Error("redis_url_missing");
  tcpClient = createClient({ url });
  tcpClient.on("error", () => { /* serverless blips */ });
  await tcpClient.connect();
  return tcpClient;
}

async function getRest() {
  if (restClient) return restClient;
  const { Redis } = await import("@upstash/redis");
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  restClient = new Redis({ url, token });
  return restClient;
}

export async function kvGet(key) {
  if (redisUrl()) {
    const raw = await (await getTcp()).get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (useRestRedis()) {
    return (await getRest()).get(key);
  }
  return null;
}

export async function kvSet(key, value) {
  if (redisUrl()) {
    const payload = typeof value === "string" ? value : JSON.stringify(value);
    await (await getTcp()).set(key, payload);
    return;
  }
  if (useRestRedis()) {
    await (await getRest()).set(key, value);
  }
}

/** SET key only if absent. Returns true when this caller won the write. */
export async function kvSetNx(key, value, exSeconds = 0) {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  if (redisUrl()) {
    const client = await getTcp();
    const opts = exSeconds > 0 ? { NX: true, EX: exSeconds } : { NX: true };
    const result = await client.set(key, payload, opts);
    return result === "OK";
  }
  if (useRestRedis()) {
    const client = await getRest();
    const result = exSeconds > 0
      ? await client.set(key, value, { nx: true, ex: exSeconds })
      : await client.set(key, value, { nx: true });
    return result === "OK";
  }
  return false;
}

export async function kvDel(key) {
  if (redisUrl()) {
    await (await getTcp()).del(key);
    return;
  }
  if (useRestRedis()) {
    await (await getRest()).del(key);
  }
}
