import { contractsFromManifest, loadMarketManifest } from "./markets.js";

const CAIP2_BASE = "eip155:8453";
const PRIVY_API = "https://api.privy.io";
const TOKENS = Object.freeze({
  eth: { id: "eth", label: "ETH", decimals: 18, native: true },
  usdc: { id: "usdc", label: "USDC", decimals: 6, native: false },
  azl: { id: "azl", label: "AZL", decimals: 18, native: false },
});

function tokenOf(id) {
  const token = TOKENS[String(id || "").toLowerCase()];
  if (!token) throw new Error("Swap only supports ETH, USDC, and AZL on Base.");
  return token;
}

function toBaseUnits(amount, decimals) {
  const raw = String(amount ?? "").trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) throw new Error("Enter a valid swap amount.");
  const [whole, frac = ""] = raw.split(".");
  if (frac.length > decimals) throw new Error("Too many decimal places for that token.");
  const fracPad = (frac + "0".repeat(decimals)).slice(0, decimals);
  const value = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPad || "0");
  if (value <= 0n) throw new Error("Swap amount must be greater than zero.");
  return value.toString();
}

function fromBaseUnits(raw, decimals) {
  const s = String(raw || "0").replace(/^0+(?=\d)/, "") || "0";
  if (decimals === 0) return s;
  const pad = s.padStart(decimals + 1, "0");
  const i = pad.length - decimals;
  const whole = pad.slice(0, i).replace(/^0+(?=\d)/, "") || "0";
  const frac = pad.slice(i).replace(/0+$/, "");
  return frac ? whole + "." + frac : whole;
}

function assetAddress(token, contracts) {
  if (token.native) return "native";
  const address = token.id === "usdc" ? contracts.usdc : contracts.azlToken;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Missing " + token.label + " token in the V2 manifest.");
  }
  return address;
}

function envValue(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return "";
}

function privyAuth() {
  const appId = envValue("PRIVY_APP_ID");
  const secret = envValue("PRIVY_APP_SECRET");
  if (!appId || !secret) {
    throw Object.assign(new Error("Swap is not configured — add PRIVY_APP_SECRET on the server."), { status: 503 });
  }
  return { appId, secret };
}

function detailText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return String(value.message || value.error || value.code || JSON.stringify(value));
  }
  return String(value);
}

function isNoQuoteDetail(status, detail) {
  const lower = String(detail || "").toLowerCase();
  return (
    status === 404 ||
    lower.includes("no quotes") ||
    lower.includes("no route") ||
    lower.includes("token or route")
  );
}

function noQuoteMessage() {
  return "Privy had no route for this amount just now. Wait a moment and try the same size again.";
}

function privyErrorMessage(status, detail) {
  const text = detailText(detail).trim();
  const lower = text.toLowerCase();
  if (lower.includes("swaps not enabled")) {
    return "Privy swaps are not enabled for this PRIVY_APP_ID. Confirm the dashboard app matches the ID in .env.";
  }
  if (lower.includes("gas sponsorship") && (lower.includes("not enabled") || lower.includes("required"))) {
    return "Privy gas sponsorship is required for swaps. Enable it for this same app ID and fund gas credits.";
  }
  if (lower.includes("invalid wallet") || lower.includes("wallet id") || lower.includes("wallet_id")) {
    return "Could not find this embedded wallet for swaps. Sign in with email, then retry.";
  }
  if (lower.includes("insufficient") || lower.includes("balance")) {
    return "Not enough balance to complete this swap.";
  }
  if (isNoQuoteDetail(status, text)) {
    return noQuoteMessage();
  }
  if (lower.includes("slippage")) {
    return "Price moved past slippage tolerance. Get a fresh quote and try again.";
  }
  if (lower.includes("authorization signature") || lower.includes("signing keys")) {
    return "Privy could not authorize this swap. Finish the Privy prompt, then try again.";
  }
  return text.slice(0, 220) || "Swap request failed (" + status + ").";
}

function clientStatus(status) {
  if (status === 404) return 422;
  if (status >= 500) return 502;
  return status;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function privyFetch(path, { method = "GET", body, signature = "" } = {}, attempt = 0) {
  const { appId, secret } = privyAuth();
  const headers = {
    Authorization: "Basic " + Buffer.from(appId + ":" + secret).toString("base64"),
    "privy-app-id": appId,
    "Content-Type": "application/json",
  };
  if (signature) headers["privy-authorization-signature"] = signature;
  const res = await fetch(PRIVY_API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text.slice(0, 240) };
  }
  if (res.status === 429 && attempt < 1) {
    await sleep(450);
    return privyFetch(path, { method, body, signature }, attempt + 1);
  }
  if (!res.ok) {
    const detail = detailText(json.error || json.message || json.cause || json.code || text.slice(0, 240));
    console.error("[wallet-swap]", method, path, res.status, detail);
    throw Object.assign(new Error(privyErrorMessage(res.status, detail)), {
      status: clientStatus(res.status),
      privyStatus: res.status,
      detail,
    });
  }
  return json;
}

