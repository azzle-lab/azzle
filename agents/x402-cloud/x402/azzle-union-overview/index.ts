/**
 * x402 Cloud service: azzle-union-overview
 * Paid, agent-readable Union Staking and Action Credits launch state.
 */
import { selectBaseMainnetManifest } from "../manifest";

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const SELECTORS = {
  stakingActive: "0xa6ac4b35",
  totalStaked: "0x817b1cd2",
  totalCreditsIssued: "0x2008d7a0",
  totalCreditsSpent: "0xe67e0d45",
  creditsRemaining: "0x9379bde3",
  creditIssuanceClosed: "0x0d22a470",
};

async function call(vault: string, data: string): Promise<string> {
  const response = await fetch(RPC_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: vault, data }, "latest"] }),
  });
  if (!response.ok) throw new Error(`Base RPC HTTP ${response.status}`);
  const json = await response.json() as { result?: string; error?: { message: string } };
  if (!json.result) throw new Error(json.error?.message || "Base RPC empty response");
  return json.result;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const market = new URL(req.url).searchParams.get("market");
  if (market !== "standard" && market !== "micro") {
    return json({ error: "invalid_market", hint: "pass ?market=standard|micro" }, 400);
  }
  const vault = selectBaseMainnetManifest(market).stakingVault;
  const [active, staked, issued, spent, remaining, closed] = await Promise.all(
    Object.values(SELECTORS).map((selector) => call(vault, selector))
  );
  return {
    protocol: "azzle", chainId: 8453, market, vault, generatedAt: Math.floor(Date.now() / 1000),
    stakingActive: BigInt(active) !== 0n,
    totalStakedAzl: BigInt(staked).toString(),
    totalCreditsIssued: BigInt(issued).toString(),
    totalCreditsSpent: BigInt(spent).toString(),
    creditsRemaining: BigInt(remaining).toString(),
    creditIssuanceClosed: BigInt(closed) !== 0n,
  };
}
