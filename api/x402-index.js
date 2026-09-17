import services from "./lib/x402-services.json" with { type: "json" };
import host from "./lib/x402-host.json" with { type: "json" };
import contracts from "./lib/contracts.json" with { type: "json" };

function originFor(req) {
  const forwardedHost = req.headers?.["x-forwarded-host"];
  const host = String(forwardedHost || req.headers?.host || "www.azzle.org").split(",")[0].trim();
  const forwardedProto = req.headers?.["x-forwarded-proto"];
  const protocol = host.includes("localhost") || host.startsWith("127.") ? "http" : String(forwardedProto || "https").split(",")[0].trim();
  return `${protocol}://${host}`;
}

function discoveryDocument(req) {
  const origin = originFor(req);
  const items = Object.entries(services).map(([service, definition]) => ({
    resource: `${origin}/x402/${service}`,
    type: "http",
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: String(Math.round(Number(definition.price) * 1_000_000)),
      asset: contracts.usdc,
      payTo: host.wallet,
      maxTimeoutSeconds: 60,
    }],
    extensions: definition.extensions,
    lastUpdated: new Date().toISOString(),
  }));
  return {
    items,
    pagination: { limit: items.length, offset: 0 },
  };
}

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD, OPTIONS", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const body = JSON.stringify(discoveryDocument(req));
  res.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}
