import { summarizeV2Markets } from "./lib/tasks-rpc-v2.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  try {
    const totals = await summarizeV2Markets();
    res.writeHead(200, {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    });
    res.end(JSON.stringify(totals));
  } catch (error) {
    const message = error?.message ?? String(error);
    res.writeHead(503, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "v2_unavailable", message }));
  }
}
