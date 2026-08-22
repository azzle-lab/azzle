/**
 * x402 Cloud service: azzle-leaderboard
 * Paid leaderboard — market-specific canonical reputation counters or AZL
 * verifier bonds for subjects discovered in a bounded event window.
 *
 * Self-contained handler (per-service bundle): only the generated manifest is imported.
 * Price + schema live in ../../bankr.x402.json.
 *
 * @see docs/X402_CLOUD.md
 */
import { selectBaseMainnetManifest } from "../manifest";

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const EVENT_SCAN_WINDOW = 50_000n;
const LOG_CHUNK_SIZE = 9_000n;
const MAX_CANDIDATES = 250;
const ZERO = "0x0000000000000000000000000000000000000000";
const REPUTATION_OF = "0xb9f79451";
const BONDS = "0xfe10d774";
const TOPICS = {
  completion: "0xc4a3b89ce948af8aeadaeedb0045888a7d240292c45ebda88c0b753951036d03",
  dispute: "0xaf5ae1bca4608375b51171e75330b6ca2585c77ef9f2e76e5152cbf9be0983d6",
  posterExpiry: "0x2a890b93401bb57abd6b8e3d0d45f508726e5eab0e2f7334144d07a3f366342e",
  unresolved: "0x1308dbcf993f5a57940396dde8ec9aa80a78ac5700d9267de955c07e4ee5a36a",
  bonded: "0xd0a009034e24a39106653c4903cf28b1947b8a9964d03206648e0f0a5de74a46",
  withdrawn: "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5",
  slashed: "0x96e0041f14ae401fab2384e3c29da20cb0263ef760c47847db1f13403cea654c",
} as const;

