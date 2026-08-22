import { PLANS, AZL_PAY_DISCOUNT } from "./posting-plans.mjs";
import { postingStoreBackend } from "./posting-store.mjs";
import { apiJson } from "./vercel-http.mjs";
import {
  contractsFromManifest,
  isMarketLive,
  loadMarketManifest,
  normalizeMarket,
} from "../api/lib/markets.js";

const DEPLOYED_AZL_HOP = "0xd089c46C01ccDE2875CCD4Fc46F8D1B170dd32D9";
const ECONOMICS = {
  standard: { entryDepositUsd: 25, liveTaskReserveUsd: 8, accessFeeUsd: 5, exitCompensationUsd: 2.5, exitProtocolShareUsd: 2.5, maxTaskUsd: 10000, postingFloorUsd: 45, postingFloorUsd6: "45000000" },
  micro: { entryDepositUsd: 3, liveTaskReserveUsd: 1, accessFeeUsd: 0.5, exitCompensationUsd: 0.25, exitProtocolShareUsd: 0.25, maxTaskUsd: 50, postingFloorUsd: 5, postingFloorUsd6: "5000000" },
};

export function buildSiteConfigResponse(searchParams) {
  const market = normalizeMarket(searchParams?.get?.("market"));
  const standard = loadMarketManifest("standard");
  const micro = loadMarketManifest("micro");
  const manifest = market === "micro" ? micro : standard;
  return apiJson(200, {
    privyAppId: process.env.PRIVY_APP_ID || "",
    privyClientId: process.env.PRIVY_CLIENT_ID || "",
    privySignerId: process.env.PRIVY_SIGNER_ID || "",
    chainId: Number(manifest.chainId),
    chainName: "Base",
    rpcUrl: process.env.BASE_RPC_URL || "https://base-rpc.publicnode.com",
    market,
    live: isMarketLive(manifest),
    contracts: {
      ...contractsFromManifest(manifest),
      azlHop: process.env.V2_HOP_ADDRESS?.trim() || DEPLOYED_AZL_HOP,
      pimlicoBundlerUrl: process.env.PIMLICO_BUNDLER_URL?.trim() || "",
    },
    v2: true,
    taskUnit: "AZL",
    taskStates: ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"],
    economics: { ...ECONOMICS[market], accessFee: "oracle-derived AZL via AzlPricingPolicy.accessFeeAzl()" },
    markets: {
      standard: { live: isMarketLive(standard), economics: ECONOMICS.standard },
      micro: { live: isMarketLive(micro), economics: ECONOMICS.micro },
    },
    billingWallet: process.env.AZZLE_BILLING_WALLET || manifest.governance || null,
    postingPlans: Object.values(PLANS),
    azlPayDiscount: AZL_PAY_DISCOUNT,
    postingStore: postingStoreBackend(),
  });
}
