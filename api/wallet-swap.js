import { readJsonBody } from "./lib/vercel-http.js";
import { CORS, sendJson } from "./lib/respond.js";
import { handleWalletSwap } from "./lib/wallet-swap.js";

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    const body = await readJsonBody(req);
    const result = await handleWalletSwap(body, req.headers);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, err?.status && err.status < 600 ? err.status : 400, {
      error: err?.message ?? String(err),
      ...(err?.detail && err.detail !== err.message ? { detail: err.detail } : {}),
    });
  }
}
