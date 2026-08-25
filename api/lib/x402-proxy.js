import { paymentRequiredHeaders, toV2PaymentRequired, X402_CORS } from "./x402-v2.js";
import host from "./x402-host.json" with { type: "json" };
import services from "./x402-services.json" with { type: "json" };

const PAYMENT_HEADER_NAMES = [
  "accept",
  "content-type",
  "payment-signature",
  "payment-required",
  "x-payment",
  "x-payment-signature",
  "x-payment-required",
];

function header(req, name) {
  return req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
}

function bankrWallet() {
  return (process.env.X402_CLOUD_WALLET || host.wallet || "").toLowerCase();
}

function bankrOrigin() {
  return (process.env.X402_CLOUD_ORIGIN || host.origin || "https://x402.bankr.bot").replace(/\/$/, "");
}

export function publicResourceUrl(req, service) {
  const hostHeader = String(header(req, "x-forwarded-host") || header(req, "host") || "www.azzle.org")
    .split(",")[0]
    .trim();
  const proto = hostHeader.includes("localhost") || hostHeader.startsWith("127.")
    ? "http"
    : String(header(req, "x-forwarded-proto") || "https").split(",")[0].trim();
  return `${proto}://${hostHeader}/x402/${service}`;
}

function incomingUrl(req) {
  const resource = publicResourceUrl(req, "x");
  const parsed = new URL(req.url || "/", resource);
  return parsed;
}

function pickForwardHeaders(req) {
  const out = { "user-agent": header(req, "user-agent") || "azzle-x402-proxy" };
  for (const name of PAYMENT_HEADER_NAMES) {
    const value = header(req, name);
    if (value) out[name] = value;
  }
  return out;
}

function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return Promise.resolve(null);
  if (req.body != null && typeof req.body !== "string" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(JSON.stringify(req.body));
  }
  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function handleX402Proxy(req, res, serviceName) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, X402_CORS);
      res.end();
      return;
    }
    const service = services[serviceName];
    if (!service) {
      res.writeHead(404, { ...X402_CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unknown_x402_service", service: serviceName }));
      return;
    }
    const wallet = bankrWallet();
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
      res.writeHead(500, { ...X402_CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "x402_host_wallet_missing" }));
      return;
    }
    const url = incomingUrl(req);
    const upstream = `${bankrOrigin()}/${wallet}/${serviceName}${url.search}`;
    const body = await readBody(req);
    const init = { method: req.method, headers: pickForwardHeaders(req) };
    if (body && req.method !== "GET" && req.method !== "HEAD") {
      init.body = body;
      if (!init.headers["content-type"]) init.headers["content-type"] = "application/json";
    }
    const bankrRes = await fetch(upstream, init);
    const buf = Buffer.from(await bankrRes.arrayBuffer());
    if (bankrRes.status === 402) {
      let parsed;
      try {
        parsed = JSON.parse(buf.toString("utf8"));
      } catch {
        parsed = {};
      }
      const rewritten = toV2PaymentRequired(parsed, {
        resourceUrl: publicResourceUrl(req, serviceName),
        description: service.description,
        mimeType: service.mimeType || "application/json",
        bazaar: service.extensions?.bazaar,
      });
      res.writeHead(402, paymentRequiredHeaders(rewritten));
      res.end(JSON.stringify(rewritten));
      return;
    }
    const headers = { ...X402_CORS };
    const contentType = bankrRes.headers.get("content-type");
    if (contentType) headers["Content-Type"] = contentType;
    const paymentResponse = bankrRes.headers.get("payment-response") || bankrRes.headers.get("PAYMENT-RESPONSE");
    if (paymentResponse) headers["Payment-Response"] = paymentResponse;
    res.writeHead(bankrRes.status, headers);
    res.end(buf);
  } catch (error) {
    const message = error?.message ?? String(error);
    res.writeHead(502, { ...X402_CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "x402_upstream_unavailable", message }));
  }
}
