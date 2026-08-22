import { getUnionLeaderboard } from "./lib/union-staking.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.writeHead(204, { "Access-Control-Allow-Origin": "*" }).end();
  }
  if (req.method !== "GET") {
    return res.writeHead(405, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "method_not_allowed" }));
  }
  try {
    const url = new URL(req.url || "/api/get-union-leaderboard", `https://${req.headers?.host || "azzle.org"}`);
    const market = url.searchParams.get("market") ?? req.query?.market ?? "standard";
    const leaderboard = await getUnionLeaderboard(market);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      "Access-Control-Allow-Origin": "*",
    });
    return res.end(JSON.stringify(leaderboard));
  } catch (error) {
    return res.writeHead(502, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }).end(JSON.stringify({ error: error?.message ?? String(error) }));
  }
}
