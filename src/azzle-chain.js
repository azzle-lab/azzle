import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  http,
  keccak256,
  numberToHex,
  parseEventLogs,
  parseUnits,
  stringToBytes,
  stringToHex,
  zeroAddress,
  fallback,
} from "viem";
import { toAccount } from "viem/accounts";
import { base } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createSmartAccountClient } from "permissionless";
import { to7702KernelSmartAccount } from "permissionless/accounts";
import { encodeCallDataEpV07 } from "@zerodev/sdk";
import { sendDeliveryNotice } from "./xmtp-browser.js";

const AZL_PER_ACTION = 1000n * 10n ** 18n;
const MIN_ETH_WEI = 50_000_000_000_000n; // ~0.00005 ETH for gas buffer
const HOP_CALLTYPE_DELEGATECALL = "0xff";
const ENTRY_POINT_V07 = {
  address: entryPoint07Address,
  version: "0.7",
};
const EIP7702_KERNEL_IMPLEMENTATION = "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28";

function formatAzlHuman(amount) {
  const n = typeof amount === "bigint" ? Number(formatUnits(amount, 18)) : Number(amount);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B AZL";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M AZL";
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " AZL";
}

function formatTxError(err) {
  const msg = err?.shortMessage || err?.details || err?.message || String(err);
  const lower = msg.toLowerCase();
  if (
    err?.name === "UserRejectedRequestError" ||
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request")
  ) {
    return "Transaction cancelled — nothing was charged.";
  }
  if (lower.includes("ad v2: collateral") || lower.includes("below min+fee")) {
    return "Not enough AZL collateral for this V2 action. Fund your protocol collateral first.";
  }
  if (lower.includes("exceeds balance") || lower.includes("erc20: transfer amount")) {
    return "Not enough collateral in your wallet. You need AZL on Base (plus a little ETH for gas).";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough ETH on Base for gas — add a small amount of ETH, then try again.";
  }
  if (
    lower.includes("azzlgateway: oracle") ||
    lower.includes("oracle: invalid") ||
    lower.includes("oracle is not valid")
  ) {
    return "AZL oracle is not ready yet. Deposits are temporarily paused while the Base price feed warms up.";
  }
  if (lower.includes("rate limit") || lower.includes("over rate limit") || lower.includes("429")) {
    return "Base RPC is rate-limited — retrying with a backup RPC. Please try again in a few seconds.";
  }
  if (lower.includes("trv2: cancel")) {
    return "Cancel is only available on unfunded POSTED or CLAIMED tasks.";
  }
  if (lower.includes("trv2: delivery grace")) {
    return "The agent delivered on time — wait for the one-day grace window before expiring.";
  }
  if (lower.includes("trv2: expire")) {
    return "Expire is only available after the deadline or funding window, and not while disputed.";
  }
  if (lower.includes("execution reverted") || lower.includes("revert")) {
    return "Transaction failed onchain — check the selected market's AZL requirements and keep ETH for gas on Base.";
  }
  return msg.length > 140 ? msg.slice(0, 140) + "…" : msg;
}

function parseTaskRef(taskId) {
  const value = String(taskId ?? "").trim();
  const namespaced = value.match(/^v2:(standard|micro):([1-9]\d*)$/i);
  if (namespaced) {
    return { market: namespaced[1].toLowerCase(), localId: namespaced[2] };
  }
  if (/^v2:\d+$/i.test(value)) {
    throw new Error("Unscoped task id v2:N is illegal. Use v2:standard:N or v2:micro:N.");
  }
  if (/^\d+$/.test(value)) {
    throw new Error("Bare numeric task ids are illegal. Use v2:standard:N or v2:micro:N.");
  }
  throw new Error("Invalid task id");
}

function parseRegistryTaskId(taskId) {
  return BigInt(parseTaskRef(taskId).localId);
}

async function loadConfigForTask(taskId) {
  return loadSiteConfig(parseTaskRef(taskId).market);
}

function parseEthAddress(addr) {
  if (!addr || typeof addr !== "string") throw new Error("Recipient address required");
  const a = addr.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) throw new Error("Invalid address — use a Base 0x… address");
  return a;
}

