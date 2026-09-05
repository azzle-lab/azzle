import { Contract, ethers } from "ethers";
import { ARBITRATION_OUTCOMES, ARBITRATION_STATUS_NAMES, type DisputeRecord } from "./arbitration/types.js";
import { assertValidMinAzlOut, prepareUsdcDeposit } from "./gateway.js";
import { withAzzleErrors } from "./errors.js";
import type { BaseMainnetV2Manifest } from "./manifest-v2.js";
import { namespacedTaskId, parseTaskRef, resolveExpectedMarket, type AzzleMarket, type TaskRef } from "./markets.js";
import { taskReadiness, type ReadinessOptions, type TaskReadiness } from "./readiness.js";
import { parseTaskState, V2_TASK_STATE_NAMES as STATE_NAMES, type ParsedTaskState } from "./task-state.js";
import { waitForState, type WaitForStateOptions } from "./wait.js";

const REGISTRY_ABI = [
  "function post(uint256 totalAmount,uint64 deadline) returns (uint256)",
  "function claim(uint256 taskId)", "function fund(uint256 taskId,uint256 amount)",
  "function activate(uint256 taskId)", "function release(uint256 taskId,uint256 amount)",
  "function complete(uint256 taskId)", "function cancel(uint256 taskId)",
  "function markDelivered(uint256 taskId)", "function expire(uint256 taskId)",
  "function openDispute(uint256 taskId,bytes32 evidenceHash)",
  "function taskState(uint256 taskId) view returns (uint8)",
  "function tasks(uint256 taskId) view returns (address poster,address worker,uint256 totalAmount,uint256 funded,uint256 released,uint64 deadline,uint64 fundingDeadline,uint64 deliveredAt,uint8 state)",
  "event TaskPosted(uint256 indexed taskId,address indexed poster,uint256 totalAmount,uint256 amountUsd6,uint64 deadline)",
];
const VAULT_ABI = [
  "function withdraw(uint256 amount,address recipient)", "function claimPayout(address recipient)",
  "function deposits(address) view returns (uint256)", "function reserved(address) view returns (uint256)",
  "function available(address) view returns (uint256)", "function withdrawable(address) view returns (uint256)",
  "function latchedEntryFloor(address) view returns (uint256)",
  "function taskQuotes(uint256 taskId) view returns (uint256 entryDeposit,uint256 liveTaskReserve,uint256 accessFee,uint256 exitCompensation,uint256 exitProtocolShare)",
];
const GATEWAY_ABI = [
  "function fundWithUsdc(uint256 exactUsdcIn,uint256 minAzlOut,uint256 deadline) returns (uint256)",
  "function fundWithEth(uint256 minAzlOut,uint256 deadline) payable returns (uint256)",
  "function intakePaused() view returns (bool)",
];
const STAKING_ABI = [
  "function stake(uint256 amount)", "function unstake(uint256 amount)",
  "function claim(address recipient)", "function claimPayout(address recipient)",
  "function stakeOf(address) view returns (uint256)", "function accrued(address) view returns (uint256)",
  "function stakingActive() view returns (bool)", "function activateStaking()",
  "function creditsOf(address) view returns (uint256)", "function creditsRemaining() view returns (uint256)",
  "function bankCredits()",
];
const BONDS_ABI = [
  "function bond(uint256 amount)", "function scheduleWithdrawal()", "function withdraw(uint256 amount)",
  "function claimPayout(address recipient)", "function bonds(address) view returns (uint256)",
];
const SCOPE_ABI = ["function publish(uint256 taskId,string scope)", "function scopeOf(uint256 taskId) view returns (string)"];
const ARBITRATION_ABI = [
  "function submitEvidence(uint256 taskId,bytes32 evidenceHash)",
  "function beginRuling(uint256 taskId)",
  "function rule(uint256 taskId,uint8 outcome,uint16 workerBps)",
  "function timeout(uint256 taskId)",
  "function assignArbitrator(uint256 taskId) returns (address)",
  "function disputes(uint256 taskId) view returns (uint256 taskId,address opener,address arbitrator,bytes32 posterEvidence,bytes32 workerEvidence,uint64 evidenceDeadline,uint64 rulingDeadline,uint8 status,uint8 outcome,uint256 slashed)",
];

