/**
 * Lift Bankr's x402 v2-labelled 402 into the v2 envelope scanners expect:
 * top-level `resource` + `extensions.bazaar`.
 */
export function toV2PaymentRequired(bankrBody, { resourceUrl, description, mimeType, bazaar }) {
  const raw = bankrBody?.accepts?.[0] && typeof bankrBody.accepts[0] === "object" ? bankrBody.accepts[0] : {};
  const accept = { ...raw };
  delete accept.resource;
  delete accept.description;
  delete accept.mimeType;
  const body = {
    x402Version: 2,
    error: bankrBody?.error || "Payment Required",
    resource: {
      url: resourceUrl,
      description: description || raw.description || "",
      mimeType: mimeType || "application/json",
    },
    accepts: [accept],
    extensions: { bazaar },
  };
  if (bankrBody?.facilitator) body.facilitator = bankrBody.facilitator;
  return body;
}

export function encodePaymentRequired(body) {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
}

export const X402_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Payment-Signature, PAYMENT-SIGNATURE, Payment-Required, PAYMENT-REQUIRED, X-PAYMENT, X-Payment-Required",
  "Access-Control-Expose-Headers": "Payment-Required, PAYMENT-REQUIRED, X-Payment-Required, Payment-Response, PAYMENT-RESPONSE",
  "Access-Control-Max-Age": "86400",
};

export function paymentRequiredHeaders(body) {
  const encoded = encodePaymentRequired(body);
  return {
    ...X402_CORS,
    "Content-Type": "application/json",
    "Payment-Required": encoded,
    "PAYMENT-REQUIRED": encoded,
    "X-Payment-Required": encoded,
  };
}
