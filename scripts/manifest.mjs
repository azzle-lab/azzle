import { readFileSync, existsSync } from "node:fs";
import { loadMarketManifest, normalizeMarket } from "../api/lib/markets.js";

export function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

export function loadManifest(market = "standard") {
  return loadMarketManifest(normalizeMarket(market));
}

export function baseCfg(market = "standard") {
  const MANIFEST = loadManifest(market);
  return {
    BANKR_BASE: (process.env.OPENAI_BASE_URL ?? "https://llm.bankr.bot/v1").replace(/\/$/, ""),
    BANKR_KEY: process.env.BANKR_API_KEY ?? process.env.BANKR_KEY ?? "",
    MODEL: process.env.AZZLE_LLM_MODEL ?? "deepseek-v4-flash",
    PRIVY_APP_ID: process.env.PRIVY_APP_ID ?? "",
    PRIVY_CLIENT_ID: process.env.PRIVY_CLIENT_ID ?? "",
    BASE_RPC: process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com",
    MANIFEST,
    BILLING_WALLET: process.env.AZZLE_BILLING_WALLET ?? MANIFEST?.governance ?? "",
  };
}
