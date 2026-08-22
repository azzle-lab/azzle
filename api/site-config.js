import { economicsFor, isMarketLive, loadMarketManifest, normalizeMarket, contractsFromManifest } from "./lib/markets.js";

const DEPLOYED_AZL_HOP = "0xd089c46C01ccDE2875CCD4Fc46F8D1B170dd32D9";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PLANS = [
  { id: "free", label: "Free", dailyLimit: 3, priceUsdc: 0, billing: "none", description: "3 tasks per day" },
  { id: "basic", label: "Basic", dailyLimit: 50, priceUsdc: 20, billing: "monthly", description: "50 tasks per day · $20 USDC/month" },
  { id: "premium", label: "Premium", dailyLimit: 300, priceUsdc: 60, billing: "monthly", description: "300 tasks per day · $60 USDC/month" },
  { id: "enterprise", label: "Enterprise", dailyLimit: null, priceUsdc: 5000, billing: "lifetime", description: "Unlimited · one-time $5,000 USDC" },
];

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function postingStoreBackend() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "redis";
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return "redis";
  return "file";
}

function economicsPayload(id) {
  const e = economicsFor(id);
  return {
    entryDepositUsd: e.entryDepositUsd6 / 1_000_000,
    liveTaskReserveUsd: e.liveTaskReserveUsd6 / 1_000_000,
    accessFeeUsd: e.accessFeeUsd6 / 1_000_000,
    exitCompensationUsd: e.exitCompensationUsd6 / 1_000_000,
    exitProtocolShareUsd: e.exitProtocolShareUsd6 / 1_000_000,
    maxTaskUsd: e.maxTaskUsd6 / 1_000_000,
    postingFloorUsd: e.postingFloorUsd6 / 1_000_000,
    postingFloorUsd6: String(e.postingFloorUsd6),
    accessFee: "oracle-derived AZL via AzlPricingPolicy.accessFeeAzl()",
  };
}

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const host = req.headers?.host || "azzle.org";
  const url = new URL(req.url || "/api/site-config", `https://${host}`);
  let market;
  try {
    market = normalizeMarket(url.searchParams.get("market"));
  } catch (error) {
    sendJson(res, 400, { error: error?.message ?? String(error) });
    return;
  }
  const manifest = loadMarketManifest(market);
  const live = isMarketLive(manifest);
  const billingWallet = process.env.AZZLE_BILLING_WALLET || manifest.governance || "";

  sendJson(res, 200, {
    privyAppId: process.env.PRIVY_APP_ID || "",
    privyClientId: process.env.PRIVY_CLIENT_ID || "",
    privySignerId: process.env.PRIVY_SIGNER_ID || "",
    chainId: Number(manifest.chainId),
    chainName: "Base",
    rpcUrl: process.env.BASE_RPC_URL || "https://base-rpc.publicnode.com",
    market,
    live,
    contracts: {
      ...contractsFromManifest(manifest),
      azlHop: process.env.V2_HOP_ADDRESS?.trim() || DEPLOYED_AZL_HOP,
      pimlicoBundlerUrl: process.env.PIMLICO_BUNDLER_URL || "",
    },
    v2: true,
    taskUnit: "AZL",
    taskStates: ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"],
    economics: economicsPayload(market),
    markets: {
      standard: { live: isMarketLive(loadMarketManifest("standard")), economics: economicsPayload("standard") },
      micro: { live: isMarketLive(loadMarketManifest("micro")), economics: economicsPayload("micro") },
    },
    billingWallet: billingWallet || null,
    postingPlans: PLANS,
    azlPayDiscount: 0.1,
    postingStore: postingStoreBackend(),
  });
}
