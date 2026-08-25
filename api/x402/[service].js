import { handleX402Proxy } from "../lib/x402-proxy.js";

export default async function handler(req, res) {
  const service = typeof req.query?.service === "string" ? req.query.service : req.query?.service?.[0];
  await handleX402Proxy(req, res, service);
}
