import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { buildEnvelope } from "../dist/sdk/xmtp/envelope.js";
import { parseTaskPreview, serializeTaskPreview } from "./terms-utils.mjs";

const CHAIN_ID = 8453n;

function nonbindingPreviewHash(preview) {
  return ethers.id(JSON.stringify(preview));
}

export function buildTaskPreview(from, flags, manifest) {
  const fail = (msg) => {
    throw new Error(msg);
  };
  const preview = serializeTaskPreview(parseTaskPreview(from, flags, manifest, { fail }));
  return {
    ok: true,
    action: "build-task-preview",
    chainId: Number(CHAIN_ID),
    task: preview,
    nonbindingPreviewHash: nonbindingPreviewHash(preview),
    note: "Off-chain preview only. The V2 task contract binds totalAmount and deadline; publish acceptance criteria separately as scope or retain it off-chain.",
  };
}

export function verifyTaskPreviewHash(from, flags, manifest) {
  const bundle = buildTaskPreview(from, flags, manifest);
  const expected = flags.preview_hash;
  if (!expected) {
    throw new Error("--preview-hash required to verify");
  }
  const match = bundle.nonbindingPreviewHash.toLowerCase() === expected.toLowerCase();
  return {
    ok: true,
    action: "verify-task-preview-hash",
    match,
    computed: bundle.nonbindingPreviewHash,
    expected,
    task: bundle.task,
    note: "This compares nonbinding off-chain task-preview hashes only.",
  };
}

export function buildXmtpProposal(from, flags, manifest) {
  const market = flags.market;
  if (market !== "standard" && market !== "micro") {
    throw new Error("--market standard|micro is required for every XMTP negotiation");
  }
  if (manifest.market !== market) throw new Error("Selected XMTP market does not match manifest");
  const bundle = buildTaskPreview(from, flags, manifest);
  const negotiationId = flags.negotiation_id ?? randomUUID();
  const taskSummary = {
    title: flags.title ?? "AZZLE task",
    description: flags.description ?? "",
    acceptanceCriteriaHash: bundle.task.acceptanceCriteriaHash,
    totalAmountAzlWei: bundle.task.totalAmountAzlWei,
    deadline: bundle.task.deadline,
  };

  const envelope = buildEnvelope({
    type: "TaskProposal",
    negotiationId,
    sequence: Number(flags.sequence ?? "1"),
    market,
    previousHash: flags.previous_hash,
    sender: {
      evmAddress: from.toLowerCase(),
      xmtpPublicKey: flags.xmtp_public_key ?? "0x" + "00".repeat(32),
    },
    payload: {
      type: "azzle/TaskProposal",
      task: taskSummary,
      nonbindingPreviewHash: bundle.nonbindingPreviewHash,
      taskPreview: bundle.task,
    },
  });

  return {
    ok: true,
    action: "build-xmtp-proposal",
    negotiationId,
    nonbindingPreviewHash: bundle.nonbindingPreviewHash,
    task: bundle.task,
    envelope,
    nextSteps: [
      "Counterparty reviews the nonbinding task preview",
      "Poster posts the V2 task, worker claims it, then poster funds it",
      "Use the V2 lifecycle: mark-delivered, release or complete; cancel, expire, or open-dispute when applicable",
    ],
  };
}