export interface OnChainTask {
  poster: string; worker: string; totalAmount: bigint; funded: bigint; released: bigint;
  deadline: bigint; fundingDeadline: bigint; deliveredAt: bigint; state: number; stateName: string;
}

export const V2_TASK_STATE_NAMES = STATE_NAMES;

export class AzzleV2Client {
  private provider: ethers.JsonRpcProvider;
  private registry: Contract;
  private vault: Contract;
  private gateway: Contract;
  private staking: Contract;
  private bonds: Contract;
  private arbitration: Contract;
  private scope: Contract;
  public readonly market: AzzleMarket;

  constructor(public readonly manifest: BaseMainnetV2Manifest, rpcUrl: string, market?: string) {
    if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") throw new Error("AzzleV2Client: invalid V2 manifest");
    if (!manifest.market) throw new Error("AzzleV2Client: manifest must declare market");
    this.market = resolveExpectedMarket(market ?? manifest.market, manifest);
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.registry = new Contract(manifest.taskRegistry, REGISTRY_ABI, this.provider);
    this.vault = new Contract(manifest.depositVault, VAULT_ABI, this.provider);
    this.gateway = new Contract(manifest.paymentGateway, GATEWAY_ABI, this.provider);
    this.staking = new Contract(manifest.stakingVault, STAKING_ABI, this.provider);
    this.bonds = new Contract(manifest.verifierBondVault, BONDS_ABI, this.provider);
    this.arbitration = new Contract(manifest.arbitrationModule, ARBITRATION_ABI, this.provider);
    this.scope = new Contract(manifest.taskScopeRegistry, SCOPE_ABI, this.provider);
  }

  connect(signer: ethers.Signer) {
    this.registry = this.registry.connect(signer) as Contract;
    this.vault = this.vault.connect(signer) as Contract;
    this.gateway = this.gateway.connect(signer) as Contract;
    this.staking = this.staking.connect(signer) as Contract;
    this.bonds = this.bonds.connect(signer) as Contract;
    this.arbitration = this.arbitration.connect(signer) as Contract;
    this.scope = this.scope.connect(signer) as Contract;
    return this;
  }

