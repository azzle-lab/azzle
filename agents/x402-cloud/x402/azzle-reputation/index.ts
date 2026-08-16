/**
 * x402 Cloud service: azzle-reputation
 * Paid reputation lookup — aggregated on-chain rep, task/dispute history,
 * verifier bond, and recent reputation signals for one AZZLE agent.
 *
 * Self-contained handler (per-service bundle): no cross-directory imports.
 * Price + schema live in ../../bankr.x402.json.
 *
 * @see docs/X402_CLOUD.md
 */

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const REPUTATION = "0xb5827Bb3bb9760Ed72eA1416818188a8e71851B6";
const VERIFIER_BOND_VAULT = "0xFeF0722d2f3ba0FEb59b3fd5dCAaF49e69BD5387";
const REPUTATION_OF = "0xb9f79451"; // reputation(address)
const BONDS = "0xfe10d774"; // bonds(address)

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

function addressArg(address: string): string {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

export default async function handler(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    // 400 → non-2xx, caller not charged.
    return json({ error: "invalid_address", hint: "pass ?address=0x... (40 hex chars)" }, 400);
  }

  const arg = addressArg(address);
  const [reputationRow, verifierBondAzl] = await Promise.all([
    rpc<string>("eth_call", [{ to: REPUTATION, data: `${REPUTATION_OF}${arg}` }, "latest"]),
    rpc<string>("eth_call", [{ to: VERIFIER_BOND_VAULT, data: `${BONDS}${arg}` }, "latest"]),
  ]);
  const words = reputationRow.slice(2).match(/.{64}/g) ?? [];
  const [completed, wins, losses] = words.map((word) => BigInt(`0x${word}`).toString());
  return {
    protocol: "azzle",
    chainId: 8453,
    address: address.toLowerCase(),
    found: true,
    completed, wins, losses,
    verifierBondAzl: BigInt(verifierBondAzl).toString(),
    note: "Canonical V2 counters and AZL verifier bond; event history is not indexed by this endpoint.",
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