type RpcLog = { data: string; topics: string[] };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Base RPC HTTP ${response.status}`);
  const body = await response.json() as { result?: T; error?: { message: string } };
  if (body.error || body.result === undefined) {
    throw new Error(body.error?.message ?? "Base RPC empty response");
  }
  return body.result;
}

function blockTag(block: bigint): string {
  return `0x${block.toString(16)}`;
}

function topicAddress(topic?: string): string | null {
  if (!topic || topic.length !== 66) return null;
  const address = `0x${topic.slice(-40)}`.toLowerCase();
  return address === ZERO ? null : address;
}

function dataAddress(data: string, wordIndex: number): string | null {
  const start = 2 + wordIndex * 64;
  return topicAddress(`0x${data.slice(start, start + 64)}`);
}

function addressArg(address: string): string {
  return address.slice(2).padStart(64, "0");
}

function compareBigInt(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

async function mapInBatches<T, U>(
  values: T[],
  batchSize: number,
  map: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(...await Promise.all(values.slice(index, index + batchSize).map(map)));
  }
  return results;
}

async function getLogs(
  address: string,
  eventTopics: string[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RpcLog[]> {
  const logs: RpcLog[] = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_CHUNK_SIZE) {
    const to = from + LOG_CHUNK_SIZE - 1n > toBlock ? toBlock : from + LOG_CHUNK_SIZE - 1n;
    logs.push(...await rpc<RpcLog[]>("eth_getLogs", [{
      address,
      fromBlock: blockTag(from),
      toBlock: blockTag(to),
      topics: [eventTopics],
    }]));
  }
  return logs;
}

function discoverReputationSubjects(logs: RpcLog[]): string[] {
  const subjects = new Set<string>();
  for (const log of logs) {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === TOPICS.completion || topic === TOPICS.posterExpiry) {
      for (const value of [topicAddress(log.topics[2]), topicAddress(log.topics[3])]) {
        if (value) subjects.add(value);
      }
    } else if (topic === TOPICS.unresolved) {
      const poster = topicAddress(log.topics[2]);
      if (poster) subjects.add(poster);
    } else if (topic === TOPICS.dispute) {
      for (const value of [dataAddress(log.data, 0), dataAddress(log.data, 1)]) {
        if (value) subjects.add(value);
      }
    }
  }
  return [...subjects];
}

function discoverVerifierSubjects(logs: RpcLog[]): string[] {
  const subjects = new Set<string>();
  for (const log of logs) {
    const verifier = topicAddress(log.topics[1]);
    if (verifier) subjects.add(verifier);
  }
  return [...subjects];
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const params = new URL(req.url).searchParams;
  const market = params.get("market");
  if (market !== "standard" && market !== "micro") {
    return json({ error: "invalid_market", hint: "pass ?market=standard|micro" }, 400);
  }
  const kind = (params.get("kind") ?? "reputation").toLowerCase();
  const raw = Number(params.get("limit") ?? "25");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25;

  if (kind !== "reputation" && kind !== "verifiers") {
    return json({ error: "invalid_kind", hint: "kind=reputation|verifiers" }, 400);
  }

  const manifest = selectBaseMainnetManifest(market);
  const latestBlock = BigInt(await rpc<string>("eth_blockNumber", []));
  const deploymentBlock = BigInt(manifest.deploymentBlock);
  const windowStart = latestBlock >= EVENT_SCAN_WINDOW - 1n
    ? latestBlock - EVENT_SCAN_WINDOW + 1n
    : 0n;
  const fromBlock = deploymentBlock > windowStart ? deploymentBlock : windowStart;
  const eventTopics = kind === "reputation"
    ? [TOPICS.completion, TOPICS.dispute, TOPICS.posterExpiry, TOPICS.unresolved]
    : [TOPICS.bonded, TOPICS.withdrawn, TOPICS.slashed];
  const sourceAddress = kind === "reputation"
    ? manifest.reputationRegistry
    : manifest.verifierBondVault;
  const logs = await getLogs(sourceAddress, eventTopics, fromBlock, latestBlock);
  const discovered = kind === "reputation"
    ? discoverReputationSubjects(logs)
    : discoverVerifierSubjects(logs);
  const candidateLimited = discovered.length > MAX_CANDIDATES;
  const candidates = discovered.slice(-MAX_CANDIDATES);
  const snapshot = blockTag(latestBlock);

  const rows = kind === "reputation"
    ? await mapInBatches(candidates, 10, async (address) => {
        const result = await rpc<string>("eth_call", [{
          to: manifest.reputationRegistry,
          data: `${REPUTATION_OF}${addressArg(address)}`,
        }, snapshot]);
        const words = result.slice(2).match(/.{64}/g) ?? [];
        return {
          address,
          completed: BigInt(`0x${words[0] ?? "0"}`).toString(),
          wins: BigInt(`0x${words[1] ?? "0"}`).toString(),
          losses: BigInt(`0x${words[2] ?? "0"}`).toString(),
        };
      }).then((values) => values.sort((a, b) =>
        compareBigInt(b.completed, a.completed)
        || compareBigInt(b.wins, a.wins)
        || compareBigInt(a.losses, b.losses)
        || a.address.localeCompare(b.address)
      ))
    : await mapInBatches(candidates, 10, async (address) => ({
        address,
        bondAzlWei: BigInt(await rpc<string>("eth_call", [{
          to: manifest.verifierBondVault,
          data: `${BONDS}${addressArg(address)}`,
        }, snapshot])).toString(),
      })).then((values) => values
        .filter((row) => BigInt(row.bondAzlWei) > 0n)
        .sort((a, b) =>
          compareBigInt(b.bondAzlWei, a.bondAzlWei)
          || a.address.localeCompare(b.address)
        ));

  return {
    protocol: "azzle",
    chainId: 8453,
    market,
    kind,
    count: Math.min(rows.length, limit),
    agents: rows.slice(0, limit),
    source: "base-rpc-events-and-views",
    sourceAddress,
    snapshotBlock: latestBlock.toString(),
    indexWindow: {
      fromBlock: fromBlock.toString(),
      toBlock: latestBlock.toString(),
      deploymentBlock: deploymentBlock.toString(),
      eventCount: logs.length,
      discoveredCandidates: discovered.length,
      indexedCandidates: candidates.length,
      candidateLimit: MAX_CANDIDATES,
      windowTruncated: fromBlock > deploymentBlock,
      candidateTruncated: candidateLimited,
      complete: fromBlock === deploymentBlock && !candidateLimited,
    },
    ranking: kind === "reputation"
      ? "completed desc, wins desc, losses asc"
      : "bondAzlWei desc",
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
