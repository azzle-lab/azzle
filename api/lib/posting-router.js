import { PLANS, AZL_PAY_DISCOUNT } from "./plans.js";
import { loadMarketManifest, normalizeMarket } from "./markets.js";

function billingWallet(market) {
  const manifest = loadMarketManifest(market);
  return process.env.AZZLE_BILLING_WALLET || manifest?.feeRecipient || "";
}

export async function handlePostingApi({ method, pathname, searchParams, body = {} }) {
  const market = normalizeMarket(body.market ?? searchParams?.get?.("market"));
  const MANIFEST = loadMarketManifest(market);
  const BILLING_WALLET = billingWallet(market);
  const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

  if (method === "GET" && pathname === "/api/posting/plans") {
    return {
      status: 200,
      json: {
        plans: Object.values(PLANS),
        billingWallet: BILLING_WALLET || null,
        azlPayDiscount: AZL_PAY_DISCOUNT,
      },
    };
  }

  if (method === "GET" && pathname === "/api/posting/azl-price") {
    try {
      const { fetchAzlUsdPrice } = await import("./azl-price.js");
      const price = await fetchAzlUsdPrice();
      return { status: 200, json: { ...price, discountPercent: AZL_PAY_DISCOUNT * 100 } };
    } catch (e) {
      return { status: 502, json: { error: e.message ?? String(e) } };
    }
  }

  if (method === "GET" && pathname === "/api/posting/quote") {
    const tier = searchParams.get("tier");
    const address = searchParams.get("address");
    const payWith = searchParams.get("payWith") ?? "azl";
    try {
      if (payWith !== "azl") throw new Error("Only payWith=azl is supported for quotes.");
      const { createUpgradeQuote } = await import("./posting-limits.js");
      const quote = await createUpgradeQuote({ address, tier, market });
      return { status: 200, json: quote };
    } catch (e) {
      return { status: 400, json: { error: e.message ?? String(e) } };
    }
  }

  if (method === "GET" && pathname === "/api/posting/azl-preview") {
    const tier = searchParams.get("tier");
    try {
      const { previewAzlUpgrade } = await import("./posting-limits.js");
      const preview = await previewAzlUpgrade(tier);
      return { status: 200, json: preview };
    } catch (e) {
      return { status: 400, json: { error: e.message ?? String(e) } };
    }
  }

  if (method === "GET" && pathname === "/api/posting/quota") {
    const address = searchParams.get("address");
    try {
      const { getQuota } = await import("./posting-limits.js");
      const quota = await getQuota(address, searchParams.get("market"));
      return { status: 200, json: quota };
    } catch (e) {
      return { status: 400, json: { error: e.message ?? String(e) } };
    }
  }

  if (method === "POST" && pathname === "/api/posting/record") {
    try {
      const { recordPost } = await import("./posting-limits.js");
      const quota = await recordPost(body.address, {
        taskId: body.taskId,
        txHash: body.txHash,
        description: body.description,
        budgetUsdc: body.budgetUsdc,
        deadlineDays: body.deadlineDays,
        discoveryOpen: body.discoveryOpen,
        market,
      });
      return { status: 200, json: quota };
    } catch (e) {
      const status = e.code === "QUOTA_EXCEEDED" ? 429 : 400;
      return { status, json: { error: e.message, quota: e.quota ?? null } };
    }
  }

  if (method === "POST" && pathname === "/api/posting/check") {
    try {
      const { assertCanPost } = await import("./posting-limits.js");
      const quota = await assertCanPost(body.address, body.market);
      return { status: 200, json: quota };
    } catch (e) {
      return { status: e.code === "QUOTA_EXCEEDED" ? 429 : 400, json: { error: e.message, quota: e.quota ?? null } };
    }
  }

  if (method === "POST" && pathname === "/api/posting/upgrade") {
    try {
      if (!BILLING_WALLET) throw new Error("Billing wallet not configured on server.");
      if (!MANIFEST?.external?.usdc) throw new Error("USDC address missing from manifest.");
      const { applyUpgrade } = await import("./posting-limits.js");
      const quota = await applyUpgrade({
        address: body.address,
        market,
        tier: body.tier,
        txHash: body.txHash,
        billingWallet: BILLING_WALLET,
        usdcAddress: MANIFEST.external.usdc,
        azlAddress: MANIFEST.external.azl,
        rpcUrl: BASE_RPC,
        payWith: body.payWith ?? "usdc",
        quoteId: body.quoteId,
      });
      return { status: 200, json: quota };
    } catch (e) {
      return { status: 400, json: { error: e.message ?? String(e) } };
    }
  }

  return { status: 404, json: { error: "not_found" } };
}