  async post(totalAmount: bigint, deadline: number) {
    const tx = await this.registry.post(totalAmount, deadline);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("AzzleV2Client: post failed");
    const iface = new ethers.Interface(REGISTRY_ABI);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.manifest.taskRegistry.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "TaskPosted") {
          const localTaskId = parsed.args.taskId as bigint;
          return { taskId: namespacedTaskId(this.market, localTaskId), localTaskId, receipt };
        }
      } catch { /* unrelated log */ }
    }
    throw new Error("AzzleV2Client: TaskPosted event missing");
  }

  private localTaskId(taskId: TaskRef | string | bigint): bigint {
    if (typeof taskId === "bigint") return taskId;
    return parseTaskRef(taskId, this.market).localIdBigInt;
  }
  resolveTaskRef(taskId: TaskRef | string): bigint { return this.localTaskId(taskId); }

  claim(taskId: TaskRef | string): any;
  /** @internal */ claim(taskId: bigint): any;
  claim(taskId: TaskRef | string | bigint) { return this.registry.claim(this.localTaskId(taskId)); }
  fund(taskId: TaskRef | string, amount: bigint): any;
  /** @internal */ fund(taskId: bigint, amount: bigint): any;
  fund(taskId: TaskRef | string | bigint, amount: bigint) { return this.registry.fund(this.localTaskId(taskId), amount); }
  activate(taskId: TaskRef | string): any;
  /** @internal */ activate(taskId: bigint): any;
  activate(taskId: TaskRef | string | bigint) { return this.registry.activate(this.localTaskId(taskId)); }
  release(taskId: TaskRef | string, amount: bigint): any;
  /** @internal */ release(taskId: bigint, amount: bigint): any;
  release(taskId: TaskRef | string | bigint, amount: bigint) { return this.registry.release(this.localTaskId(taskId), amount); }
  markDelivered(taskId: TaskRef | string): any;
  /** @internal */ markDelivered(taskId: bigint): any;
  markDelivered(taskId: TaskRef | string | bigint) { return this.registry.markDelivered(this.localTaskId(taskId)); }
  expire(taskId: TaskRef | string): any;
  /** @internal */ expire(taskId: bigint): any;
  expire(taskId: TaskRef | string | bigint) { return this.registry.expire(this.localTaskId(taskId)); }
  complete(taskId: TaskRef | string): any;
  /** @internal */ complete(taskId: bigint): any;
  complete(taskId: TaskRef | string | bigint) { return this.registry.complete(this.localTaskId(taskId)); }
  cancel(taskId: TaskRef | string): any;
  /** @internal */ cancel(taskId: bigint): any;
  cancel(taskId: TaskRef | string | bigint) { return this.registry.cancel(this.localTaskId(taskId)); }
  openDispute(taskId: TaskRef | string, evidenceHash: string): any;
  /** @internal */ openDispute(taskId: bigint, evidenceHash: string): any;
  openDispute(taskId: TaskRef | string | bigint, evidenceHash: string) { return this.registry.openDispute(this.localTaskId(taskId), evidenceHash); }
  publishScope(taskId: TaskRef | string, scope: string) { return this.scope.publish(this.localTaskId(taskId), scope); }
  getScope(taskId: TaskRef | string) { return this.scope.scopeOf(this.localTaskId(taskId)) as Promise<string>; }
  /**
   * Raw registry `taskState` — ethers returns uint8 as **bigint**.
   * `3n === 3` is false. Prefer `getTaskState()`, `waitForState()`, or
   * `parseTaskState()` / `isTaskState(raw, "ACTIVE")`.
   */
  taskState(taskId: TaskRef | string): Promise<bigint>;
  /** @internal */ taskState(taskId: bigint): Promise<bigint>;
  taskState(taskId: TaskRef | string | bigint) { return this.registry.taskState(this.localTaskId(taskId)) as Promise<bigint>; }
  async getTaskState(taskId: TaskRef | string | bigint): Promise<ParsedTaskState> {
    return parseTaskState(await this.taskState(taskId as TaskRef | string));
  }
  waitForState(taskId: TaskRef | string, expected: Parameters<typeof waitForState>[2], options?: WaitForStateOptions) {
    return waitForState(this, taskId, expected, options);
  }
  async getReadiness(taskId: TaskRef | string, options?: ReadinessOptions): Promise<TaskReadiness> {
    return taskReadiness(await this.getTask(taskId), options);
  }
  async getTask(taskId: TaskRef | string): Promise<OnChainTask>;
  /** @internal */ async getTask(taskId: bigint): Promise<OnChainTask>;
  async getTask(taskId: TaskRef | string | bigint): Promise<OnChainTask> {
    const row = await this.registry.tasks(this.localTaskId(taskId));
    const state = Number(row.state);
    return {
      poster: row.poster, worker: row.worker, totalAmount: row.totalAmount,
      funded: row.funded, released: row.released, deadline: row.deadline,
      fundingDeadline: row.fundingDeadline, deliveredAt: row.deliveredAt,
      state, stateName: V2_TASK_STATE_NAMES[state] ?? `UNKNOWN(${state})`,
    };
  }

  fundDepositWithUsdc(exactUsdcIn: bigint, minAzlOut: bigint, deadline: number) {
    assertValidMinAzlOut(minAzlOut);
    return withAzzleErrors(() => this.gateway.fundWithUsdc(exactUsdcIn, minAzlOut, deadline));
  }
  fundDepositWithEth(exactEthIn: bigint, minAzlOut: bigint, deadline: number) {
    assertValidMinAzlOut(minAzlOut);
    return withAzzleErrors(() => this.gateway.fundWithEth(minAzlOut, deadline, { value: exactEthIn }));
  }
  /** Quote minAzlOut from the oracle and a chain-clock deadline, then fund. */
  async fundDepositWithUsdcQuoted(exactUsdcIn: bigint, slippageBps = 100) {
    const { minAzlOut, deadline } = await prepareUsdcDeposit({
      provider: this.provider,
      usdOracle: this.manifest.usdOracle,
      exactUsdcIn,
      slippageBps,
    });
    return this.fundDepositWithUsdc(exactUsdcIn, minAzlOut, deadline);
  }
  isDepositIntakePaused() { return this.gateway.intakePaused() as Promise<boolean>; }
  withdrawDeposit(amount: bigint, recipient: string) { return this.vault.withdraw(amount, recipient); }
  claimDepositPayout(recipient: string) { return this.vault.claimPayout(recipient); }
  depositBalance(account: string) { return this.vault.deposits(account) as Promise<bigint>; }
  reservedDeposit(account: string) { return this.vault.reserved(account) as Promise<bigint>; }
  availableDeposit(account: string) { return this.vault.available(account) as Promise<bigint>; }
  withdrawableDeposit(account: string) { return this.vault.withdrawable(account) as Promise<bigint>; }
  latchedEntryFloor(account: string) { return this.vault.latchedEntryFloor(account) as Promise<bigint>; }
  getTaskQuote(taskId: TaskRef | string) {
    return this.vault.taskQuotes(this.localTaskId(taskId)) as Promise<{
      entryDeposit: bigint;
      liveTaskReserve: bigint;
      accessFee: bigint;
      exitCompensation: bigint;
      exitProtocolShare: bigint;
    }>;
  }

  stake(amount: bigint) { return this.staking.stake(amount); }
  unstake(amount: bigint) { return this.staking.unstake(amount); }
  claimRewards(recipient: string) { return this.staking.claim(recipient); }
  claimStakingPayout(recipient: string) { return this.staking.claimPayout(recipient); }
  activateStaking() { return this.staking.activateStaking(); }
  actionCredits(account: string) { return this.staking.creditsOf(account) as Promise<bigint>; }
  actionCreditsRemaining() { return this.staking.creditsRemaining() as Promise<bigint>; }
  bankActionCredits() { return this.staking.bankCredits(); }
  isStakingActive() { return this.staking.stakingActive() as Promise<boolean>; }

  bondVerifier(amount: bigint) { return this.bonds.bond(amount); }
  scheduleVerifierBondWithdrawal() { return this.bonds.scheduleWithdrawal(); }
  withdrawVerifierBond(amount: bigint) { return this.bonds.withdraw(amount); }
  claimBondPayout(recipient: string) { return this.bonds.claimPayout(recipient); }

  submitEvidence(taskId: TaskRef | string, evidenceHash: string) {
    return withAzzleErrors(() => this.arbitration.submitEvidence(this.localTaskId(taskId), evidenceHash));
  }
  beginRuling(taskId: TaskRef | string) {
    return withAzzleErrors(() => this.arbitration.beginRuling(this.localTaskId(taskId)));
  }
  rule(taskId: TaskRef | string, outcome: number, workerBps: number) {
    return withAzzleErrors(() => this.arbitration.rule(this.localTaskId(taskId), outcome, workerBps));
  }
  timeout(taskId: TaskRef | string) {
    return withAzzleErrors(() => this.arbitration.timeout(this.localTaskId(taskId)));
  }
  assignArbitrator(taskId: TaskRef | string) {
    return withAzzleErrors(() => this.arbitration.assignArbitrator(this.localTaskId(taskId)));
  }
  async getDispute(taskId: TaskRef | string): Promise<DisputeRecord> {
    const row = await this.arbitration.disputes(this.localTaskId(taskId));
    const status = Number(row.status ?? row[7]);
    const outcome = Number(row.outcome ?? row[8]);
    const outcomeNames = Object.keys(ARBITRATION_OUTCOMES) as Array<keyof typeof ARBITRATION_OUTCOMES>;
    return {
      taskId: BigInt(row.taskId ?? row[0]),
      opener: row.opener ?? row[1],
      arbitrator: row.arbitrator ?? row[2],
      posterEvidence: row.posterEvidence ?? row[3],
      workerEvidence: row.workerEvidence ?? row[4],
      evidenceDeadline: BigInt(row.evidenceDeadline ?? row[5]),
      rulingDeadline: BigInt(row.rulingDeadline ?? row[6]),
      status,
      statusName: ARBITRATION_STATUS_NAMES[status] ?? `UNKNOWN(${status})`,
      outcome,
      outcomeName: outcomeNames[outcome] ?? `UNKNOWN(${outcome})`,
      slashed: BigInt(row.slashed ?? row[9]),
    };
  }
}