import assert from "node:assert/strict";
import test from "node:test";
import handler from "./x402-index.js";
import services from "./lib/x402-services.json" with { type: "json" };
import host from "./lib/x402-host.json" with { type: "json" };
import contracts from "./lib/contracts.json" with { type: "json" };

function response() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

test("x402 discovery publishes every catalog service", async () => {
  const res = response();
  await handler(
    {
      method: "GET",
      headers: { host: "www.azzle.org", "x-forwarded-proto": "https" },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/json; charset=utf-8");
  const document = JSON.parse(res.body);
  assert.equal(document.items.length, Object.keys(services).length);
  assert.deepEqual(
    document.items.map((resource) => resource.resource.split("/").pop()),
    Object.keys(services),
  );
  assert.equal(document.items[0].resource, `https://www.azzle.org/x402/${document.items[0].resource.split("/").pop()}`);
  assert.equal(document.items[0].accepts[0].asset, contracts.usdc);
  assert.equal(document.items[0].accepts[0].payTo, host.wallet);
  assert.ok(document.items.every((resource) => resource.extensions?.bazaar));
});
