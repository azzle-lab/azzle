import { ethers } from "ethers";
import {
  AzzleV2Client,
  loadMarketManifest,
  parseTaskRef,
} from "@azzle/agents";

const ERC20_ABI = ["function approve(address spender,uint256 amount) returns (bool)"];

function fail(message) {
  throw new Error(`AZZLE Muse executor: ${message}`);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredOption(args, name) {
  const value = option(args, name);
  if (!value) fail(`missing ${name}`);
  return value;
}

function positiveWei(value, label) {
  if (!/^[1-9]\d*$/.test(value)) fail(`${label} must be a positive AZL-wei integer`);
  return BigInt(value);
}

function requireWriteAuthority() {
  if (process.env.MUSE_AZZLE_AUTONOMY !== "true") {
    fail("writes require MUSE_AZZLE_AUTONOMY=true");
  }
  const max = positiveWei(requiredEnv("MUSE_AZZLE_MAX_WRITE_AZL_WEI"), "MUSE_AZZLE_MAX_WRITE_AZL_WEI");
  return max;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`missing Muse secret ${name}`);
  return value;
}

function selectedMarket(args, taskId) {
  if (taskId) return parseTaskRef(taskId).market;
  const market = requiredOption(args, "--market");
  if (market !== "standard" && market !== "micro") fail("--market must be standard or micro");
  return market;
}

async function receipt(tx, label) {
  const mined = await tx.wait();
  if (!mined || mined.status !== 1) fail(`${label} transaction did not succeed`);
  return mined.hash;
}

async function write(client, signer, manifest, operation, taskId, amount) {
  const task = await client.getTask(taskId);
  const ownAddress = (await signer.getAddress()).toLowerCase();
  const readiness = await client.getReadiness(taskId, {
    actor: ownAddress,
    worker: ownAddress,
  });
  const permitted = {
    claim: readiness.canClaim,
    fund: readiness.canFund,
    "mark-delivered": readiness.canDeliver,
    release: readiness.canRelease,
    complete: readiness.canComplete,
  }[operation];
  if (!permitted) fail(`${operation} is not ready: ${readiness.reasons.join("; ") || readiness.state}`);

  if (operation === "fund") {
    if (task.poster.toLowerCase() !== ownAddress) fail("only the task poster may fund");
    const azl = new ethers.Contract(manifest.tokens.azl, ERC20_ABI, signer);
    const approvalHash = await receipt(
      await azl.approve(manifest.escrowVault, amount),
      "exact AZL escrow approval",
    );
    const fundingHash = await receipt(client.fund(taskId, amount), "fund");
    return { approvalHash, transactionHash: fundingHash };
  }

  if (["release", "complete"].includes(operation) && task.poster.toLowerCase() !== ownAddress) {
    fail(`only the task poster may ${operation}`);
  }
  const tx = operation === "claim"
    ? await client.claim(taskId)
    : operation === "mark-delivered"
      ? await client.markDelivered(taskId)
      : operation === "release"
        ? await client.release(taskId, amount)
        : await client.complete(taskId);
  return { transactionHash: await receipt(tx, operation) };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command) fail("command required");
  const taskId = option(args, "--task-id");
  const market = selectedMarket(args, taskId);
  const provider = new ethers.JsonRpcProvider(requiredEnv("BASE_RPC_URL"));
  const network = await provider.getNetwork();
  if (network.chainId !== 8453n) fail(`BASE_RPC_URL returned chain ${network.chainId}, expected 8453`);
  const manifest = loadMarketManifest(market);
  const signer = new ethers.Wallet(requiredEnv("MUSE_AZZLE_PRIVATE_KEY"), provider);
  const client = new AzzleV2Client(manifest, requiredEnv("BASE_RPC_URL"), market).connect(signer);

  if (command === "status") {
    if (!taskId) fail("status requires --task-id");
    console.log(JSON.stringify({ taskId, task: await client.getTask(taskId) }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
    return;
  }

  const max = requireWriteAuthority();
  if (command === "post") {
    const amount = positiveWei(requiredOption(args, "--amount-azl-wei"), "--amount-azl-wei");
    if (amount > max) fail("post amount exceeds MUSE_AZZLE_MAX_WRITE_AZL_WEI");
    const deadline = Number(requiredOption(args, "--deadline"));
    if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1000)) fail("--deadline must be a future Unix timestamp");
    const result = await client.post(amount, deadline);
    if (result.receipt.status !== 1) fail("post transaction did not succeed");
    console.log(JSON.stringify({ operation: "post", taskId: result.taskId, transactionHash: result.receipt.hash }, null, 2));
    return;
  }

  if (!taskId) fail(`${command} requires --task-id`);
  if (!["claim", "fund", "mark-delivered", "release", "complete"].includes(command)) {
    fail(`unsupported command ${command}`);
  }
  const amount = ["fund", "release"].includes(command)
    ? positiveWei(requiredOption(args, "--amount-azl-wei"), "--amount-azl-wei")
    : 0n;
  if (amount > max) fail(`${command} amount exceeds MUSE_AZZLE_MAX_WRITE_AZL_WEI`);
  const result = await write(client, signer, manifest, command, taskId, amount);
  const postcondition = await client.getTask(taskId);
  console.log(JSON.stringify({
    operation: command,
    taskId,
    ...result,
    postcondition: {
      state: postcondition.stateName,
      fundedAzlWei: postcondition.funded.toString(),
      releasedAzlWei: postcondition.released.toString(),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
