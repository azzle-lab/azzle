/**
 * Translate common V2 contract revert strings into actionable SDK errors.
 * Contract messages stay the source of truth; this layer adds the "what to do".
 */
export class AzzleProtocolError extends Error {
  readonly code: string;
  readonly revert: string;
  readonly hint: string;
  constructor(code: string, revert: string, hint: string) {
    super(`${hint} (${revert})`);
    this.name = "AzzleProtocolError";
    this.code = code;
    this.revert = revert;
    this.hint = hint;
  }
}

const REVERT_HINTS: Array<{ match: RegExp; code: string; hint: string }> = [
  {
    match: /AzlGateway:\s*deadline/i,
    code: "GATEWAY_DEADLINE",
    hint:
      "Gateway deadline is outside the allowed window (block.timestamp through block.timestamp + 10 minutes). Use buildDeadline(provider) from the chain clock, not Date.now(). A 30-minute deadline will revert; 5 minutes is safe.",
  },
  {
    match: /AzlGateway:\s*zero/i,
    code: "GATEWAY_ZERO",
    hint:
      "fundWithUsdc rejects a zero input and a zero minAzlOut. Pass minAzlOut >= 1, or use quoteMinAzlOut() / fundDepositWithUsdcQuoted() so the SDK quotes a valid minimum.",
  },
  {
    match: /AzlGateway:\s*paused/i,
    code: "GATEWAY_PAUSED",
    hint: "Payment gateway intake is paused. Check client.isDepositIntakePaused() before offering USDC or ETH deposits.",
  },
  {
    match: /AzlGateway:\s*input cap/i,
    code: "GATEWAY_INPUT_CAP",
    hint: "USDC or ETH input exceeds the gateway cap or the executor depth cap. Split the deposit or reduce the amount.",
  },
  {
    match: /AzlGateway:\s*oracle/i,
    code: "GATEWAY_ORACLE",
    hint: "AZL/USD oracle is invalid. Wait for a fresh observation before quoting or depositing.",
  },
  {
    match: /AzlGateway:\s*AZL output/i,
    code: "GATEWAY_SLIPPAGE",
    hint: "Swap output was below minAzlOut. Increase slippage, requote, and retry with a fresh buildDeadline().",
  },
  {
    match: /AMv2:\s*deadline|AMv2:\s*window/i,
    code: "ARBITRATION_WINDOW",
    hint: "Evidence or ruling window has not opened, or the ruling deadline has passed. Call timeout() after the cutoff, or wait until beginRuling() is valid.",
  },
  {
    match: /AMv2:\s*not arbitrator|AMv2:\s*arbitrator/i,
    code: "ARBITRATION_ROLE",
    hint: "Only the assigned panel arbitrator may rule. If arbitrator is address(0), anyone may call assignArbitrator() within the assignment window.",
  },
  {
    match: /AMv2:\s*poster allocation|AMv2:\s*worker allocation|AMv2:\s*split|AMv2:\s*mutual allocation|AMv2:\s*bps/i,
    code: "ARBITRATION_ALLOCATION",
    hint: "Outcome and workerBps must match: POSTER_WINS=0, WORKER_WINS=10000, SPLIT=1000–9000, MUTUAL=0 or 5000.",
  },
];

function collectRevertText(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;
  const err = error as {
    shortMessage?: string;
    reason?: string;
    message?: string;
    data?: unknown;
    error?: unknown;
    info?: { error?: { message?: string } };
    revert?: { args?: unknown[]; name?: string };
  };
  const parts = [
    err.shortMessage,
    err.reason,
    err.message,
    typeof err.data === "string" ? err.data : "",
    err.info?.error?.message,
    err.revert?.name,
  ];
  if (err.error) parts.push(collectRevertText(err.error));
  return parts.filter(Boolean).join(" | ");
}

export function translateAzzleError(error: unknown): AzzleProtocolError | Error {
  const revert = collectRevertText(error);
  for (const row of REVERT_HINTS) {
    if (row.match.test(revert)) {
      return new AzzleProtocolError(row.code, revert, row.hint);
    }
  }
  if (error instanceof Error) return error;
  return new Error(revert || "Unknown AZZLE protocol error");
}

export async function withAzzleErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw translateAzzleError(error);
  }
}