function missingSwapWallet() {
  return Object.assign(
    new Error("Swap needs a Privy embedded wallet. External wallets can still send and deposit."),
    { status: 400 }
  );
}

function walletIdFrom(record, address) {
  const addr = String(address || "").toLowerCase();
  if (!record?.id) return "";
  if (addr && record.address && String(record.address).toLowerCase() !== addr) return "";
  return String(record.id);
}

async function lookupWalletByAddress(address) {
  try {
    const found = await privyFetch("/v1/wallets/address", {
      method: "POST",
      body: { address },
    });
    const id = walletIdFrom(found, address);
    if (id) return id;
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) throw error;
  }
  const json = await privyFetch("/v1/wallets?chain_type=ethereum&address=" + encodeURIComponent(address));
  const wallets = json.data || json.wallets || json.items || (Array.isArray(json) ? json : []);
  const hit =
    wallets.find((w) => String(w.address || "").toLowerCase() === address.toLowerCase()) || null;
  return walletIdFrom(hit, address);
}

async function resolveWalletId({ address }) {
  const addr = String(address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    throw Object.assign(new Error("Sign in with the Azzle embedded wallet to swap."), { status: 400 });
  }
  const walletId = await lookupWalletByAddress(addr);
  if (!walletId) throw missingSwapWallet();
  return walletId;
}

function wethAddress(contracts) {
  const address = contracts.external?.weth;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return "";
  return address;
}

function swapBody(from, to, amount, contracts, overrides = {}) {
  const azlPair = from.id === "azl" || to.id === "azl";
  return {
    source: {
      caip2: CAIP2_BASE,
      asset_address: assetAddress(from, contracts),
    },
    destination: {
      caip2: CAIP2_BASE,
      asset_address: overrides.destAsset || assetAddress(to, contracts),
    },
    base_amount: overrides.baseAmount || toBaseUnits(amount, from.decimals),
    amount_type: overrides.amountType || "exact_input",
    slippage_bps: overrides.slippageBps ?? (azlPair ? 500 : 100),
  };
}

