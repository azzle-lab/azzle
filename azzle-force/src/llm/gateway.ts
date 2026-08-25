import { z } from "zod";
import { modelsForTier } from "./tiers.js";
import { extractMessageText, parseJsonFromLlm } from "./json.js";
import type { ModelTier } from "../types.js";

export interface LlmGatewayConfig {
  baseUrl: string;
  apiKey: string;
}

const MAX_CONCURRENT = Number(process.env.AZZLE_LLM_MAX_CONCURRENT ?? "2");
const MAX_429_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Global LLM concurrency gate — lite:all runs many agents; Bankr returns 429 without this. */
class LlmConcurrencyGate {
  private inFlight = 0;
  private waiters: Array<() => void> = [];
  private rateLimitUntil = 0;

  async acquire(): Promise<void> {
    const now = Date.now();
    if (now < this.rateLimitUntil) {
      await sleep(this.rateLimitUntil - now);
    }
    if (this.inFlight < MAX_CONCURRENT) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inFlight++;
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  note429(retryAfterMs: number): void {
    this.rateLimitUntil = Math.max(this.rateLimitUntil, Date.now() + retryAfterMs);
  }
}

const llmGate = new LlmConcurrencyGate();

export class LlmGateway {
  constructor(private config: LlmGatewayConfig) {}

  async completeJson<T>(
    tier: ModelTier,
    system: string,
    userFacts: Record<string, unknown>,
    schema: z.ZodType<T>,
    opts?: {
      defaults?: Record<string, unknown>;
      normalize?: (data: unknown) => unknown;
      schemaExample?: Record<string, unknown>;
    }
  ): Promise<T> {
    const defaults = opts?.defaults ?? this.fallbackFromFacts(userFacts);
    const normalize = opts?.normalize ?? ((d: unknown) => d);

    if (!this.config.apiKey) {
      return parseWithSchema(schema, normalize(defaults), defaults);
    }

    const models = modelsForTier(tier);
    let lastError: Error | undefined;

    for (const model of models) {
      for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
        await llmGate.acquire();
        try {
          const raw = await this.callModel(model, system, userFacts, opts?.schemaExample);
          const parsed = normalize(parseJsonFromLlm(raw));
          return parseWithSchema(schema, parsed, defaults);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const msg = lastError.message;
          const is429 = msg.includes("429") || msg.includes("rate_limit");
          if (is429 && attempt < MAX_429_RETRIES) {
            const backoff = Math.min(2000 * 2 ** attempt, 15000);
            llmGate.note429(backoff);
            console.warn(`[llm] ${model} rate limited — retry ${attempt + 1}/${MAX_429_RETRIES} in ${backoff}ms`);
            await sleep(backoff);
            continue;
          }
          const isLast = model === models[models.length - 1];
          const unsupported =
            msg.includes("unsupported_model") ||
            msg.includes("Unsupported model") ||
            msg.includes("model_not_found");
          const parseError =
            msg.includes("Unexpected token") ||
            msg.includes("Invalid JSON") ||
            msg.includes("JSON") ||
            msg.includes("too_small") ||
            msg.includes("invalid_type") ||
            msg.includes("Required") ||
            msg.includes("empty content");
          if (!isLast && (unsupported || parseError || is429)) {
            if (is429) console.warn(`[llm] ${model} rate limited — trying next model`);
            else console.warn(`[llm] ${model} failed — ${msg.slice(0, 160)}`);
            break;
          }
          break;
        } finally {
          llmGate.release();
        }
      }
    }

    console.warn(
      `[llm] all models failed (${(lastError?.message ?? "unknown").slice(0, 120)}), using defaults`
    );
    return parseWithSchema(schema, normalize(defaults), defaults);
  }

  private async callModel(
    model: string,
    system: string,
    userFacts: Record<string, unknown>,
    schemaExample?: Record<string, unknown>
  ): Promise<string> {
    const jsonBody: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            "Return raw JSON only — no markdown, no thinking, no code fences.",
            schemaExample
              ? `\nRequired top-level keys and shape (replace example values with content for this topic):\n${JSON.stringify(schemaExample, null, 2)}`
              : "",
            `\nFacts:\n${JSON.stringify(userFacts, null, 2)}`,
          ].join(""),
        },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    };
    if (!model.startsWith("deepseek")) {
      jsonBody.response_format = { type: "json_object" };
    }

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
        "X-API-Key": this.config.apiKey,
      },
      body: JSON.stringify(jsonBody),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bankr LLM Gateway error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
        };
      }>;
    };
    const text = extractMessageText(data.choices?.[0]?.message);
    if (!text.trim()) {
      throw new Error("Invalid JSON from model: empty content (0 chars)");
    }
    return text;
  }

  /** Heuristic fallback when gateway unavailable — keeps graph + scoring flowing */
  private fallbackFromFacts(facts: Record<string, unknown>): Record<string, unknown> {
    const name = String(facts.name ?? facts.repo ?? "unknown");
    const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const prob = 0.4 + (hash % 60) / 100;
    const type = String(facts.type ?? "repository");
    const stars = Number((facts.metadata as { stars?: number })?.stars ?? 0);
    const boosted = Math.min(prob + stars / 5000, 0.95);

    return {
      name,
      type,
      azzle_probability: boosted,
      reason: "heuristic fallback (gateway unavailable or model error)",
      activity_score: boosted,
      body: `Hi — AZZLE coordinates autonomous agents with market-isolated AZL escrow on Base. Worth a look: ${name}`,
      channel: "email",
      relationship_type: "RELATED_TO",
      missions: [],
      strategy_summary: "Continue discovery; enable outreach when gates pass.",
      niche: "autonomous-agents",
      strength: 0.6,
      evidence: ["github activity"],
      spawn_recommended: false,
      matches: [],
      competitors: [],
      azzle_differentiators: ["market-isolated AZL escrow on Base"],
      summary: "Lite swarm running — check entity growth and hunter throughput.",
      growth_metrics: {},
      bottlenecks: [],
      recommendations: [],
      steps: ["Wallet on Base", "Acquire AZZLE", "Top up AgentDepositVault", "Post or claim a task"],
      starter_project: "npx @azzle/agents@latest init my-agent",
      docs_links: [],
    };
  }
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  data: unknown,
  defaults: Record<string, unknown>
): T {
  const direct = schema.safeParse(data);
  if (direct.success) return direct.data;

  const merged =
    typeof data === "object" && data !== null
      ? { ...defaults, ...(data as Record<string, unknown>) }
      : defaults;
  const filled = schema.safeParse(merged);
  if (filled.success) return filled.data;

  const minimal = schema.safeParse(defaults);
  if (minimal.success) return minimal.data;

  throw new Error(filled.error.message);
}
