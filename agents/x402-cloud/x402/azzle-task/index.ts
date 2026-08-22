/**
 * x402 Cloud service: azzle-task
 * Paid single-task inspection — full AZZLE task row by on-chain id.
 *
 * Price + schema live in ../../bankr.x402.json.
 *
 * @see docs/X402_CLOUD.md
 */

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
import { selectBaseMainnetManifest } from "../manifest";

const GET_TASK = "0x1d65e77e";
const ZERO = "0x0000000000000000000000000000000000000000";
const STATES = ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"];

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Base RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error || json.result === undefined) throw new Error(json.error?.message ?? "Base RPC empty response");
  return json.result;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function word(data: string, index: number): string {
  return data.slice(2 + index * 64, 2 + (index + 1) * 64);
}

function address(data: string, index: number): string {
  return `0x${word(data, index).slice(24)}`;
}

export default async function handler(req: Request) {
  const params = new URL(req.url).searchParams;
  const market = params.get("market");
  if (market !== "standard" && market !== "micro") {
    return json({ error: "invalid_market", hint: "pass ?market=standard|micro" }, 400);
  }
  const taskRef = params.get("id");
  const match = taskRef?.match(/^v2:(standard|micro):([1-9]\d*)$/);
  if (!match) {
    // 400 → non-2xx, caller not charged.
    return json({ error: "invalid_id", hint: "pass ?id=v2:<market>:<positive task id>" }, 400);
  }
  if (match[1] !== market) {
    return json({ error: "market_mismatch", market, taskMarket: match[1] }, 400);
  }
  const id = match[2];
  const registryAddress = selectBaseMainnetManifest(market).taskRegistry;

  let data: string;
  try {
    data = await rpc<string>("eth_call", [{
      to: registryAddress,
      data: `${GET_TASK}${BigInt(id).toString(16).padStart(64, "0")}`,
    }, "latest"]);
  } catch {
    return json({ protocol: "azzle", chainId: 8453, market, registryAddress, id: taskRef, found: false }, 404);
  }

  const poster = address(data, 0);
  if (poster.toLowerCase() === ZERO) {
    return json({ protocol: "azzle", chainId: 8453, market, registryAddress, id: taskRef, found: false }, 404);
  }
  const worker = address(data, 1);
  const totalAmount = BigInt(`0x${word(data, 2)}`);
  const funded = BigInt(`0x${word(data, 3)}`);
  const released = BigInt(`0x${word(data, 4)}`);
  const state = Number(BigInt(`0x${word(data, 8)}`));
  return {
    protocol: "azzle",
    protocolVersion: "v2",
    chainId: 8453,
    market,
    registryAddress,
    found: true,
    task: {
      protocolVersion: "v2",
      asset: "AZL",
      id: taskRef,
      market,
      registryAddress,
      localTaskId: id,
      state: STATES[state] ?? "UNKNOWN",
      poster,
      worker: worker.toLowerCase() === ZERO ? null : worker,
      totalAmountAzlWei: totalAmount.toString(),
      fundedAzlWei: funded.toString(),
      releasedAzlWei: released.toString(),
      deadline: Number(BigInt(`0x${word(data, 5)}`)),
      fundingDeadline: Number(BigInt(`0x${word(data, 6)}`)),
      deliveredAt: Number(BigInt(`0x${word(data, 7)}`)),
    },
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
