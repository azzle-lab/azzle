/**
 * Shared HTTP handlers for azzle.org — local site-server + Vercel /api/*.
 * Heavy deps (viem) load only for posting/chain routes.
 */
import { loadEnvFile } from "./manifest.mjs";
import { baseCfg } from "./manifest.mjs";
import { PLANS, AZL_PAY_DISCOUNT } from "./posting-plans.mjs";
import { buildSiteConfigResponse } from "./site-config-handler.mjs";
import { CORS, apiJson } from "./vercel-http.mjs";
import { normalizeMarket, parseTaskRef } from "../api/lib/markets.js";

export { loadEnvFile, loadManifest } from "./manifest.mjs";
export { sendApiResult } from "./vercel-http.mjs";

async function postingLimits() {
  return import("./posting-limits.mjs");
}

async function azlPrice() {
  return import("./azl-price.mjs");
}

async function posterTasksMod() {
  return import("./poster-tasks.mjs");
}

function isBadBoundaryInput(error) {
  return /^Unknown market |^Bare numeric task ids|^Unscoped task id|^Invalid task id|market does not match/.test(
    error?.message ?? String(error)
  );
}

async function handleSnap({ method, searchParams, body, headers, origin }) {
  const { getVoteState, recordVote } = await import("../api/lib/snap-state.js");
  const { buildSnapPayload, snapFallbackHtml } = await import("../api/lib/snap-payload.js");
  const { SNAP_ACCEPT, SNAP_CORS, snapHtmlHeaders, snapJsonHeaders } = await import("../api/lib/snap-http.js");
  const snapUrl = `${String(origin || "http://localhost:8080").replace(/\/$/, "")}/snap`;
  const snapId = searchParams.get("i") || searchParams.get("id") || "global";
  const variant = searchParams.get("v") || searchParams.get("variant") || null;
  if (method === "OPTIONS") return { status: 204, headers: SNAP_CORS, json: null };
  if (searchParams.get("health") === "1") {
    const state = await getVoteState(snapId);
    return {
      status: 200,
      headers: { ...SNAP_CORS, "Content-Type": "application/json" },
      json: { ok: true, snapUrl, snapId, votes: { human: state.human, agent: state.agent } },
    };
  }
  const fidValue = body?.user?.fid ?? body?.authenticatedUser?.fid ?? body?.fid;
  const fid = fidValue != null ? Number(fidValue) : null;
  if (method === "POST") {
    const action = searchParams.get("action");
    if (action === "human" || action === "agent") await recordVote(action, fid, snapId);
    const state = await getVoteState(snapId);
    return {
      status: 200,
      headers: snapJsonHeaders(snapUrl),
      json: buildSnapPayload(state, { fid, snapUrl, snapId, variant }),
    };
  }
  if (method !== "GET") {
    return {
      status: 405,
      headers: { ...SNAP_CORS, "Content-Type": "application/json" },
      json: { error: "method_not_allowed" },
    };
  }
  if (String(headers?.accept || "").includes(SNAP_ACCEPT)) {
    const state = await getVoteState(snapId);
    return {
      status: 200,
      headers: snapJsonHeaders(snapUrl),
      json: buildSnapPayload(state, { snapUrl, snapId, variant }),
    };
  }
  return {
    status: 200,
    headers: snapHtmlHeaders(snapUrl),
    json: null,
    text: snapFallbackHtml(snapUrl, { snapId, variant }),
  };
}