function requireConfiguredAddress(name, value) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${name} is not configured. Refresh the wallet page or contact support.`);
  }
  return value;
}

function requireBalanceConfig(c, address) {
  requireConfiguredAddress("connected wallet", address);
  requireConfiguredAddress("USDC token", c?.usdc);
  requireConfiguredAddress("AZL token", c?.azlToken);
  requireConfiguredAddress("deposit vault", c?.depositVault);
  requireConfiguredAddress("payment gateway", c?.paymentGateway);
}

async function ensureUsdcAllowance(walletClient, publicClient, usdc, owner, spender, needed) {
  const allowance = await publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance >= needed) return;
  const hash = await walletClient.writeContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, needed],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function runTx(label, fn, onProgress) {
  try {
    return await fn();
  } catch (err) {
    throw new Error(formatTxError(err));
  }
}

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
];

const ORACLE_ABI = [
  {
    type: "function",
    name: "isValid",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "quoteUsdForAzl",
    stateMutability: "view",
    inputs: [{ name: "azlAmount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteUsdForAzlPar",
    stateMutability: "view",
    inputs: [{ name: "azlAmount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteAzlForUsd",
    stateMutability: "view",
    inputs: [{ name: "usdAmount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
];

const VAULT_ABI = [
  {
    type: "function",
    name: "deposits",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawable",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }, { name: "recipient", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "latchedEntryFloor",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "taskQuotes",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "entryDeposit", type: "uint256" },
        { name: "liveTaskReserve", type: "uint256" },
        { name: "accessFee", type: "uint256" },
        { name: "exitCompensation", type: "uint256" },
        { name: "exitProtocolShare", type: "uint256" },
      ],
    }],
  },
];

const PAYMENT_GATEWAY_ABI = [
  {
    type: "function",
    name: "fundWithUsdc",
    stateMutability: "nonpayable",
    inputs: [
      { name: "exactUsdcIn", type: "uint256" },
      { name: "minAzlOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "fundWithEth",
    stateMutability: "payable",
    inputs: [
      { name: "minAzlOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

const AZL_HOP_ABI = [
  {
    type: "function",
    name: "depositUsingAzl",
    stateMutability: "nonpayable",
    inputs: [
      { name: "exactAzlIn", type: "uint256" },
      { name: "minWethOut", type: "uint256" },
      { name: "minAzlOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

const PRICING_POLICY_ABI = [
  {
    type: "function",
    name: "quoteTask",
    stateMutability: "view",
    inputs: [],
    outputs: [{
      type: "tuple",
      components: [
        { name: "entryDeposit", type: "uint256" },
        { name: "liveTaskReserve", type: "uint256" },
        { name: "accessFee", type: "uint256" },
        { name: "exitCompensation", type: "uint256" },
        { name: "exitProtocolShare", type: "uint256" },
      ],
    }],
  },
];

const REGISTRY_CAP_ABI = [
  {
    type: "function",
    name: "openTaskCapUsd6",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

const STAKING_ABI = [
  { type: "function", name: "stakingActive", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "stakeOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditsOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditsRemaining", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "accrued", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalStaked", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "accRewardPerShare", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardRate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardFinish", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastUpdate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardDebt", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingPayouts", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "unstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [] },
  { type: "function", name: "bankCredits", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [] },
];

const REGISTRY_ABI = [
  {
    type: "function",
    name: "taskCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "post",
    stateMutability: "nonpayable",
    inputs: [
      { name: "totalAmount", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "markDelivered",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "activate",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "complete",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "expire",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "openDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tasks",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        name: "",
        components: [
          { name: "poster", type: "address" },
          { name: "worker", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "funded", type: "uint256" },
          { name: "released", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "fundingDeadline", type: "uint64" },
          { name: "deliveredAt", type: "uint64" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "TaskPosted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "poster", type: "address", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "amountUsd6", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
    ],
  },
];

const ESCROW_ABI = [
  {
    type: "function",
    name: "escrows",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "poster", type: "address" },
        { name: "worker", type: "address" },
        { name: "deposited", type: "uint256" },
        { name: "released", type: "uint256" },
        { name: "state", type: "uint8" },
      ],
    }],
  },
];

const SCOPE_REGISTRY_ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "scope", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "scopeOf",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "MAX_SCOPE_BYTES",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

const TASK_STATE = [
  "NONE",
  "POSTED",
  "CLAIMED",
  "ACTIVE",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
  "RESOLVED",
];

let siteConfigByMarket = {};

function normalizeSiteConfig(config) {
  const rawContracts = config?.contracts ?? {};
  const external = rawContracts.external ?? config?.external ?? {};
  const contracts = {
    ...rawContracts,
    usdc: rawContracts.usdc ?? rawContracts.USDC ?? external.usdc,
    azlToken: rawContracts.azlToken ?? rawContracts.azl ?? external.azl,
    depositVault: rawContracts.depositVault ?? rawContracts.agentDepositVault,
    paymentGateway: rawContracts.paymentGateway ?? rawContracts.azlPaymentGateway,
  };
  return { ...config, contracts };
}

function selectedMarket() {
  if (typeof window !== "undefined" && window.AZZLE_MARKETS?.getSelectedMarket) {
    return window.AZZLE_MARKETS.getSelectedMarket();
  }
  return "standard";
}

function resolveMarket(market) {
  if (market === "micro" || market === "standard") return market;
  return selectedMarket();
}

function postingFloorUsd6(config, market) {
  const raw = config?.economics?.postingFloorUsd6;
  if (raw != null) return BigInt(raw);
  return resolveMarket(market) === "micro" ? 5_000_000n : 45_000_000n;
}

function emptyVaultPosition(market) {
  return {
    market,
    configured: false,
    usdcVault: "0",
    usdcVaultUsd: "0",
    usdcVaultMarketUsd: "0",
    usdcVaultMeetsMinimum: false,
    usdcVaultAllowance: "0",
    needsUsdcApprove: true,
    maxVaultWithdraw: "0",
  };
}

async function readVaultPosition(market, address) {
  try {
    const cfg = await loadSiteConfig(market);
    const c = cfg.contracts;
    if (!c?.depositVault || !c?.paymentGateway || !c?.usdc) return emptyVaultPosition(market);
    requireConfiguredAddress("deposit vault", c.depositVault);
    const publicClient = getPublicClient(cfg);
    const results = await Promise.allSettled([
      publicClient.readContract({
        address: c.depositVault,
        abi: VAULT_ABI,
        functionName: "deposits",
        args: [address],
      }),
      publicClient.readContract({
        address: c.depositVault,
        abi: VAULT_ABI,
        functionName: "withdrawable",
        args: [address],
      }),
      publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, c.paymentGateway],
      }),
    ]);
    const valueOf = (result) => (result.status === "fulfilled" ? result.value : null);
    const vaultAmt = valueOf(results[0]) ?? 0n;
    const maxWithdrawAmt = valueOf(results[1]) ?? 0n;
    const usdcAllowance = valueOf(results[2]) ?? 0n;
    let vaultUsd = 0n;
    let vaultMarketUsd = 0n;
    try {
      [vaultUsd, vaultMarketUsd] = await Promise.all([
        publicClient.readContract({
          address: c.usdOracle,
          abi: ORACLE_ABI,
          functionName: "quoteUsdForAzl",
          args: [vaultAmt],
        }),
        publicClient.readContract({
          address: c.usdOracle,
          abi: ORACLE_ABI,
          functionName: "quoteUsdForAzlPar",
          args: [vaultAmt],
        }),
      ]);
    } catch {
      /* Preserve balance rendering if the oracle is temporarily unavailable. */
    }
    return {
      market,
      configured: true,
      usdcVault: formatUnits(vaultAmt, 18),
      usdcVaultUsd: formatUnits(vaultUsd ?? 0n, 6),
      usdcVaultMarketUsd: formatUnits(vaultMarketUsd ?? 0n, 6),
      usdcVaultMeetsMinimum: (vaultUsd ?? 0n) >= postingFloorUsd6(cfg, market),
      usdcVaultAllowance: formatUnits(usdcAllowance, 6),
      needsUsdcApprove: usdcAllowance === 0n,
      maxVaultWithdraw: formatUnits(maxWithdrawAmt, 18),
    };
  } catch {
    return emptyVaultPosition(market);
  }
}

export async function loadSiteConfig(marketOverride) {
  const market = resolveMarket(marketOverride);
  if (siteConfigByMarket[market]) return siteConfigByMarket[market];
  const res = await fetch(`/api/site-config?market=${encodeURIComponent(market)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load site config");
  const loaded = normalizeSiteConfig(await res.json());
  siteConfigByMarket[market] = loaded;
  return loaded;
}

function scopeHash(description) {
  return keccak256(stringToBytes(description.trim()));
}

function canonicalizeReceipt(receipt) {
  return JSON.stringify(receipt, Object.keys(receipt).sort());
}

