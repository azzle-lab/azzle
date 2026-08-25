import assert from "node:assert/strict";
import test from "node:test";
import { encodePaymentRequired, toV2PaymentRequired } from "./lib/x402-v2.js";

test("toV2PaymentRequired hoists resource and bazaar", () => {
  const bazaar = { info: { input: { type: "http", method: "GET", queryParams: { market: "micro" } } } };
  const body = toV2PaymentRequired(
    {
      x402Version: 2,
      error: "Payment Required",
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "10000",
          asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          payTo: "0x0000000000000000000000000000000000000001",
          resource: "https://x402.bankr.bot/example/azzle-open-tasks",
          description: "inner",
          mimeType: "",
        },
      ],
      facilitator: "https://api.bankr.bot/facilitator",
    },
    {
      resourceUrl: "https://www.azzle.org/x402/azzle-open-tasks",
      description: "AZZLE protocol — open tasks",
      mimeType: "application/json",
      bazaar,
    },
  );
  assert.equal(body.x402Version, 2);
  assert.equal(body.resource.url, "https://www.azzle.org/x402/azzle-open-tasks");
  assert.equal(body.resource.description, "AZZLE protocol — open tasks");
  assert.equal(body.resource.mimeType, "application/json");
  assert.equal(body.extensions.bazaar, bazaar);
  assert.equal(body.accepts[0].resource, undefined);
  assert.equal(body.accepts[0].scheme, "exact");
  assert.equal(body.accepts[0].amount, "10000");
  assert.equal(body.facilitator, "https://api.bankr.bot/facilitator");
  assert.match(encodePaymentRequired(body), /^[A-Za-z0-9+/]+=*$/);
});
