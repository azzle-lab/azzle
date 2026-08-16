#!/usr/bin/env node
/**
 * Prepare unsigned AZZLE calldata batches for Base MCP send_calls.
 *
 * Prerequisite: cd agents && npm run build
 *
 *   npm run mcp:prepare -- read --from 0x...
 *   npm run mcp:prepare -- claim --from 0x... --task-id 42
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTaskPreview } from "./terms-utils.mjs";
import { buildTaskPreview } from "./xmtp-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, "../deployments/base-8453.json"), "utf8")
);

const CHAIN_ID = 8453;
const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const MIN_VAULT_AZL = 1n;
const MAX_UINT256 = ethers.MaxUint256;

const ERC20_IFACE = new ethers.Interface([
  "function approve(address spender, uint256 amount)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);
const VAULT_IFACE = new ethers.Interface([
  "function deposits(address agent) view returns (uint256)",
  "function available(address agent) view returns (uint256)",
]);
const REGISTRY_IFACE = new ethers.Interface([
  "function post(uint256 totalAmount, uint64 deadline) returns (uint256)",
  "function claim(uint256 taskId)",
  "function fund(uint256 taskId, uint256 amount)",
  "function markDelivered(uint256 taskId)",
  "function release(uint256 taskId, uint256 amount)",
  "function complete(uint256 taskId)",
  "function cancel(uint256 taskId)",
  "function expire(uint256 taskId)",
  "function openDispute(uint256 taskId, bytes32 evidenceHash)",
]);

const ARBITRATION_IFACE = new ethers.Interface([
  "function assignArbitrator(uint256 taskId) returns (address)",
  "function submitEvidence(uint256 taskId, bytes32 evidenceHash)",
  "function beginRuling(uint256 taskId)",
  "function rule(uint256 taskId, uint8 outcome, uint16 workerBps)",
  "function timeout(uint256 taskId)",
]);

const SCOPE_IFACE = new ethers.Interface([
  "function publish(uint256 taskId, string scope)",
  "function scopeOf(uint256 taskId) view returns (string)",
]);


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

function tx(step, to, data, value = "0x0") {
  return { step, to, data, value, chainId: CHAIN_ID };
}

function encodeApprove(token, spender, amount) {
  return ERC20_IFACE.encodeFunctionData("approve", [spender, amount]);
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

async function readAllowances(from) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const azl = new ethers.Contract(manifest.external.azl, ERC20_IFACE, provider);
  const vault = new ethers.Contract(manifest.depositVault, VAULT_IFACE, provider);

  const [vaultAzl, azlBalance, escrowAllowance] =
    await Promise.all([
      vault.deposits(from),
      azl.balanceOf(from),
      azl.allowance(from, manifest.escrowVault),
    ]);

  return {
    vaultAzl,
    azlBalance,
    escrowAllowance,
  };
}

async function maybeEscrowApprove(from, amount, transactions) {
  const { escrowAllowance } = await readAllowances(from);
  if (escrowAllowance >= amount) return;
  transactions.push(
    tx(
      "approve-azl",
      manifest.external.azl,
      encodeApprove(manifest.external.azl, manifest.escrowVault, MAX_UINT256)
    )
  );
}

function encodeDisputeEvidence(raw) {
  if (raw.length === 66 && raw.startsWith("0x")) {
    return ethers.getBytes(raw);
  }
  return ethers.getBytes(ethers.id(raw));
}

function batchResponse(action, transactions) {
  return { ok: true, action, chainId: CHAIN_ID, transactions };
}

async function cmdRead(from) {
  const state = await readAllowances(from);
  const warnings = [];
  if (state.vaultAzl < MIN_VAULT_AZL) {
    warnings.push(
      `AgentDepositVault ${state.vaultAzl} AZL; fund the deposit via AzlPaymentGateway.`
    );
  }
  output({
    ok: true,
    action: "read",
    chainId: CHAIN_ID,
    wallet: from,
    manifest: {
      taskRegistry: manifest.taskRegistry,
      depositVault: manifest.depositVault,
      escrowVault: manifest.escrowVault,
      azl: manifest.external.azl,
    },
    balances: {
      vaultAzlWei: state.vaultAzl.toString(),
      azlBalanceWei: state.azlBalance.toString(),
      azlAllowanceEscrowVault: state.escrowAllowance.toString(),
    },
    warnings,
    readyForFeeActions:
      state.vaultAzl >= MIN_VAULT_AZL &&
      state.azlBalance > 0n,
  });
}

async function cmdApproveAzlEscrow() {
  output(
    batchResponse("approve-azl-escrow", [
      tx(
        "approve-azl-escrow",
        manifest.external.azl,
        encodeApprove(manifest.external.azl, manifest.escrowVault, MAX_UINT256)
      ),
    ])
  );
}

async function cmdClaim(flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  output(batchResponse("claim", [
    tx(
      "claim",
      manifest.taskRegistry,
      REGISTRY_IFACE.encodeFunctionData("claim", [taskId])
    ),
  ]));
}

function parseTaskPreviewFromFlags(from, flags) {
  return parseTaskPreview(from, flags, manifest, { fail });
}

async function cmdPost(from, flags) {
  const parsed = parseTaskPreviewFromFlags(from, flags);
  const transactions = [];
  transactions.push(
    tx(
      "post",
      manifest.taskRegistry,
      REGISTRY_IFACE.encodeFunctionData("post", [parsed.totalAmount, parsed.deadline])
    )
  );

  const discoveryPrivate = flags.discovery === "private";
  const scopeText = (flags.scope_text ?? flags.criteria_text ?? "").trim();
  const scopeRegistry = manifest.taskScopeRegistry;
  if (!discoveryPrivate && scopeRegistry && scopeText) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const taskCount = await new ethers.Contract(
      manifest.taskRegistry,
      ["function taskCount() view returns (uint256)"],
      provider
    ).taskCount();
    const nextTaskId = BigInt(taskCount) + 1n;
    transactions.push(
      tx(
        "publish-scope",
        scopeRegistry,
        SCOPE_IFACE.encodeFunctionData("publish", [nextTaskId, scopeText])
      )
    );
  }

  output(batchResponse("post", transactions));
}

async function cmdSetScope(flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  const scope = (flags.scope_text ?? flags.scope ?? fail("--scope-text required")).trim();
  if (!manifest.taskScopeRegistry) fail("taskScopeRegistry not in manifest");
  output(
    batchResponse("publish-scope", [
      tx(
        "publish-scope",
        manifest.taskScopeRegistry,
        SCOPE_IFACE.encodeFunctionData("publish", [taskId, scope])
      ),
    ])
  );
}

function cmdArbitration(action, fn, extraArgs) {
  output(
    batchResponse(action, [
      tx(action, manifest.arbitrationModule, ARBITRATION_IFACE.encodeFunctionData(fn, extraArgs)),
    ])
  );
}

async function cmdFund(from, flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  const amount = BigInt(flags.amount ?? fail("--amount required"));
  const transactions = [];
  if (flags.skip_approvals !== "true") {
    await maybeEscrowApprove(from, amount, transactions);
  }
  transactions.push(
    tx(
      "fund",
      manifest.taskRegistry,
      REGISTRY_IFACE.encodeFunctionData("fund", [taskId, amount])
    )
  );
  output(batchResponse("fund", transactions));
}

async function cmdOpenDispute(flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  const evidence = flags.evidence ?? flags.evidence_hash ?? "dispute-evidence";
  output(
    batchResponse("open-dispute", [
      tx(
        "open-dispute",
        manifest.taskRegistry,
        REGISTRY_IFACE.encodeFunctionData("openDispute", [taskId, encodeDisputeEvidence(evidence)])
      ),
    ])
  );
}

function cmdHashCriteria(flags) {
  const text = flags.text ?? flags.criteria ?? fail("--text required");
  output({
    ok: true,
    action: "hash-criteria",
    text,
    acceptanceCriteriaHash: ethers.id(text),
  });
}

function cmdHashEvidence(flags) {
  const text = flags.text ?? flags.evidence ?? fail("--text required");
  output({
    ok: true,
    action: "hash-evidence",
    nonbindingEvidenceHash: ethers.id(text),
    note: "Nonbinding off-chain evidence hash. Pass it to open-dispute only when appropriate.",
  });
}

async function cmdRegistryCall(action, fn, flags, extraArgs = []) {
  requireFrom(flags);
  output(batchResponse(action, [
    tx(action, manifest.taskRegistry, REGISTRY_IFACE.encodeFunctionData(fn, extraArgs)),
  ]));
}

function usage() {
  return `Usage (from agents/): npm run mcp:prepare -- <action> [flags]
       (direct):          node mcp/prepare-tx.mjs <action> [flags]

Actions:
  read                         Wallet + vault preflight (read-only JSON)
  approve-azl-escrow           ERC20 approve AZL → escrowVault
  post                         TaskRegistryV2.post
  claim                        TaskRegistryV2.claim
  fund                         TaskRegistryV2.fund (+ AZL approval when needed)
  mark-delivered               TaskRegistryV2.markDelivered
  release                      TaskRegistryV2.release
  complete                     TaskRegistryV2.complete
  cancel                       TaskRegistryV2.cancel
  expire                       TaskRegistryV2.expire (permissionless after deadline)
  open-dispute                 TaskRegistry.openDispute
  assign-arbitrator            ArbitrationModule.assignArbitrator
  submit-evidence              ArbitrationModule.submitEvidence
  begin-ruling                 ArbitrationModule.beginRuling
  rule-dispute                 ArbitrationModule.rule
  timeout-dispute              ArbitrationModule.timeout
  build-task-preview           V2 task preview + nonbinding off-chain hash (read-only)
  hash-criteria                Hash acceptance criteria text (read-only)
  hash-evidence                Hash nonbinding off-chain evidence text (read-only)

Common flags:
  --from <0x>                  Required for on-chain prepare actions
  --skip-approvals             Omit automatic ERC20 approve steps in batches

Action-specific:
  post          --total-amount <azl-wei> --deadline [--criteria-text | --acceptance-criteria-hash]
  claim         --task-id <id>
  fund          --task-id --amount <azl-wei> (poster only)
  mark-delivered --task-id
  release       --task-id --amount <azl-wei>
  complete      --task-id
  cancel        --task-id
  expire        --task-id
  open-dispute  --task-id [--evidence <text|bytes32>]
  assign-arbitrator --task-id
  submit-evidence --task-id --evidence <text|bytes32>
  begin-ruling --task-id
  rule-dispute --task-id --outcome <1-4> --worker-bps <0-10000>
  timeout-dispute --task-id
  build-task-preview --from <0x> + same task flags as post
  hash-criteria --text <acceptance criteria>
  hash-evidence --text <evidence>`;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const action = positional[0];

  if (!action || action === "help" || flags.help === "true") {
    console.log(usage());
    process.exit(0);
  }

  if (action === "read") {
    await cmdRead(requireFrom(flags));
    return;
  }

  if (action === "hash-criteria") {
    cmdHashCriteria(flags);
    return;
  }

  if (action === "hash-evidence") {
    cmdHashEvidence(flags);
    return;
  }

  if (action === "build-task-preview") {
    const from = requireFrom(flags);
    output(buildTaskPreview(from, flags, manifest));
    return;
  }

  const from = requireFrom(flags);

  switch (action) {
    case "approve-azl-escrow":
      await cmdApproveAzlEscrow();
      break;
    case "claim":
      await cmdClaim(flags);
      break;
    case "post":
      await cmdPost(from, flags);
      break;
    case "publish-scope":
      await cmdSetScope(flags);
      break;
    case "fund":
      await cmdFund(from, flags);
      break;
    case "complete":
      await cmdRegistryCall("complete", "complete", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "cancel":
      await cmdRegistryCall("cancel", "cancel", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "expire":
      await cmdRegistryCall("expire", "expire", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "open-dispute":
      await cmdOpenDispute(flags);
      break;
    case "mark-delivered":
      await cmdRegistryCall("mark-delivered", "markDelivered", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "release":
      await cmdRegistryCall("release", "release", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
        BigInt(flags.amount ?? fail("--amount required")),
      ]);
      break;
    case "assign-arbitrator":
      cmdArbitration("assign-arbitrator", "assignArbitrator", [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "submit-evidence":
      cmdArbitration("submit-evidence", "submitEvidence", [
        BigInt(flags.task_id ?? fail("--task-id required")),
        ethers.hexlify(encodeDisputeEvidence(flags.evidence ?? flags.evidence_hash ?? fail("--evidence required"))),
      ]);
      break;
    case "begin-ruling":
      cmdArbitration("begin-ruling", "beginRuling", [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "rule-dispute":
      cmdArbitration("rule-dispute", "rule", [
        BigInt(flags.task_id ?? fail("--task-id required")),
        Number(flags.outcome ?? fail("--outcome required (1-4)")),
        Number(flags.worker_bps ?? fail("--worker-bps required (0-10000)")),
      ]);
      break;
    case "timeout-dispute":
      cmdArbitration("timeout-dispute", "timeout", [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    default:
      fail(`Unknown action: ${action}\n\n${usage()}`);
  }
}

main().catch((err) => {
  output({ ok: false, error: err.message ?? String(err) });
  process.exit(1);
});