async function readOnchainScope(publicClient, scopeRegistry, taskId) {
  if (!scopeRegistry) return null;
  try {
    const scope = await publicClient.readContract({
      address: scopeRegistry,
      abi: SCOPE_REGISTRY_ABI,
      functionName: "scopeOf",
      args: [parseRegistryTaskId(taskId)],
    });
    const text = String(scope ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}

async function writeSetScope(walletClient, publicClient, scopeRegistry, taskId, scope, onProgress) {
  onProgress?.("Publishing scope onchain…");
  const receipt = await runTx("publishScope", async () => {
    const hash = await walletClient.writeContract({
      address: scopeRegistry,
      abi: SCOPE_REGISTRY_ABI,
      functionName: "publish",
      args: [parseRegistryTaskId(taskId), scope.trim()],
    });
    return publicClient.waitForTransactionReceipt({ hash });
  }, onProgress);
  return receipt;
}

/** Batch scope publication immediately after post when wallet supports wallet_sendCalls. */
async function tryPostWithOpenScopeBatch(wallet, walletClient, publicClient, cfg, postArgs, scope, onProgress) {
  const c = cfg.contracts;
  if (!c.taskScopeRegistry) return null;

  const taskCount = await publicClient.readContract({
    address: c.taskRegistry,
    abi: REGISTRY_ABI,
    functionName: "taskCount",
  });
  const nextTaskId = taskCount + 1n;

  const postData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "post",
    args: postArgs,
  });
  const scopeData = encodeFunctionData({
    abi: SCOPE_REGISTRY_ABI,
    functionName: "publish",
    args: [nextTaskId, scope.trim()],
  });

  const provider = await wallet.getEthereumProvider();
  const chainId = numberToHex(cfg.chainId ?? base.id);
  const from = wallet.address;

  try {
    onProgress?.("Posting task + publishing scope (batched)…");
    const result = await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          chainId,
          from,
          calls: [
            { to: c.taskRegistry, data: postData, value: "0x0" },
            { to: c.taskScopeRegistry, data: scopeData, value: "0x0" },
          ],
        },
      ],
    });

    const batchId = typeof result === "string" ? result : result?.id;
    if (!batchId) return null;

    let status = null;
    for (let i = 0; i < 40; i++) {
      status = await provider.request({
        method: "wallet_getCallsStatus",
        params: [batchId],
      });
      if (status?.status === 200 || status?.status === "CONFIRMED") break;
      if (status?.status === 500 || status?.status === "FAILED") {
        throw new Error("Batched post failed onchain");
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    const receipts = status?.receipts ?? [];
    const txHash = receipts[0]?.transactionHash ?? status?.transactionHash ?? null;
    return { taskId: nextTaskId.toString(), hash: txHash, scopePublished: true, batched: true };
  } catch {
    return null;
  }
}

async function tryFundWithUsdcBatch(wallet, publicClient, cfg, address, amount, onProgress) {
  const c = cfg.contracts;
  requireConfiguredAddress("USDC token", c?.usdc);
  requireConfiguredAddress("payment gateway", c?.paymentGateway);
  requireConfiguredAddress("connected wallet", address);
  const provider = await wallet.getEthereumProvider();
  const chainId = numberToHex(cfg.chainId ?? base.id);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const approveData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [c.paymentGateway, amount],
  });
  const fundData = encodeFunctionData({
    abi: PAYMENT_GATEWAY_ABI,
    functionName: "fundWithUsdc",
    args: [amount, 1n, deadline],
  });

  try {
    onProgress?.("Approving USDC + funding collateral (batched)…");
    const result = await provider.request({
      method: "wallet_sendCalls",
      params: [{
        version: "2.0.0",
        chainId,
        from: address,
        atomicRequired: true,
        calls: [
          { to: c.usdc, data: approveData, value: "0x0" },
          { to: c.paymentGateway, data: fundData, value: "0x0" },
        ],
      }],
    });
    const batchId = typeof result === "string" ? result : result?.id;
    if (!batchId) return null;

    let status = null;
    for (let i = 0; i < 40; i++) {
      status = await provider.request({ method: "wallet_getCallsStatus", params: [batchId] });
      if (status?.status === 200 || status?.status === "CONFIRMED") break;
      if (status?.status === 500 || status?.status === "FAILED") {
        throw new Error("Batched USDC deposit failed onchain");
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const txHash = status?.receipts?.[0]?.transactionHash ?? status?.transactionHash ?? null;
    return txHash ? { hash: txHash, batched: true } : null;
  } catch (error) {
    // A rejected wallet_sendCalls request is expected for wallets without
    // batching support; preserve the error for diagnostics if the sequential
    // fallback also fails.
    return { unsupported: true, error };
  }
}

async function getWalletClient(wallet, cfg) {
  requireConfiguredAddress("connected wallet", wallet?.address);
  const provider = await wallet.getEthereumProvider();
  const chain = { ...base, id: cfg.chainId ?? base.id };
  try {
    await wallet.switchChain?.(chain.id);
  } catch {
    /* wallet may already be on Base */
  }
  return createWalletClient({
    // ZeroDev's EIP-7702 adapter reads signer.account.address. Passing only
    // the address string leaves viem's account as a string and yields
    // `undefined` during Kernel account construction.
    account: { address: wallet.address, type: "json-rpc" },
    chain,
    transport: custom(provider),
  });
}

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

async function fundAzlThroughHop(
  wallet,
  publicClient,
  cfg,
  address,
  amount,
  onProgress,
  signAuthorization
) {
  const hop = requireConfiguredAddress("AZL hop contract", cfg.contracts?.azlHop);
  const bundlerUrl = cfg.contracts?.pimlicoBundlerUrl?.trim();
  if (!bundlerUrl) throw new Error("Pimlico bundler is not configured for atomic AZL deposits.");
  const provider = await wallet.getEthereumProvider();
  const walletClient = await getWalletClient(wallet, cfg);
  const signer = toAccount({
    address,
    async signMessage({ message }) {
      return walletClient.signMessage({ account: walletClient.account, message });
    },
    async signTypedData(typedData) {
      return walletClient.signTypedData({
        account: walletClient.account,
        ...typedData,
      });
    },
    async signAuthorization(authorization) {
      if (eip7702Auth) return eip7702Auth;
      return walletClient.signAuthorization({
        account: walletClient.account,
        ...authorization,
      });
    },
  });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const data = encodeFunctionData({
    abi: AZL_HOP_ABI,
    functionName: "depositUsingAzl",
    args: [amount, 1n, 1n, deadline],
  });

  if (typeof provider.request !== "function") throw new Error("Wallet provider unavailable.");

  onProgress?.("Preparing Kernel delegatecall through Pimlico…");
  const entryPoint = ENTRY_POINT_V07;
  // Reuse the rate-limited/fallback-aware client used by the rest of the
  // wallet flow. Creating a second client against mainnet.base.org here
  // bypasses the configured RPC and causes repeated 429s during setup.
  const executionClient = publicClient;
  if (typeof signAuthorization !== "function") {
    throw new Error(
      "This wallet cannot sign EIP-7702 authorizations. Refresh and reconnect the Privy wallet."
    );
  }
  if (wallet.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      "The connected wallet changed while preparing the AZL deposit. Refresh and reconnect."
    );
  }
  const implementation =
    EIP7702_KERNEL_IMPLEMENTATION;
  const code = await executionClient.getCode({ address });
  const delegatedPrefix = `0xef0100${implementation.slice(2).toLowerCase()}`;
  const eip7702Auth =
    code?.toLowerCase().startsWith(delegatedPrefix)
      ? undefined
      : await signAuthorization({
          contractAddress: implementation,
          chainId: cfg.chainId ?? base.id,
          nonce: await executionClient.getTransactionCount({ address }),
        });
  if (eip7702Auth && eip7702Auth.address.toLowerCase() !== implementation.toLowerCase()) {
    throw new Error("Privy signed the EIP-7702 authorization for the wrong Kernel implementation.");
  }
  const account = await to7702KernelSmartAccount({
    client: executionClient,
    owner: signer,
    entryPoint,
    accountLogicAddress: implementation,
  });
  const kernelAddress = await account.getAddress();
  if (!isAddress(kernelAddress) || kernelAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error("Kernel account address does not match the connected Privy wallet.");
  }

  const pimlicoClient = createPimlicoClient({
    chain: { ...base, id: cfg.chainId ?? base.id },
    transport: http(bundlerUrl),
    entryPoint,
  });
  const smartAccountClient = createSmartAccountClient({
    account,
    chain: { ...base, id: cfg.chainId ?? base.id },
    bundlerTransport: http(bundlerUrl),
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });
  const callData = await encodeCallDataEpV07(
    [{ to: hop, value: 0n, data }],
    "delegatecall",
  );
  const userOpHash = await smartAccountClient.sendUserOperation({
    account,
    callData,
    // The authorization makes the EOA executable during Pimlico's simulation.
    // Do not provide factory fields: the bundler then reports AA10 because
    // the authorization has already constructed the account context.
    ...(eip7702Auth
      ? {
          authorization: eip7702Auth,
        }
      : {}),
  });
  return { hash: userOpHash, userOperation: true, callType: HOP_CALLTYPE_DELEGATECALL };
}

