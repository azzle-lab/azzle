import { PLANS, AZL_PAY_DISCOUNT } from "./posting-plans.mjs";
import { baseCfg } from "./manifest.mjs";
import { postingStoreBackend } from "./posting-store.mjs";
import { apiJson } from "./vercel-http.mjs";

const DEPLOYED_AZL_HOP = "0xd089c46C01ccDE2875CCD4Fc46F8D1B170dd32D9";

export function buildSiteConfigResponse() {
  const {
    PRIVY_APP_ID,
    PRIVY_CLIENT_ID,
    BASE_RPC,
    MANIFEST,
    BILLING_WALLET,
  } = baseCfg();

  return apiJson(200, {
    privyAppId: PRIVY_APP_ID,
    privyClientId: PRIVY_CLIENT_ID,
    chainId: Number(MANIFEST?.chainId ?? 8453),
    chainName: "Base",
    rpcUrl: BASE_RPC,
    contracts: MANIFEST
      ? {
          usdc: MANIFEST.external.usdc,
          azlToken: MANIFEST.external.azl,
          taskRegistry: MANIFEST.taskRegistry,
          depositVault: MANIFEST.depositVault,
          treasuryRouter: MANIFEST.treasuryRouter,
          escrowVault: MANIFEST.escrowVault,
          stakingVault: MANIFEST.stakingVault,
          arbitrationModule: MANIFEST.arbitrationModule,
          reputationRegistry: MANIFEST.reputationRegistry,
          verifierBondVault: MANIFEST.verifierBondVault,
          usdOracle: MANIFEST.usdOracle,
          pricingPolicy: MANIFEST.pricingPolicy,
          paymentGateway: MANIFEST.paymentGateway,
          azlHop: process.env.V2_HOP_ADDRESS?.trim() || DEPLOYED_AZL_HOP,
          pimlicoBundlerUrl: process.env.PIMLICO_BUNDLER_URL?.trim() || "",
          taskScopeRegistry: MANIFEST.taskScopeRegistry || null,
          observationOracle: MANIFEST.observationOracle,
          twapAdapter: MANIFEST.twapAdapter,
          usdcWethLeg: MANIFEST.usdcWethLeg,
          exactInputExecutor: MANIFEST.exactInputExecutor,
          factory: MANIFEST.factory,
          governance: MANIFEST.governance,
          external: MANIFEST.external,
          risk: MANIFEST.risk,
          actionCredits: MANIFEST.actionCredits,
        }
      : null,
    billingWallet: BILLING_WALLET || null,
    postingPlans: Object.values(PLANS),
    azlPayDiscount: AZL_PAY_DISCOUNT,
    postingStore: postingStoreBackend(),
  });
}
