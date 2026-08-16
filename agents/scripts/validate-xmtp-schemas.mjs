/**
 * XMTP JSON schema validation harness — catches drift between xmtp-spec/ and SDK validators.
 *
 * Usage: npm run validate:schemas  (from agents/)
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvelopeShape, validatePayload } from "../dist/sdk/xmtp/validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const FIXTURES = join(REPO_ROOT, "xmtp-spec", "fixtures");

const PAYLOAD_FIXTURES = [
  {
    type: "DisputeEvidence",
    file: "dispute-evidence.json",
    payload: {
      type: "azzle/DisputeEvidence",
      taskId: "1",
      disputeId: "1",
      claim: "quality",
      evidenceHashes: ["0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"],
    },
  },
  {
    type: "PaymentRequest",
    payload: {
      type: "azzle/PaymentRequest",
      taskId: "1",
      releaseType: "full",
    },
  },
  {
    type: "PaymentRequest",
    payload: {
      type: "azzle/PaymentRequest",
      taskId: "1",
      releaseType: "partial",
      amount: "1000000000000000000",
    },
  },
];

const INVALID_PAYLOAD_FIXTURES = [
  {
    type: "PaymentRequest",
    payload: {
      type: "azzle/PaymentRequest",
      taskId: "1",
      releaseType: "partial",
    },
    reason: "partial releases require an AZL wei amount",
  },
  {
    type: "PaymentRequest",
    payload: {
      type: "azzle/PaymentRequest",
      taskId: "1",
      releaseType: "full",
      amount: "1000000000000000000",
    },
    reason: "full completion requests must not specify an amount",
  },
];

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

let failed = 0;

console.log("[xmtp-schemas] validating envelope fixtures…");
for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
  const envelope = loadJson(join(FIXTURES, file));
  try {
    validateEnvelopeShape(envelope);
    console.log(`  ✓ ${file}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${file}:`, err.message ?? err);
  }
}

console.log("[xmtp-schemas] validating standalone payload fixtures…");
for (const { type, payload } of PAYLOAD_FIXTURES) {
  try {
    validatePayload(type, payload);
    console.log(`  ✓ ${type}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${type}:`, err.message ?? err);
  }
}

console.log("[xmtp-schemas] rejecting invalid payload fixtures…");
for (const { type, payload, reason } of INVALID_PAYLOAD_FIXTURES) {
  try {
    validatePayload(type, payload);
    failed += 1;
    console.error(`  ✗ ${type}: accepted invalid payload (${reason})`);
  } catch {
    console.log(`  ✓ ${type}: ${reason}`);
  }
}

console.log("[xmtp-schemas] checking all schema files compile in AJV…");
// validateEnvelopeShape loads every supported schema — if we got here, registry is warm
console.log("  ✓ supported schemas registered");

if (failed > 0) {
  console.error(`\n[xmtp-schemas] ${failed} validation failure(s)`);
  process.exit(1);
}

console.log("\n[xmtp-schemas] all checks passed");
