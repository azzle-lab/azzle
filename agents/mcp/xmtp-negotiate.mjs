#!/usr/bin/env node
/**
 * XMTP negotiation helpers for AZZLE agents.
 *
 * Prerequisite: cd agents && npm run build
 *
 * Read/prepare (no keys):
 *   npm run mcp:xmtp -- build-preview --from 0xPoster --total-amount <azl-wei> ...
 *   npm run mcp:xmtp -- build-proposal --from 0xPoster --counterparty 0xWorker ...
 *   npm run mcp:xmtp -- verify-preview-hash --from 0xPoster --preview-hash 0x...
 *
 * Live send (requires PRIVATE_KEY + XMTP_DB_PATH):
 *   npm run mcp:xmtp -- send-proposal --from 0xPoster --counterparty 0xWorker ...
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNegotiationTransport } from "../dist/sdk/xmtp/transport.js";
import {
  buildTaskPreview,
  buildXmtpProposal,
  verifyTaskPreviewHash,
} from "./xmtp-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, "../deployments/base-8453.json"), "utf8")
);
const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-/g, "_");
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function fail(message) {
  output({ ok: false, error: message });
  process.exit(1);
}

function requireFrom(flags) {
  const from = flags.from;
  if (!from || !ethers.isAddress(from)) {
    fail("--from <0x address> is required");
  }
  return ethers.getAddress(from);
}

function usage() {
  return `Usage (from agents/): npm run mcp:xmtp -- <action> [flags]

Actions:
  build-preview               V2 task preview + nonbinding preview hash
  build-proposal              XMTP TaskProposal envelope JSON
  verify-preview-hash         Compare --preview-hash to computed nonbinding preview hash
  send-proposal               Live XMTP send (PRIVATE_KEY required)

Task flags (shared with mcp:prepare post):
  --from --total-amount --deadline --criteria-text OR --acceptance-criteria-hash

Proposal / send:
  --counterparty <0x>   required for send-proposal
  --title --description --negotiation-id --sequence

Verify:
  --preview-hash <bytes32>`;
}

async function cmdSendProposal(from, flags) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    fail("PRIVATE_KEY env required for live XMTP send-proposal");
  }
  const counterparty = flags.counterparty ?? fail("--counterparty required");
  if (!ethers.isAddress(counterparty)) fail("--counterparty must be valid address");

  const proposal = buildXmtpProposal(from, flags, manifest);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(pk, provider);
  const signerAddr = await signer.getAddress();
  if (signerAddr.toLowerCase() !== from.toLowerCase()) {
    fail(`PRIVATE_KEY address ${signerAddr} does not match --from ${from}`);
  }

  const transport = await createNegotiationTransport(signer, {
    counterpartyEvm: ethers.getAddress(counterparty),
    clientOptions: {
      env: process.env.XMTP_ENV ?? "production",
      dbPath: process.env.XMTP_DB_PATH ?? "./.xmtp-db",
    },
  });

  await transport.connectCounterparty(ethers.getAddress(counterparty));
  await transport.send({
    type: "TaskProposal",
    negotiationId: proposal.negotiationId,
    payload: proposal.envelope.payload,
  });

  output({
    ok: true,
    action: "send-xmtp-proposal",
    negotiationId: proposal.negotiationId,
    nonbindingPreviewHash: proposal.nonbindingPreviewHash,
    counterparty: ethers.getAddress(counterparty),
    note: "Proposal sent over XMTP. Counterparty should verify the nonbinding preview hash.",
  });
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const action = positional[0];

  if (!action || action === "help" || flags.help === "true") {
    console.log(usage());
    process.exit(0);
  }

  const from = requireFrom(flags);
  switch (action) {
    case "build-preview":
      output(buildTaskPreview(from, flags, manifest));
      break;
    case "build-proposal":
      output(buildXmtpProposal(from, flags, manifest));
      break;
    case "verify-preview-hash":
      output(verifyTaskPreviewHash(from, flags, manifest));
      break;
    case "send-proposal":
      await cmdSendProposal(from, flags);
      break;
    default:
      fail(`Unknown action: ${action}\n\n${usage()}`);
  }
}

main().catch((err) => {
  output({ ok: false, error: err.message ?? String(err) });
  process.exit(1);
});
