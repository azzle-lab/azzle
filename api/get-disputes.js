import { listV2Tasks } from "./lib/tasks-rpc-v2.js";
import { getTaskDetail } from "./lib/task-detail.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" });
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const host = req.headers?.host || "azzle.org";
    const url = new URL(req.url || "/api/get-disputes", "https://" + host);
    const market = url.searchParams.get("market");
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const markets = market ? [market] : ["micro", "standard"];
    const tasks = [];
    for (const lane of markets) {
      const listed = await listV2Tasks({ limit, state: "DISPUTED", market: lane });
      for (const row of listed.tasks ?? []) {
        let detail = row;
        try {
          const full = await getTaskDetail(row.id, lane);
          if (full) detail = { ...row, ...full };
        } catch {
          /* keep scan row */
        }
        tasks.push(detail);
      }
    }
    tasks.sort((a, b) => {
      const da = Number(a.dispute?.rulingDeadline || a.dispute?.evidenceDeadline || a.deadline || 0);
      const db = Number(b.dispute?.rulingDeadline || b.dispute?.evidenceDeadline || b.deadline || 0);
      return da - db;
    });
    sendJson(res, 200, { count: tasks.length, tasks });
  } catch (err) {
    const message = err?.message ?? String(err);
    sendJson(res, /^Unknown market /.test(message) ? 400 : 502, { error: message });
  }
}
