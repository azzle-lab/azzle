const DEFAULT_BASE_URL = "https://llm.bankr.bot/v1";
const DEFAULT_MODEL = "deepseek-v4-flash";

function extractJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("DeepSeek returned non-JSON output");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function asDecision(value, taskId, arbitrator) {
  const allowed = new Set(["ACCEPT_WORK", "REJECT_WORK", "SPLIT", "REQUEST_REVISION", "ESCALATE_HUMAN"]);
  if (!value || !allowed.has(value.intent)) throw new Error(`DeepSeek returned invalid intent for ${taskId}`);
  if (typeof value.explanation !== "string" || value.explanation.length < 1) {
    throw new Error(`DeepSeek returned no explanation for ${taskId}`);
  }
  const decision = {
    schemaVersion: "azzle-arbitration-decision-v1",
    taskId,
    intent: value.intent,
    explanation: value.explanation.slice(0, 4000),
    evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs.map(String).slice(0, 20) : [],
    criteriaChecklist: Array.isArray(value.criteriaChecklist) ? value.criteriaChecklist : [],
    decidedAt: new Date().toISOString(),
    arbitrator,
    mode: "agent",
  };
  if (value.intent === "SPLIT") {
    const bps = Number(value.workerBps);
    if (!Number.isInteger(bps) || bps < 1000 || bps > 9000) throw new Error(`DeepSeek returned invalid split for ${taskId}`);
    decision.workerBps = bps;
    decision.outcome = "SPLIT";
  } else if (value.intent === "ACCEPT_WORK") {
    decision.workerBps = 10000;
    decision.outcome = "WORKER_WINS";
  } else if (value.intent === "REJECT_WORK") {
    decision.workerBps = 0;
    decision.outcome = "POSTER_WINS";
  }
  return decision;
}

export function createDeepSeekRecommender({
  apiKey = process.env.BANKR_API_KEY ?? process.env.DEEPSEEK_API_KEY,
  baseUrl = process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
  model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL,
  arbitrator,
} = {}) {
  if (!apiKey) throw new Error("Set BANKR_API_KEY in azzle-arbitrator/.env");
  if (!arbitrator) throw new Error("DeepSeek recommender requires the arbitrator address");

  return async (bundle, criteria) => {
    const serializable = JSON.parse(JSON.stringify(bundle, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ));
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        ...(model.startsWith("deepseek") ? {} : { response_format: { type: "json_object" } }),
        messages: [
          {
            role: "system",
            content: [
              "You are the autonomous AZZLE V2 arbitrator.",
              "Compare the posted scope, completion criteria, delivery, and both parties' evidence.",
              "Return JSON only. Never invent evidence. If evidence is insufficient or ambiguous, use ESCALATE_HUMAN.",
              "REQUEST_REVISION is off-chain and must not be used for a final on-chain settlement.",
              "For SPLIT, workerBps must be an integer from 1000 through 9000.",
              'Schema: {"intent":"ACCEPT_WORK|REJECT_WORK|SPLIT|REQUEST_REVISION|ESCALATE_HUMAN","workerBps":number,"explanation":"string","evidenceRefs":["string"],"criteriaChecklist":[{"id":"string","met":true,"note":"string"}]}',
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({ case: serializable, completionCriteria: criteria }),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("DeepSeek response did not contain message content");
    return asDecision(extractJson(content), bundle.taskId, arbitrator);
  };
}