async function proxyRoleChat(body) {
  const { BANKR_KEY, BANKR_BASE, MODEL } = baseCfg();
  if (!BANKR_KEY) {
    return apiJson(503, { error: "BANKR_API_KEY not configured" });
  }
  const { system, messages } = body;
  if (!system || !Array.isArray(messages)) {
    return apiJson(400, { error: "system and messages required" });
  }

  const payload = {
    model: body.model || MODEL,
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: 400,
    temperature: 0.3,
  };

  const upstream = await fetch(`${BANKR_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BANKR_KEY}`,
      "X-API-Key": BANKR_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return apiJson(upstream.status, {
      error: "Bankr LLM Gateway error",
      detail: text.slice(0, 500),
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return apiJson(502, { error: "Invalid JSON from gateway" });
  }

  const content = data.choices?.[0]?.message?.content ?? "";
  return apiJson(200, { text: content, model: payload.model });
}

/**
 * @param {{ method: string, pathname: string, searchParams: URLSearchParams, body?: unknown, headers?: object, origin?: string }} req
 */
export async function handleSiteApi({ method, pathname, searchParams, body = {}, headers = {}, origin }) {
  const { BANKR_KEY, BANKR_BASE, MODEL, MANIFEST, BILLING_WALLET, BASE_RPC } = baseCfg();

  if (pathname === "/snap" || pathname === "/snap/" || pathname === "/api/snap") {
    return handleSnap({ method, searchParams, body, headers, origin });
  }

  if (method === "OPTIONS") {
    return { status: 204, headers: CORS, json: null };
  }

  try {
    if (method === "POST" && pathname === "/api/role-chat") {
      return proxyRoleChat(body);
    }

    if (method === "GET" && pathname === "/api/role-chat/health") {
      return apiJson(200, { ok: Boolean(BANKR_KEY), model: MODEL, gateway: BANKR_BASE });
    }

    if (method === "GET" && pathname === "/api/site-config") {
      return buildSiteConfigResponse(searchParams);
    }

    if (method === "GET" && pathname === "/api/union/overview") {
      try {
        const { getUnionOverview } = await import("../api/lib/union-staking.js");
        return apiJson(200, await getUnionOverview(searchParams.get("market") ?? "standard"), {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
        });
      } catch (e) {
        return apiJson(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/union/leaderboard" || pathname === "/api/get-union-leaderboard")) {
      try {
        const { getUnionLeaderboard } = await import("../api/lib/union-staking.js");
        return apiJson(200, await getUnionLeaderboard(searchParams.get("market") ?? "standard"), {
          "Cache-Control": "no-store, max-age=0",
        });
      } catch (e) {
        return apiJson(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/azl/market" || pathname === "/api/get-azl-market")) {
      try {
        const { getAzlMarket } = await import("../api/lib/azl-market.js");
        return apiJson(200, await getAzlMarket(), {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
        });
      } catch (e) {
        return apiJson(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/plans") {
      return apiJson(200, {
        plans: Object.values(PLANS),
        billingWallet: BILLING_WALLET || null,
        azlPayDiscount: AZL_PAY_DISCOUNT,
      });
    }

    if (method === "GET" && pathname === "/api/posting/azl-price") {
      try {
        const { fetchAzlUsdPrice } = await azlPrice();
        const price = await fetchAzlUsdPrice();
        return apiJson(200, { ...price, discountPercent: AZL_PAY_DISCOUNT * 100 });
      } catch (e) {
        return apiJson(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/quote") {
      const tier = searchParams.get("tier");
      const address = searchParams.get("address");
      const payWith = searchParams.get("payWith") ?? "azl";
      try {
        if (payWith !== "azl") throw new Error("Only payWith=azl is supported for quotes.");
        const { createUpgradeQuote } = await postingLimits();
        const quote = await createUpgradeQuote({ address, tier, market: searchParams.get("market") });
        return apiJson(200, quote);
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/azl-preview") {
      const tier = searchParams.get("tier");
      try {
        const { previewAzlUpgrade } = await postingLimits();
        const preview = await previewAzlUpgrade(tier);
        return apiJson(200, preview);
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/posting/quota" || pathname === "/api/get-posting-quota")) {
      const address = searchParams.get("address");
      try {
        const { getQuota } = await postingLimits();
        const quota = await getQuota(address, searchParams.get("market"));
        return apiJson(200, quota);
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/poster/tasks" || pathname === "/api/get-poster-tasks")) {
      const address = searchParams.get("address");
      try {
        const { getPosterTasks } = await posterTasksMod();
        const tasks = await getPosterTasks(address, searchParams.get("market"));
        return apiJson(200, { tasks });
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/get-open-tasks-v2") {
      try {
        const { listV2Tasks } = await import("../api/lib/tasks-rpc-v2.js");
        const requestedState = searchParams.get("state");
        const result = await listV2Tasks({
          limit: searchParams.get("limit") ?? 100,
          state: requestedState === "ALL" ? undefined : requestedState || "POSTED",
          cursor: searchParams.get("cursor") ?? undefined,
          minAmountAzlWei: searchParams.get("minAmountAzlWei") ?? undefined,
          poster: searchParams.get("poster") ?? undefined,
          worker: searchParams.get("worker") ?? undefined,
          taskType: searchParams.get("taskType") ?? undefined,
          capability: searchParams.getAll("capability"),
          verificationMode: searchParams.get("verificationMode") ?? undefined,
          beforeDeadline: searchParams.get("beforeDeadline") ?? undefined,
          metadataUri: searchParams.get("metadataUri") ?? undefined,
          market: searchParams.get("market") ?? undefined,
        });
        return apiJson(200, result, {
          "Cache-Control": "no-store",
        });
      } catch (e) {
        return apiJson(isBadBoundaryInput(e) ? 400 : 503, { error: "v2_unavailable", message: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/get-disputes" || pathname === "/api/market/disputes")) {
      try {
        const { listV2Tasks } = await import("../api/lib/tasks-rpc-v2.js");
        const { getTaskDetail } = await import("../api/lib/task-detail.js");
        const market = searchParams.get("market");
        const limit = Number(searchParams.get("limit") ?? 25);
        const markets = market ? [market] : ["micro", "standard"];
        const tasks = [];
        for (const lane of markets) {
          const listed = await listV2Tasks({ limit, state: "DISPUTED", market: lane });
          for (const row of listed.tasks ?? []) {
            let detail = row;
            try {
              const full = await getTaskDetail(row.id, lane);
              if (full) detail = { ...row, ...full };
            } catch { /* keep scan row */ }
            tasks.push(detail);
          }
        }
        tasks.sort((a, b) => {
          const da = Number(a.dispute?.rulingDeadline || a.dispute?.evidenceDeadline || a.deadline || 0);
          const db = Number(b.dispute?.rulingDeadline || b.dispute?.evidenceDeadline || b.deadline || 0);
          return da - db;
        });
        return apiJson(200, { count: tasks.length, tasks }, {
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
        });
      } catch (e) {
        return apiJson(isBadBoundaryInput(e) ? 400 : 502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/get-open-tasks" || pathname === "/api/market/open")) {
      try {
        const { listV2Tasks } = await import("../api/lib/tasks-rpc-v2.js");
        const limit = searchParams.get("limit");
        const result = await listV2Tasks({ limit, state: "POSTED", market: searchParams.get("market") });
        return apiJson(200, result, {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        });
      } catch (e) {
        return apiJson(isBadBoundaryInput(e) ? 400 : 502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/get-recent-tasks" || pathname === "/api/market/recent")) {
      try {
        const { getRecentTasks } = await import("../api/lib/recent-tasks.js");
        const limit = searchParams.get("limit");
        const tasks = await getRecentTasks(limit, searchParams.get("market"));
        return apiJson(200, { tasks, count: tasks.length }, {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        });
      } catch (e) {
        return apiJson(isBadBoundaryInput(e) ? 400 : 502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/get-task") {
      try {
        const { getTaskDetail } = await import("../api/lib/task-detail.js");
        const id = searchParams.get("id") ?? searchParams.get("taskId");
        if (!id) return apiJson(400, { error: "Task id required" });
        const task = await getTaskDetail(id, searchParams.get("market") ?? undefined);
        if (!task) return apiJson(404, { error: "Task not found" });
        return apiJson(200, { task });
      } catch (e) {
        return apiJson(isBadBoundaryInput(e) ? 400 : 503, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/get-legacy-open-tasks" || pathname === "/api/market/legacy")) {
      try {
        const { listLegacyTasks } = await import("../api/get-legacy-open-tasks.js");
        const limit = searchParams.get("limit");
        return apiJson(200, await listLegacyTasks(limit ?? 100), {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        });
      } catch (e) {
        const message = e.message ?? String(e);
        return apiJson(502, {
          error: /rate limit|429|too many requests/i.test(message)
            ? "legacy_rpc_rate_limited"
            : "legacy_archive_unavailable",
          message,
        });
      }
    }

    if (method === "POST" && (pathname === "/api/posting/record" || pathname === "/api/posting-record")) {
      try {
        const { recordPost } = await postingLimits();
        const quota = await recordPost(body.address, {
          taskId: body.taskId,
          txHash: body.txHash,
          description: body.description,
          budgetUsdc: body.budgetUsdc,
          deadlineDays: body.deadlineDays,
          discoveryOpen: body.discoveryOpen,
          market: body.market,
        });
        return apiJson(200, quota);
      } catch (e) {
        const status = e.code === "QUOTA_EXCEEDED" ? 429 : 400;
        return apiJson(status, { error: e.message, quota: e.quota ?? null });
      }
    }

    if (method === "POST" && (pathname === "/api/posting/check" || pathname === "/api/posting-check")) {
      try {
        const { assertCanPost } = await postingLimits();
        const quota = await assertCanPost(body.address, body.market);
        return apiJson(200, quota);
      } catch (e) {
        return apiJson(e.code === "QUOTA_EXCEEDED" ? 429 : 400, { error: e.message, quota: e.quota ?? null });
      }
    }

    if (method === "POST" && pathname === "/api/posting/upgrade") {
      try {
        const selected = normalizeMarket(body.market);
        const selectedCfg = baseCfg(selected);
        if (!selectedCfg.BILLING_WALLET) throw new Error("Billing wallet not configured on server.");
        if (!selectedCfg.MANIFEST?.external?.usdc) throw new Error("USDC address missing from V2 manifest.");
        const { applyUpgrade } = await postingLimits();
        const quota = await applyUpgrade({
          address: body.address,
          market: selected,
          tier: body.tier,
          txHash: body.txHash,
          billingWallet: selectedCfg.BILLING_WALLET,
          usdcAddress: selectedCfg.MANIFEST.external.usdc,
          azlAddress: selectedCfg.MANIFEST.external.azl,
          rpcUrl: BASE_RPC,
          payWith: body.payWith ?? "usdc",
          quoteId: body.quoteId,
        });
        return apiJson(200, quota);
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/get-market-ledger") {
      try {
        const address = searchParams.get("address");
        if (!address) return apiJson(400, { error: "address_required" });
        const market = normalizeMarket(searchParams.get("market"));
        const { listV2Tasks } = await import("../api/lib/tasks-rpc-v2.js");
        const { summarizeLedger } = await import("../api/lib/market-ledger.js");
        const [posterTasks, workerTasks] = await Promise.all([
          listV2Tasks({ limit: 100, poster: address, market }),
          listV2Tasks({ limit: 100, worker: address, market }),
        ]);
        const seen = new Set();
        const tasks = [...posterTasks.tasks, ...workerTasks.tasks].filter((task) => {
          if (seen.has(task.id)) return false;
          seen.add(task.id);
          return true;
        });
        return apiJson(200, summarizeLedger(tasks, address, market), {
          "Cache-Control": "public, s-maxage=30",
        });
      } catch (e) {
        return apiJson(isBadBoundaryInput(e) ? 400 : 503, { error: "v2_unavailable", message: e.message ?? String(e) });
      }
    }

    if (method === "POST" && pathname === "/api/post-delivery-receipt") {
      try {
        const ref = parseTaskRef(body.taskId);
        if (body.market != null && ref.market !== normalizeMarket(body.market)) {
          throw new Error("Task id market does not match selected market");
        }
        const { getTaskDetail } = await import("../api/lib/task-detail.js");
        const { deliveryState, validateDeliveryReceipt } = await import("../api/lib/delivery-state.js");
        const task = await getTaskDetail(ref.id, ref.market);
        if (!task) return apiJson(404, { error: "task_not_found" });
        const validation = validateDeliveryReceipt(body.receipt, ref.localId, task.worker);
        return apiJson(validation.valid ? 200 : 422, {
          protocolVersion: "v2",
          market: ref.market,
          taskId: ref.id,
          registryAddress: task.registryAddress,
          accepted: validation.valid,
          validation,
          delivery: deliveryState(task, body.receipt),
          nextAction: validation.valid ? "worker_must_call_markDelivered_then_poster_releases" : "correct_receipt",
        });
      } catch (e) {
        return apiJson(400, { error: "invalid_receipt", message: e.message ?? String(e) });
      }
    }

    if (method === "POST" && pathname === "/api/wallet-swap") {
      try {
        const { handleWalletSwap } = await import("../api/lib/wallet-swap.js");
        return apiJson(200, await handleWalletSwap(body, headers));
      } catch (e) {
        const status = e.status && e.status < 600 ? e.status : 400;
        return apiJson(status, {
          error: e.message ?? String(e),
          ...(e.detail && e.detail !== e.message ? { detail: e.detail } : {}),
        });
      }
    }

    return apiJson(404, { error: "not_found" });
  } catch (err) {
    return apiJson(isBadBoundaryInput(err) ? 400 : 500, { error: err.message ?? String(err) });
  }
}
