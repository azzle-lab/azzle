import { readJsonBody } from "./lib/vercel-http.js";
import { CORS, sendJson } from "./lib/respond.js";
import { handleCrowdfundRequest } from "./lib/crowdfund-board.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  let body = {};
  if (req.method === "POST") {
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
  }
  const host = req.headers?.host || "azzle.org";
  const url = new URL(req.url || "/api/crowdfund-campaigns", `https://${host}`);
  const result = await handleCrowdfundRequest({
    method: req.method || "GET",
    searchParams: url.searchParams,
    body,
  });
  if (result.status === 204) {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  sendJson(res, result.status, result.json, { "Cache-Control": "no-store" });
}
