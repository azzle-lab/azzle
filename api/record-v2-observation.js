const fs = require("node:fs");
const path = require("node:path");
const {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(root, "contracts/deployments/base-8453.json"), "utf8")
);

const OBSERVER_ABI = [
  {
    type: "function",
    name: "record",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "observationCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "latestObservation",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "timestamp", type: "uint64" },
      { name: "tick", type: "int24" },
      { name: "tickCumulative", type: "int56" },
    ],
  },
];

function json(res, status, body) {
  res.status(status).json(body);
}

function authorized(req) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const authorization = req.headers.authorization;
  return authorization === `Bearer ${secret}`;
}

function normalizePrivateKey(value) {
  const key = value.trim().replace(/^['"]|['"]$/g, "");
  const hex = key.startsWith("0x") ? key.slice(2) : key;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("OBSERVER_KEY must be a 32-byte hex private key");
  }
  return `0x${hex}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { error: "method_not_allowed" });
  }
  if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

  const rpcUrl = process.env.BASE_RPC_URL?.trim();
  const privateKey = process.env.OBSERVER_KEY?.trim();
  const observer = manifest.observationOracle;

  if (manifest.chainId !== "8453" || !isAddress(observer)) {
    return json(res, 500, { error: "invalid_observation_oracle_manifest" });
  }
  if (!rpcUrl || !privateKey) {
    return json(res, 500, { error: "BASE_RPC_URL and OBSERVER_KEY are required" });
  }

  try {
    const account = privateKeyToAccount(normalizePrivateKey(privateKey));
    const chain = { ...base, id: 8453 };
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const hash = await walletClient.writeContract({
      address: observer,
      abi: OBSERVER_ABI,
      functionName: "record",
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const [count, latest] = await Promise.all([
      publicClient.readContract({
        address: observer,
        abi: OBSERVER_ABI,
        functionName: "observationCount",
      }),
      publicClient.readContract({
        address: observer,
        abi: OBSERVER_ABI,
        functionName: "latestObservation",
      }),
    ]);

    return json(res, 200, {
      ok: receipt.status === "success",
      observer,
      recorder: account.address,
      transactionHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      observationCount: count.toString(),
      latestObservation: {
        timestamp: latest[0].toString(),
        tick: latest[1].toString(),
        tickCumulative: latest[2].toString(),
      },
    });
  } catch (error) {
    console.error("V2 observation checkpoint failed:", error);
    return json(res, 502, {
      error: error?.shortMessage ?? error?.message ?? String(error),
      observer,
    });
  }
}