function sameAsset(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function payloadMatchesPair(payload, from, to, amount, contracts) {
  if (!payload || typeof payload !== "object") return false;
  const weth = wethAddress(contracts);
  const destWanted = assetAddress(to, contracts);
  const destOk =
    sameAsset(payload.destination?.asset_address, destWanted) ||
    (to.id === "eth" && weth && sameAsset(payload.destination?.asset_address, weth));
  const srcOk = sameAsset(payload.source?.asset_address, assetAddress(from, contracts));
  const caipOk = payload.source?.caip2 === CAIP2_BASE;
  if (payload.amount_type === "exact_output") {
    return srcOk && destOk && caipOk;
  }
  return (
    srcOk &&
    destOk &&
    caipOk &&
    payload.amount_type === "exact_input" &&
    String(payload.base_amount) === toBaseUnits(amount, from.decimals)
  );
}

function isNoQuoteError(error) {
  return isNoQuoteDetail(error?.privyStatus ?? error?.status, error?.detail || error?.message);
}

async function quotePayload(path, payload) {
  try {
    return await privyFetch(path + "/quote", { method: "POST", body: payload });
  } catch (error) {
    if (!isNoQuoteError(error)) throw error;
    await sleep(350);
    return privyFetch(path + "/quote", { method: "POST", body: payload });
  }
}

async function quoteAzlSell(path, from, to, amount, contracts) {
  const weth = wethAddress(contracts);
  if (!weth) return null;
  const viaWeth = swapBody(from, to, amount, contracts, { destAsset: weth });
  let wethQuote;
  try {
    wethQuote = await quotePayload(path, viaWeth);
  } catch (error) {
    if (!isNoQuoteError(error)) throw error;
    return null;
  }
  const wethOut = wethQuote.est_output_amount;
  if (!wethOut) return null;
  if (to.id === "eth") {
    const payload = swapBody(from, to, amount, contracts, {
      destAsset: "native",
      amountType: "exact_output",
      baseAmount: String(wethOut),
    });
    return { quote: await quotePayload(path, payload), payload };
  }
  if (to.id !== "usdc") return { quote: wethQuote, payload: viaWeth };
  const hop = await quotePayload(path, {
    source: { caip2: CAIP2_BASE, asset_address: "native" },
    destination: { caip2: CAIP2_BASE, asset_address: assetAddress(to, contracts) },
    base_amount: String(wethOut),
    amount_type: "exact_input",
    slippage_bps: 100,
  });
  const payload = swapBody(from, to, amount, contracts, {
    amountType: "exact_output",
    baseAmount: String(hop.est_output_amount),
  });
  return { quote: await quotePayload(path, payload), payload };
}

async function quoteSwap(path, from, to, amount, contracts) {
  const direct = swapBody(from, to, amount, contracts);
  try {
    return { quote: await quotePayload(path, direct), payload: direct };
  } catch (error) {
    if (!isNoQuoteError(error)) throw error;
    if (from.id === "azl") {
      try {
        const via = await quoteAzlSell(path, from, to, amount, contracts);
        if (via) return via;
      } catch (fallbackErr) {
        if (!isNoQuoteError(fallbackErr)) throw fallbackErr;
      }
    }
    console.error("[wallet-swap] no quote", from.id, "→", to.id, amount);
    throw Object.assign(new Error(noQuoteMessage()), {
      status: 422,
      detail: error.detail || error.message || "",
    });
  }
}

function failureMessage(status) {
  const reason = status.failure_reason || status.error || {};
  const fromReason = detailText(reason.message || reason.details || reason);
  const steps = Array.isArray(status.steps) ? status.steps : [];
  const fromStep = steps
    .map((step) => detailText(step.failure_reason?.message || step.failure_reason || step.error || ""))
    .find(Boolean);
  const raw = fromReason || fromStep || "";
  const lower = raw.toLowerCase();
  if (lower.includes("gas credit") || (lower.includes("gas sponsorship") && lower.includes("insufficient"))) {
    return "Privy gas credits are empty. Fund gas sponsorship in the Privy dashboard, then retry.";
  }
  if (lower.includes("policy")) {
    return "A Privy wallet policy blocked this swap.";
  }
  if (lower.includes("insufficient") || lower.includes("balance")) {
    return "Not enough balance in the embedded wallet for this swap.";
  }
  if (lower.includes("slippage") || lower.includes("too little") || lower.includes("price")) {
    return "Price moved too far for this pair. Try a smaller amount.";
  }
  return raw.slice(0, 180);
}

function swapPath(walletId) {
  return "/v1/wallets/" + encodeURIComponent(walletId) + "/swap";
}

function signRequestFor(walletId, payload) {
  return {
    version: 1,
    method: "POST",
    url: PRIVY_API + swapPath(walletId),
    body: payload,
    headers: { "privy-app-id": privyAuth().appId },
  };
}

function publicQuote(quote, from, to) {
  return {
    from: from.id,
    to: to.id,
    inputDisplay: fromBaseUnits(quote.input_amount, from.decimals),
    estOutputDisplay: fromBaseUnits(quote.est_output_amount, to.decimals),
    minOutputDisplay: fromBaseUnits(quote.minimum_output_amount, to.decimals),
    gasEstimate: quote.gas_estimate ?? null,
  };
}

export async function handleWalletSwap(body = {}) {
  const action = String(body.action || "quote").toLowerCase();
  const walletId = await resolveWalletId(body);

  if (action === "status") {
    const actionId = String(body.actionId || "").trim();
    if (!actionId) throw new Error("Missing swap action.");
    const to = TOKENS[String(body.to || "").toLowerCase()] || null;
    const status = await privyFetch(
      "/v1/wallets/" + encodeURIComponent(walletId) + "/actions/" + encodeURIComponent(actionId) + "?include=steps"
    );
    const failed = status.status === "failed" || status.status === "rejected";
    if (failed) {
      console.error("[wallet-swap] action", actionId, status.status, status.failure_reason || status.error || "");
    }
    return {
      ok: true,
      actionId: status.id || actionId,
      status: status.status || "pending",
      outputDisplay: status.output_amount && to ? fromBaseUnits(status.output_amount, to.decimals) : null,
      failed,
      succeeded: status.status === "succeeded",
      failure: failed ? failureMessage(status) : "",
    };
  }

  const from = tokenOf(body.from);
  const to = tokenOf(body.to);
  if (from.id === to.id) throw new Error("Pick two different tokens.");
  const contracts = contractsFromManifest(loadMarketManifest("standard"));
  const path = swapPath(walletId);

  if (action === "quote") {
    const { quote, payload } = await quoteSwap(path, from, to, body.amount, contracts);
    return {
      ok: true,
      quote: publicQuote(quote, from, to),
      walletId,
      signRequest: signRequestFor(walletId, payload),
    };
  }

  if (action === "execute") {
    const signature = String(body.authorizationSignature || "").trim();
    if (!signature) {
      throw Object.assign(
        new Error("Authorize the swap in Privy, then try again."),
        { status: 401 }
      );
    }
    const payload = payloadMatchesPair(body.swapPayload, from, to, body.amount, contracts)
      ? body.swapPayload
      : swapBody(from, to, body.amount, contracts);
    const started = await privyFetch(path, { method: "POST", body: payload, signature });
    return {
      ok: true,
      actionId: started.id,
      status: started.status || "pending",
      walletId,
    };
  }

  throw Object.assign(new Error("Unknown swap action."), { status: 400 });
}
