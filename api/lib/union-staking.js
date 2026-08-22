import { createPublicClient, http, toCoinType } from "viem";
import { base, mainnet } from "viem/chains";
import { isMarketLive, loadMarketManifest, normalizeMarket } from "./markets.js";

const ABI = [
  { type: "function", name: "stakingActive", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "totalStaked", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalCreditsIssued", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalCreditsSpent", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditsRemaining", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditIssuanceClosed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "rewardFinish", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stakeOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditsOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "accrued", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingPayouts", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "accRewardPerShare", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardRate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardFinish", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastUpdate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardDebt", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

const EVENTS = [
  { type: "event", name: "Staked", anonymous: false, inputs: [
    { indexed: true, name: "account", type: "address" }, { indexed: false, name: "amount", type: "uint256" },
  ]},
  { type: "event", name: "Unstaked", anonymous: false, inputs: [
    { indexed: true, name: "account", type: "address" }, { indexed: true, name: "recipient", type: "address" }, { indexed: false, name: "amount", type: "uint256" },
  ]},
  { type: "event", name: "RewardClaimed", anonymous: false, inputs: [
    { indexed: true, name: "account", type: "address" }, { indexed: true, name: "recipient", type: "address" }, { indexed: false, name: "amount", type: "uint256" },
  ]},
];

const leaderboardCache = new Map();
const leaderboardRefresh = new Map();

async function discoverUnionActivity(client, latestBlock, manifest) {
  const explorerUrl = new URL(`/api/v2/addresses/${manifest.stakingVault}/logs`, "https://base.blockscout.com");
  try {
    const accounts = new Map();
    const claimedByAccount = new Map();
    let nextPage = null;
    do {
      const pageUrl = new URL(explorerUrl);
      for (const [key, value] of Object.entries(nextPage ?? {})) pageUrl.searchParams.set(key, String(value));
      const response = await fetch(pageUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Blockscout returned ${response.status}`);
      const data = await response.json();
      for (const log of data.items ?? []) {
        const method = log.decoded?.method_call ?? "";
        if (!method.startsWith("Staked(") && !method.startsWith("RewardClaimed(")) continue;
        const parameters = log.decoded?.parameters ?? [];
        const account = parameters.find((parameter) => (
          parameter.indexed && (parameter.name === "account" || parameter.name === "user")
        ))?.value;
        if (!account) continue;
        const key = account.toLowerCase();
        accounts.set(key, account);
        if (method.startsWith("RewardClaimed(")) {
          const amount = parameters.find((parameter) => (
            !parameter.indexed && (parameter.name === "amount" || parameter.name === "claimed")
          ))?.value;
          if (amount != null) claimedByAccount.set(key, (claimedByAccount.get(key) ?? 0n) + BigInt(amount));
        }
      }
      nextPage = data.next_page_params;
    } while (nextPage);
    if (accounts.size) return { accounts: [...accounts.values()], claimedByAccount };
  } catch {}

  const firstBlock = BigInt(manifest.deploymentBlock);
  const chunkSize = 9_000n;
  const accounts = new Map();
  const claimedByAccount = new Map();
  for (let fromBlock = firstBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
    const toBlock = fromBlock + chunkSize - 1n > latestBlock ? latestBlock : fromBlock + chunkSize - 1n;
    for (const event of [EVENTS[0], EVENTS[2]]) {
      const logs = await client.getLogs({
        address: manifest.stakingVault,
        event,
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        const account = log.args.account;
        if (!account) continue;
        const key = account.toLowerCase();
        accounts.set(key, account);
        if (event.name === "RewardClaimed") {
          claimedByAccount.set(key, (claimedByAccount.get(key) ?? 0n) + BigInt(log.args.amount ?? 0n));
        }
      }
    }
  }
  return { accounts: [...accounts.values()], claimedByAccount };
}

export async function getUnionOverview(market = "standard") {
  const selected = normalizeMarket(market);
  const manifest = loadMarketManifest(selected);
  if (!isMarketLive(manifest)) {
    return { market: selected, live: false, stakingActive: false };
  }
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });
  const results = await client.multicall({
    contracts: [
      "stakingActive",
      "totalStaked",
      "totalCreditsIssued",
      "totalCreditsSpent",
      "creditsRemaining",
      "creditIssuanceClosed",
      "rewardFinish",
    ].map((functionName) => ({ address: manifest.stakingVault, abi: ABI, functionName })),
  });
  const value = (index) => results[index].result;
  return {
    market: selected, live: true,
    source: "base-rpc", updatedAt: Math.floor(Date.now() / 1000),
    stakingActive: value(0), totalStakedAzl: value(1).toString(),
    totalCreditsIssued: value(2).toString(), totalCreditsSpent: value(3).toString(),
    creditsRemaining: value(4).toString(), creditIssuanceClosed: value(5),
    rewardPeriodFinish: Number(value(6)),
  };
}

export async function getUnionLeaderboard(market = "standard") {
  const selected = normalizeMarket(market);
  const cached = leaderboardCache.get(selected);
  if (cached && Date.now() < cached.expires) return cached.value;
  if (leaderboardRefresh.has(selected)) return leaderboardRefresh.get(selected);
  const pending = buildUnionLeaderboard(selected);
  leaderboardRefresh.set(selected, pending);
  try {
    return await pending;
  } catch (error) {
    if (cached) return { ...cached.value, stale: true };
    throw error;
  } finally {
    leaderboardRefresh.delete(selected);
  }
}

async function buildUnionLeaderboard(market = "standard") {
  const manifest = loadMarketManifest(normalizeMarket(market));
  if (!isMarketLive(manifest)) return { market: normalizeMarket(market), live: false, source: "base-rpc", updatedAt: Math.floor(Date.now() / 1000), participants: 0, rows: [] };
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });
  const latestBlock = await client.getBlockNumber();
  const snapshotBlock = await client.getBlock({ blockNumber: latestBlock });
  const { accounts, claimedByAccount } = await discoverUnionActivity(client, latestBlock, manifest);
  if (!accounts.length) return { market: normalizeMarket(market), live: true, source: "base-rpc", updatedAt: Math.floor(Date.now() / 1000), participants: 0, rows: [] };
  const reads = await client.multicall({
    allowFailure: false,
    blockNumber: latestBlock,
    contracts: accounts.flatMap((account) => [
      { address: manifest.stakingVault, abi: ABI, functionName: "stakeOf", args: [account] },
      { address: manifest.stakingVault, abi: ABI, functionName: "creditsOf", args: [account] },
      { address: manifest.stakingVault, abi: ABI, functionName: "accrued", args: [account] },
      { address: manifest.stakingVault, abi: ABI, functionName: "pendingPayouts", args: [account] },
      { address: manifest.stakingVault, abi: ABI, functionName: "rewardDebt", args: [account] },
    ]),
  });
  const networkReads = await client.multicall({
    allowFailure: false,
    blockNumber: latestBlock,
    contracts: [
      { address: manifest.stakingVault, abi: ABI, functionName: "accRewardPerShare" },
      { address: manifest.stakingVault, abi: ABI, functionName: "rewardRate" },
      { address: manifest.stakingVault, abi: ABI, functionName: "rewardFinish" },
      { address: manifest.stakingVault, abi: ABI, functionName: "lastUpdate" },
      { address: manifest.stakingVault, abi: ABI, functionName: "totalStaked" },
    ],
  });
  const ACC = 10n ** 27n;
  const now = snapshotBlock.timestamp;
  const acc = BigInt(networkReads[0] ?? 0n);
  const rate = BigInt(networkReads[1] ?? 0n);
  const finish = BigInt(networkReads[2] ?? 0n);
  const last = BigInt(networkReads[3] ?? 0n);
  const total = BigInt(networkReads[4] ?? 0n);
  const until = now < finish ? now : finish;
  const emission = until > last ? (until - last) * rate : 0n;
  const projectedAcc = total > 0n ? acc + (emission * ACC) / total : acc;
  const rows = await Promise.all(accounts.map(async (account, index) => {
    let name = null;
    try {
      const ensClient = createPublicClient({ chain: mainnet, transport: http(process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com") });
      name = await ensClient.getEnsName({ address: account, coinType: toCoinType(base.id) });
    } catch {}
    return {
      account,
      name,
      stakedAzl: String(reads[index * 5] ?? 0n),
      credits: String(reads[index * 5 + 1] ?? 0n),
      claimableAzl: String(
        BigInt(reads[index * 5 + 2] ?? 0n)
        + (BigInt(reads[index * 5] ?? 0n) * projectedAcc) / ACC
        - BigInt(reads[index * 5 + 4] ?? 0n),
      ),
      accruedAzl: String(reads[index * 5 + 2] ?? 0n),
      rewardDebt: String(reads[index * 5 + 4] ?? 0n),
      pendingPayoutAzl: String(reads[index * 5 + 3] ?? 0n),
      claimedAzl: String(claimedByAccount.get(account.toLowerCase()) ?? 0n),
    };
  })).then((result) => result.filter((row) => (
    BigInt(row.stakedAzl) > 0n
    || BigInt(row.credits) > 0n
    || BigInt(row.claimableAzl) > 0n
    || BigInt(row.pendingPayoutAzl) > 0n
  )));
  const payload = {
    market: normalizeMarket(market),
    live: true,
    source: "base-rpc",
    updatedAt: Math.floor(Date.now() / 1000),
    participants: rows.length,
    snapshotBlock: String(latestBlock),
    rows,
  };
  leaderboardCache.set(normalizeMarket(market), { value: payload, expires: Date.now() + 5 * 60_000 });
  return payload;
}