function getPublicClient(cfg) {
  const configuredRpc = typeof cfg.rpcUrl === "string" ? cfg.rpcUrl.trim() : "";
  // The public Base endpoint is frequently rate-limited. Do not let a stale
  // site-config response make it the primary transport for wallet reads.
  const primary =
    configuredRpc && !configuredRpc.includes("mainnet.base.org")
      ? configuredRpc
      : "https://base-rpc.publicnode.com";
  const backup = [
    "https://mainnet.base.org",
    "https://1rpc.io/base",
  ].filter((url) => url !== primary);
  return createPublicClient({
    chain: base,
    transport: fallback(
      [http(primary), ...backup.map((url) => http(url))],
      { rank: false, retryCount: 2, retryDelay: 500 }
    ),
    pollingInterval: 4_000,
  });
}

function taskIdFromReceipt(receipt, registry) {
  const logs = parseEventLogs({
    abi: REGISTRY_ABI,
    logs: receipt.logs,
    eventName: "TaskPosted",
  });
  const hit = logs.find((l) => l.address.toLowerCase() === registry.toLowerCase());
  if (!hit) throw new Error("Task ID not found in receipt");
  return hit.args.taskId;
}

export function createPosterApi({ ready, authenticated, wallet, signAuthorization }) {
  const idle = {
    ready: false,
    address: null,
    async getStatus() {
      return { signedIn: false };
    },
    async deposit() {
      throw new Error("Sign in first");
    },
    async postV2() {
      throw new Error("Sign in first");
    },
    async fundV2() {
      throw new Error("Sign in first");
    },
    async claimV2() {
      throw new Error("Sign in first");
    },
    async markDeliveredV2() {
      throw new Error("Sign in first");
    },
    async sendDeliveryNotice() {
      throw new Error("Sign in first");
    },
    buildDeliveryReceipt() {
      throw new Error("Sign in first");
    },
  };

  if (!ready) return idle;

  const address = wallet?.address ?? null;
  if (!authenticated || !address || !wallet) {
    return { ...idle, ready: true, address: null };
  }

  return {
    ready: true,
    address,

    async getStatus() {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      if (!c?.taskRegistry) return { signedIn: true, configured: false };
      requireBalanceConfig(c, address);
      requireConfiguredAddress("pricing policy", c?.pricingPolicy);

      const publicClient = getPublicClient(cfg);
      const [usdcBal, depositBal, availableBal, azlBal, usdcAllowGateway, quote] = await Promise.all([
        publicClient.readContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: c.depositVault,
          abi: VAULT_ABI,
          functionName: "deposits",
          args: [address],
        }),
        publicClient.readContract({
          address: c.depositVault,
          abi: VAULT_ABI,
          functionName: "available",
          args: [address],
        }),
        publicClient.readContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, c.paymentGateway],
        }),
        publicClient.readContract({
          address: c.pricingPolicy,
          abi: PRICING_POLICY_ABI,
          functionName: "quoteTask",
        }),
      ]);

      const deposit = depositBal ?? 0n;
      const available = availableBal ?? 0n;
      const usdc = usdcBal ?? 0n;
      const entryDeposit = quote?.entryDeposit ?? 0n;
      const liveTaskReserve = quote?.liveTaskReserve ?? 0n;
      const accessFee = quote?.accessFee ?? 0n;
      const needsDeposit = deposit < entryDeposit;
      const needsPostTopUp = available < entryDeposit + liveTaskReserve + accessFee;
      const postCollateralShortfallAzl = needsPostTopUp
        ? entryDeposit + liveTaskReserve + accessFee - available
        : 0n;
      const needsUsdcApprove = (usdcAllowGateway ?? 0n) === 0n;
      const collateralShortfallAzl = needsDeposit ? entryDeposit - deposit : 0n;
      let collateralShortfallUsd = 0n;
      if (collateralShortfallAzl > 0n) {
        try {
          collateralShortfallUsd = await publicClient.readContract({
            address: c.usdOracle,
            abi: ORACLE_ABI,
            functionName: "quoteUsdForAzl",
            args: [collateralShortfallAzl],
          });
        } catch {
          /* Keep the AZL shortfall visible if the quote is temporarily unavailable. */
        }
      }

      return {
        signedIn: true,
        configured: true,
        usdcWallet: formatUnits(usdc, 6),
        depositAzl: formatUnits(deposit, 18),
        availableAzl: formatUnits(available, 18),
        azlWallet: formatUnits(azlBal ?? 0n, 18),
        needsDeposit,
        needsPostTopUp,
        needsUsdcApprove,
        depositReady: !needsDeposit,
        canDeposit: usdc > 0n,
        canPost:
          available >= entryDeposit + liveTaskReserve + accessFee &&
          (azlBal ?? 0n) >= AZL_PER_ACTION,
        taskFloorMin: formatUnits(liveTaskReserve, 18),
        listingFeeUsdc: formatUnits(accessFee, 18),
        accessFeeAzl: formatUnits(accessFee, 18),
        accessFeeUsd: selectedMarket() === "micro" ? "0.50 per task" : "5 per task",
        entryDepositMin: formatUnits(entryDeposit, 18),
        collateralShortfallAzl: formatUnits(collateralShortfallAzl, 18),
        collateralShortfallUsd: formatUnits(collateralShortfallUsd, 6),
        postCollateralShortfallAzl: formatUnits(postCollateralShortfallAzl, 18),
      };
    },

    async getWalletBalances() {
      const cfg = await loadSiteConfig("standard");
      const c = cfg.contracts;
      if (!c?.taskRegistry) return { signedIn: true, configured: false };
      requireBalanceConfig(c, address);

      const publicClient = getPublicClient(cfg);
      const [tokenReads, standardVault, microVault] = await Promise.all([
        Promise.allSettled([
          publicClient.getBalance({ address }),
          publicClient.readContract({
            address: c.usdc,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          publicClient.readContract({
            address: c.azlToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
        ]),
        readVaultPosition("standard", address),
        readVaultPosition("micro", address),
      ]);
      const valueOf = (result) => (result.status === "fulfilled" ? result.value : null);
      const eth = valueOf(tokenReads[0]);
      const usdc = valueOf(tokenReads[1]);
      const azl = valueOf(tokenReads[2]);
      const failedReads = tokenReads.filter((result) => result.status === "rejected");
      if (failedReads.length === tokenReads.length) {
        throw failedReads[0].reason;
      }

      return {
        signedIn: true,
        configured: true,
        address,
        eth: formatUnits(eth ?? 0n, 18),
        usdcWallet: formatUnits(usdc ?? 0n, 6),
        azlWallet: formatUnits(azl ?? 0n, 18),
        usdcVault: standardVault.usdcVault,
        usdcVaultUsd: standardVault.usdcVaultUsd,
        usdcVaultMarketUsd: standardVault.usdcVaultMarketUsd,
        usdcVaultMeetsMinimum: standardVault.usdcVaultMeetsMinimum,
        usdcVaultAllowance: standardVault.usdcVaultAllowance,
        needsUsdcApprove: standardVault.needsUsdcApprove,
        maxVaultWithdraw: standardVault.maxVaultWithdraw,
        markets: { standard: standardVault, micro: microVault },
        entryDepositMin: "oracle-priced AZL",
        taskFloorMin: "oracle-priced AZL",
        listingFeeUsdc: "oracle-priced AZL",
        depositReady: Number(standardVault.usdcVault) > 0 || Number(microVault.usdcVault) > 0,
        canPost: Number(standardVault.usdcVault) > 0,
        needsPostTopUp: false,
        partial: failedReads.length > 0,
      };
    },

    async approveUsdcGateway(amountUsdc, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountUsdc), 6);
      if (amount <= 0n) throw new Error("Enter a valid USDC amount");

      const allowance = await publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, c.paymentGateway],
      });
      if (allowance >= amount) {
        throw new Error(
          "Already approved for $" +
            formatUnits(allowance, 6) +
            " — enter a higher amount to increase allowance."
        );
      }

      const eth = await publicClient.getBalance({ address });
      if (eth < MIN_ETH_WEI) {
        throw new Error("Not enough ETH on Base for gas.");
      }

      onProgress?.("Approve $" + amountUsdc + " USDC for protocol deposit…");
      const receipt = await runTx("approveUsdc", async () => {
        const hash = await walletClient.writeContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [c.paymentGateway, amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async fundCollateral(amountUsdc, onProgress, market) {
      const cfg = await loadSiteConfig(resolveMarket(market));
      const c = cfg.contracts;
      const publicClient = getPublicClient(cfg);
      requireConfiguredAddress("USDC token", c?.usdc);
      requireConfiguredAddress("payment gateway", c?.paymentGateway);
      requireConfiguredAddress("connected wallet", address);
      const amount = parseUnits(String(amountUsdc), 6);
      if (amount <= 0n) throw new Error("Enter a valid USDC amount");

      const usdc = await publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      if (usdc < amount) {
        throw new Error(
          "Not enough USDC in wallet — you have $" + formatUnits(usdc, 6) + "."
        );
      }
      const eth = await publicClient.getBalance({ address });
      if (eth < MIN_ETH_WEI) {
        throw new Error("Not enough ETH on Base for gas.");
      }

      const oracleReady = await publicClient.readContract({
        address: requireConfiguredAddress("USD oracle", c?.usdOracle),
        abi: ORACLE_ABI,
        functionName: "isValid",
      });
      if (!oracleReady) {
        throw new Error(
          "AZL oracle is not ready yet. Deposits are temporarily paused while the Base price feed warms up."
        );
      }

      const allowance = await publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, c.paymentGateway],
      });

      if (allowance < amount) {
        const batched = await tryFundWithUsdcBatch(wallet, publicClient, cfg, address, amount, onProgress);
        if (batched && !batched.unsupported) return batched;

        const walletClient = await getWalletClient(wallet, cfg);
        onProgress?.("Wallet batching unavailable — approving USDC…");
        await ensureUsdcAllowance(walletClient, publicClient, c.usdc, address, c.paymentGateway, amount);
      }

      onProgress?.("Converting USDC to AZL collateral…");
      const walletClient = await getWalletClient(wallet, cfg);
      const receipt = await runTx("fundWithUsdc", async () => {
        const hash = await walletClient.writeContract({
          address: c.paymentGateway,
          abi: PAYMENT_GATEWAY_ABI,
          functionName: "fundWithUsdc",
          args: [amount, 1n, BigInt(Math.floor(Date.now() / 1000) + 600)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async fundWithEth(amountEth, onProgress, market) {
      const cfg = await loadSiteConfig(resolveMarket(market));
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountEth), 18);
      if (amount <= 0n) throw new Error("Enter a valid ETH amount");

      const balance = await publicClient.getBalance({ address });
      if (balance < amount + MIN_ETH_WEI) {
        throw new Error("Not enough ETH in wallet for the deposit and Base gas.");
      }

      onProgress?.("Converting ETH to AZL collateral…");
      const receipt = await runTx("fundWithEth", async () => {
        const hash = await walletClient.writeContract({
          address: c.paymentGateway,
          abi: PAYMENT_GATEWAY_ABI,
          functionName: "fundWithEth",
          args: [1n, BigInt(Math.floor(Date.now() / 1000) + 600)],
          value: amount,
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async fundWithAzl(amountAzl, onProgress) {
      const cfg = await loadSiteConfig();
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountAzl), 18);
      if (amount <= 0n) throw new Error("Enter a valid AZL amount");
      const azlBalance = await publicClient.readContract({
        address: cfg.contracts.azlToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      if (azlBalance < amount) throw new Error("Not enough AZL in wallet.");
      return fundAzlThroughHop(
        wallet,
        publicClient,
        cfg,
        address,
        amount,
        onProgress,
        signAuthorization
      );
    },

    async withdrawCollateral(amountAzl, onProgress, market) {
      const cfg = await loadSiteConfig(resolveMarket(market));
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);

      const maxW = await publicClient.readContract({
        address: c.depositVault,
        abi: VAULT_ABI,
        functionName: "withdrawable",
        args: [address],
      });
      const amount = parseUnits(String(amountAzl), 18);
      if (amount <= 0n) throw new Error("Enter a valid AZL amount");
      if (amount > maxW) {
        throw new Error(
          "Max withdrawable now is " +
            formatUnits(maxW, 18) +
            " AZL."
        );
      }

      onProgress?.("Withdrawing " + amountAzl + " AZL collateral…");
      const receipt = await runTx("withdraw", async () => {
        const hash = await walletClient.writeContract({
          address: c.depositVault,
          abi: VAULT_ABI,
          functionName: "withdraw",
          args: [amount, address],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async sendUsdc(to, amountUsdc, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const recipient = parseEthAddress(to);
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountUsdc), 6);
      if (amount <= 0n) throw new Error("Enter a valid USDC amount");

      onProgress?.("Sending $" + amountUsdc + " USDC…");
      const receipt = await runTx("sendUsdc", async () => {
        const hash = await walletClient.writeContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [recipient, amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async sendAzl(to, amountAzl, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const recipient = parseEthAddress(to);
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountAzl), 18);
      if (amount <= 0n) throw new Error("Enter a valid AZL amount");

      onProgress?.("Sending " + amountAzl + " AZL…");
      const receipt = await runTx("sendAzl", async () => {
        const hash = await walletClient.writeContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [recipient, amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async sendEth(to, amountEth, onProgress) {
      const cfg = await loadSiteConfig();
      const recipient = parseEthAddress(to);
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const value = parseUnits(String(amountEth), 18);
      if (value <= 0n) throw new Error("Enter a valid ETH amount");

      const bal = await publicClient.getBalance({ address });
      if (bal <= value) throw new Error("Not enough ETH (leave some for gas).");

      onProgress?.("Sending " + amountEth + " ETH…");
      const receipt = await runTx("sendEth", async () => {
        const hash = await walletClient.sendTransaction({ account: address, to: recipient, value });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async deposit(onProgress) {
      const market = selectedMarket();
      const floor = market === "micro" ? 5 : 45;
      return this.fundCollateral(floor, onProgress, market);
    },

    async postV2({ description, taskAmountUsd, taskAmountAzl, deadlineDays, discoveryOpen = true }, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const status = await this.getStatus();
      const openDiscovery = discoveryOpen !== false;

      if (status.needsDeposit) throw new Error("Fund AZL collateral first — /wallet");
      if (!status.canPost) {
        throw new Error(
          "Add " +
            (status.postCollateralShortfallAzl || "more") +
            " AZL collateral before posting — /wallet"
        );
      }

      const usdBudget = taskAmountUsd ?? taskAmountAzl;
      const usdAmount6 = parseUnits(String(usdBudget), 6);
      const capUsd6 = await publicClient.readContract({
        address: c.taskRegistry,
        abi: REGISTRY_CAP_ABI,
        functionName: "openTaskCapUsd6",
      });
      if (usdAmount6 > capUsd6) {
        throw new Error(
          "Task budget exceeds the protocol cap of $" +
            formatUnits(capUsd6, 6) +
            " — choose a smaller task budget."
        );
      }
      const totalAmount = await publicClient.readContract({
        address: c.usdOracle,
        abi: ORACLE_ABI,
        functionName: "quoteAzlForUsd",
        args: [usdAmount6],
      });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineDays * 86400);
      const postArgs = [totalAmount, deadline];

      if (openDiscovery && c.taskScopeRegistry) {
        const batched = await tryPostWithOpenScopeBatch(
          wallet,
          walletClient,
          publicClient,
          cfg,
          postArgs,
          description,
          onProgress
        );
        if (batched) return batched;
      }

      onProgress?.("Posting to the market…");
      const receipt = await runTx("post", async () => {
        const hash = await walletClient.writeContract({
          address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "post",
          args: postArgs,
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      const taskId = taskIdFromReceipt(receipt, c.taskRegistry);

      if (openDiscovery && c.taskScopeRegistry) {
        await writeSetScope(
          walletClient,
          publicClient,
          c.taskScopeRegistry,
          taskId,
          description,
          onProgress
        );
        return {
          taskId: taskId.toString(),
          hash: receipt.transactionHash,
          taskAmountAzl: formatUnits(totalAmount, 18),
          scopePublished: true,
          batched: false,
        };
      }

      return {
        taskId: taskId.toString(),
        hash: receipt.transactionHash,
        taskAmountAzl: formatUnits(totalAmount, 18),
        scopePublished: false,
        discoveryOpen: false,
      };
    },

    async setTaskScope(taskId, scope, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      if (!c.taskScopeRegistry) {
        throw new Error("Task scope registry not configured");
      }
      const text = String(scope ?? "").trim();
      if (!text) throw new Error("Scope cannot be empty");
      if (text.length > 8192) throw new Error("Scope too long (max 8192 bytes)");

      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const receipt = await writeSetScope(
        walletClient,
        publicClient,
        c.taskScopeRegistry,
        taskId,
        text,
        onProgress
      );
      return { hash: receipt.transactionHash };
    },

    async payUpgrade(tierId, options, onProgress) {
      const opts = typeof options === "function" ? { onProgress: options } : options ?? {};
      const progress = typeof options === "function" ? options : onProgress;
      const payWith = opts.payWith ?? "usdc";
      const quote = opts.quote ?? null;

      const cfg = await loadSiteConfig();
      const billingWallet = cfg.billingWallet;
      if (!billingWallet) throw new Error("Billing wallet not configured — contact support.");
      const plan = (cfg.postingPlans ?? []).find((p) => p.id === tierId);
      if (!plan || !plan.priceUsdc) throw new Error("Invalid upgrade plan");

      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);

      if (payWith === "azl") {
        if (!quote?.minAzlWei) throw new Error("AZL quote required — refresh and try again.");
        const amount = BigInt(quote.minAzlWei);
        const azlBal = await publicClient.readContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        });
        if (azlBal < amount) {
          throw new Error(
            "Not enough AZL — need " +
              formatAzlHuman(amount) +
              " on Base (you have " +
              formatAzlHuman(azlBal) +
              ")."
          );
        }
        progress?.(
          "Pay " +
            (quote.azlAmountFormatted || formatAzlHuman(amount)) +
            " (~$" +
            quote.discountedUsd +
            " · 10% off)…"
        );
        const receipt = await runTx("upgradeAzl", async () => {
          const hash = await walletClient.writeContract({
            address: c.azlToken,
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [billingWallet, amount],
          });
          return publicClient.waitForTransactionReceipt({ hash });
        }, progress);
        return { hash: receipt.transactionHash, tier: tierId, payWith: "azl", quoteId: quote.quoteId };
      }

      const amount = parseUnits(String(plan.priceUsdc), 6);
      const usdc = await publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      if (usdc < amount) {
        throw new Error(
          "Not enough USDC — need $" + plan.priceUsdc + " on Base (you have $" + formatUnits(usdc, 6) + ")."
        );
      }

      progress?.("Pay $" + plan.priceUsdc + " USDC for " + plan.label + "…");
      const receipt = await runTx("upgrade", async () => {
        const hash = await walletClient.writeContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [billingWallet, amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, progress);

      return { hash: receipt.transactionHash, tier: tierId, payWith: "usdc" };
    },

    async fundV2(taskId, amountAzl, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountAzl), 18);

      const allowance = await publicClient.readContract({
        address: c.azlToken,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, c.escrowVault],
      });
      if (allowance < amount) {
        onProgress?.("Approve AZL for escrow…");
        const hash = await walletClient.writeContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [c.escrowVault, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      onProgress?.("Locking payment in escrow…");
      const hash = await walletClient.writeContract({
        address: c.taskRegistry,
        abi: REGISTRY_ABI,
        functionName: "fund",
        args: [parseRegistryTaskId(taskId), amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash: receipt.transactionHash };
    },

    async claimReadiness(taskId) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const publicClient = getPublicClient(cfg);
      if (taskId === undefined || taskId === null) throw new Error("Task ID is required");
      const id = parseRegistryTaskId(taskId);
      const [reads, eth] = await Promise.all([
        publicClient.multicall({
          contracts: [
            { address: c.depositVault, abi: VAULT_ABI, functionName: "available", args: [address] },
            { address: c.depositVault, abi: VAULT_ABI, functionName: "latchedEntryFloor", args: [address] },
            { address: c.depositVault, abi: VAULT_ABI, functionName: "taskQuotes", args: [id] },
            { address: c.azlToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
            { address: c.stakingVault, abi: STAKING_ABI, functionName: "stakingActive" },
            { address: c.stakingVault, abi: STAKING_ABI, functionName: "creditsOf", args: [address] },
          ],
        }),
        publicClient.getBalance({ address }),
      ]);
      const [available, currentEntryFloor, quoteRead, azlBal, stakingActive, credits] = reads;
      const quote = quoteRead.result;
      if (!quote || quote.liveTaskReserve === 0n) {
        throw new Error("Task has no latched collateral quote");
      }
      const entryDeposit = quote.entryDeposit ?? 0n;
      const liveTaskReserve = quote.liveTaskReserve ?? 0n;
      const accessFee = quote.accessFee ?? 0n;
      const exitCompensation = quote.exitCompensation ?? 0n;
      const exitProtocolShare = quote.exitProtocolShare ?? 0n;
      const usesActionCredit =
        Boolean(stakingActive.result) && (credits.result ?? 0n) >= 10n ** 18n;
      const chargedAccessFee = usesActionCredit ? 0n : accessFee;
      const entryFloor = (currentEntryFloor.result ?? 0n) > entryDeposit
        ? currentEntryFloor.result ?? 0n
        : entryDeposit;
      const requiredAvailable = entryFloor + liveTaskReserve + chargedAccessFee;
      const availableAzl = available.result ?? 0n;
      return {
        availableAzl: formatUnits(availableAzl, 18),
        requiredAvailableAzl: formatUnits(requiredAvailable, 18),
        shortfallAzl: formatUnits(
          availableAzl >= requiredAvailable ? 0n : requiredAvailable - availableAzl,
          18,
        ),
        hasCollateral: availableAzl >= requiredAvailable,
        hasGas: eth >= MIN_ETH_WEI,
        walletAzl: formatUnits(azlBal.result ?? 0n, 18),
        entryDepositAzl: formatUnits(entryDeposit, 18),
        existingEntryFloorAzl: formatUnits(currentEntryFloor.result ?? 0n, 18),
        liveTaskReserveAzl: formatUnits(liveTaskReserve, 18),
        accessFeeAzl: formatUnits(accessFee, 18),
        chargedAccessFeeAzl: formatUnits(chargedAccessFee, 18),
        exitCompensationAzl: formatUnits(exitCompensation, 18),
        exitProtocolShareAzl: formatUnits(exitProtocolShare, 18),
        usesActionCredit,
      };
    },

    async claimV2(taskId, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Claiming task on Base…");
      const receipt = await runTx("claim", async () => {
        const hash = await walletClient.writeContract({
          address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "claim",
          args: [parseRegistryTaskId(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async getTaskDetail(taskId) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const publicClient = getPublicClient(cfg);
      const id = parseRegistryTaskId(taskId);
      const [task, locked] = await publicClient.multicall({
        contracts: [
          { address: c.taskRegistry, abi: REGISTRY_ABI, functionName: "tasks", args: [id] },
          { address: c.escrowVault, abi: ESCROW_ABI, functionName: "escrows", args: [id] },
        ],
      });
      const row = task.result;
      const stateName = TASK_STATE[Number(row.state)] ?? "UNKNOWN";
      const totalAmount = row.totalAmount;
      const lockedBal = locked.result
        ? locked.result.deposited - locked.result.released
        : 0n;
      const scope = await readOnchainScope(publicClient, c.taskScopeRegistry, taskId);
      return {
        taskId: String(taskId),
        state: stateName,
        poster: row.poster,
        worker: row.worker === zeroAddress ? null : row.worker,
        budgetAzl: formatUnits(totalAmount, 18),
        taskAmountAzl: formatUnits(totalAmount, 18),
        fundedAzl: formatUnits(row.funded, 18),
        releasedAzl: formatUnits(row.released, 18),
        lockedAzl: formatUnits(lockedBal, 18),
        funded: row.funded >= totalAmount && totalAmount > 0n,
        deadline: Number(row.deadline),
        fundingDeadline: Number(row.fundingDeadline),
        deliveredAt: Number(row.deliveredAt),
        scope,
        discoveryOpen: Boolean(scope),
      };
    },

    async markDeliveredV2(taskId, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Recording delivery on Base…");
      const receipt = await runTx("markDelivered", async () => {
        const hash = await walletClient.writeContract({
          address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "markDelivered",
          args: [parseRegistryTaskId(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    buildDeliveryReceipt({ taskId, artifactUri, summary }) {
      const artifactHash = keccak256(stringToBytes(artifactUri));
      const receipt = {
        schemaVersion: "azzle-receipt-v2",
        taskId: String(taskId),
        worker: address,
        completedAt: new Date().toISOString(),
        artifacts: [{ type: "delivery", hash: artifactHash, uri: artifactUri }],
        availability: {
          retrievalUri: artifactUri,
          verifiedAt: new Date().toISOString(),
          contentAddressed: artifactUri.startsWith("ipfs://") || artifactUri.startsWith("ar://"),
        },
      };
      return {
        receipt,
        receiptHash: keccak256(stringToBytes(canonicalizeReceipt(receipt))),
        summary,
      };
    },

    async sendDeliveryNotice({ taskId, poster, receiptHash, receiptUri, artifactUris, receipt, summary }, onProgress) {
      onProgress?.("Opening private XMTP delivery notice…");
      return sendDeliveryNotice({
        wallet,
        poster,
        notice: { taskId, receiptHash, receiptUri, artifactUris, receipt, summary },
      });
    },

    async activateV2(taskId, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Activating task…");
      const receipt = await runTx("activate", async () => {
        const hash = await walletClient.writeContract({
        address: c.taskRegistry,
          abi: REGISTRY_ABI,
        functionName: "activate",
          args: [parseRegistryTaskId(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async completeV2(taskId, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Accepting delivery — releasing escrow…");
      const receipt = await runTx("complete", async () => {
        const hash = await walletClient.writeContract({
        address: c.taskRegistry,
          abi: REGISTRY_ABI,
        functionName: "complete",
        args: [parseRegistryTaskId(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async cancelV2(taskId, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Cancelling unfunded task…");
      const receipt = await runTx("cancel", async () => {
        const hash = await walletClient.writeContract({
          address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "cancel",
          args: [parseRegistryTaskId(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async expireV2(taskId, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Expiring task — remaining escrow refunds to you…");
      const receipt = await runTx("expire", async () => {
        const hash = await walletClient.writeContract({
          address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "expire",
          args: [parseRegistryTaskId(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async openDispute(taskId, onProgress) {
      const cfg = await loadConfigForTask(taskId);
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const evidenceHash = keccak256(stringToBytes("poster-dispute:" + taskId));
      onProgress?.("Opening dispute — escrow frozen…");
      const receipt = await runTx("openDispute", async () => {
        const hash = await walletClient.writeContract({
        address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "openDispute",
          args: [parseRegistryTaskId(taskId), evidenceHash],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async getUnionPosition(market) {
      const cfg = await loadSiteConfig(market);
      const c = cfg.contracts;
      const vault = String(c.stakingVault || "").toLowerCase();
      if (!vault || vault === "0x0000000000000000000000000000000000000000" || cfg.status === "pending") {
        return {
          signedIn: true,
          live: false,
          active: false,
          walletAzl: "0",
          stakedAzl: "0",
          credits: "0",
          wholeCredits: "0",
          creditsRemaining: "0",
          claimableAzl: "0",
          pendingPayoutAzl: "0",
          pendingUnstakeAzl: "0",
        };
      }
      const publicClient = getPublicClient(cfg);
      const [active, walletAzl, staked, credits, remaining, accrued, totalStaked, accRewardPerShare, rewardRate, rewardFinish, lastUpdate, rewardDebt, pending] = await publicClient.multicall({
        contracts: [
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "stakingActive" },
          { address: c.azlToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "stakeOf", args: [address] },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "creditsOf", args: [address] },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "creditsRemaining" },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "accrued", args: [address] },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "totalStaked" },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "accRewardPerShare" },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "rewardRate" },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "rewardFinish" },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "lastUpdate" },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "rewardDebt", args: [address] },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "pendingPayouts", args: [address] },
        ],
      });
      const ACC = 10n ** 27n;
      const now = BigInt(Math.floor(Date.now() / 1000));
      const last = lastUpdate.result ?? 0n;
      const finish = rewardFinish.result ?? 0n;
      const total = totalStaked.result ?? 0n;
      const until = now < finish ? now : finish;
      const emission = until > last ? (until - last) * (rewardRate.result ?? 0n) : 0n;
      const projectedAcc = total > 0n
        ? (accRewardPerShare.result ?? 0n) + (emission * ACC) / total
        : (accRewardPerShare.result ?? 0n);
      const liveAccrued = (accrued.result ?? 0n)
        + ((staked.result ?? 0n) * projectedAcc) / ACC
        - (rewardDebt.result ?? 0n);
      return {
        signedIn: true,
        live: true,
        active: Boolean(active.result),
        walletAzl: formatUnits(walletAzl.result ?? 0n, 18),
        stakedAzl: formatUnits(staked.result ?? 0n, 18),
        credits: formatUnits(credits.result ?? 0n, 18),
        wholeCredits: formatUnits(credits.result ?? 0n, 18),
        creditsRemaining: formatUnits(remaining.result ?? 0n, 18),
        claimableAzl: formatUnits(liveAccrued > 0n ? liveAccrued : 0n, 18),
        pendingPayoutAzl: formatUnits(pending.result ?? 0n, 18),
        pendingUnstakeAzl: formatUnits(pending.result ?? 0n, 18),
      };
    },

    async unionTx(action, value, onProgress, market) {
      const cfg = await loadSiteConfig(market);
      const vault = String(cfg.contracts?.stakingVault || "").toLowerCase();
      if (!vault || vault === "0x0000000000000000000000000000000000000000" || cfg.status === "pending") {
        throw new Error("That Union vault is not live yet.");
      }
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = value == null || value === "" || /^0x/i.test(String(value))
        ? 0n
        : parseUnits(String(value), 18);
      const stakeAmount = action === "claimUnstakeTo"
        ? await publicClient.readContract({
            address: c.stakingVault,
            abi: STAKING_ABI,
            functionName: "stakeOf",
            args: [address],
          })
        : amount;
      if (action === "stake") {
        const active = await publicClient.readContract({
          address: c.stakingVault,
          abi: STAKING_ABI,
          functionName: "stakingActive",
        });
        if (!active) {
          throw new Error(
            (market === "micro" ? "Micro" : "Standard") +
              " Union staking is not activated yet. Stake stays closed until the owner calls activateStaking."
          );
        }
        const allowance = await publicClient.readContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, c.stakingVault],
        });
        if (allowance < amount) {
          const approval = await walletClient.writeContract({
            address: c.azlToken,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [c.stakingVault, amount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approval });
        }
      }
      const args = action === "stake" ? [amount] :
        action === "unstake" || action === "claimUnstakeTo" ? [stakeAmount, address] :
        action === "claimRewards" ? [address] : [];
      const functionName = action === "claimUnstakeTo" ? "unstake" :
        action === "claimRewards" ? "claim" : action;
      onProgress?.("Submitting Union transaction…");
      const hash = await walletClient.writeContract({
        address: c.stakingVault,
        abi: STAKING_ABI,
        functionName,
        args,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash: receipt.transactionHash };
    },

    async fundAndActivate(taskId, amountAzl, onProgress) {
      const detail = await this.getTaskDetail(taskId);
      if (!detail.funded) {
        await this.fundV2(taskId, amountAzl, onProgress);
      }
      return this.activateV2(taskId, onProgress);
    },
  };
}
