/** Extract and parse JSON from LLM chat completions — DeepSeek often wraps or thinks first. */

const THINK_RE = /<(?:think|thinking|reason|reasoning)>[\s\S]*?<\/(?:think|thinking|reason|reasoning)>/gi;

export function stripThinkTags(text: string): string {
  return text.replace(THINK_RE, "").trim();
}

export function extractMessageText(message: {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
} | null | undefined): string {
  if (!message) return "";
  const fromContent = flattenContent(message.content);
  const fromReasoning = flattenContent(message.reasoning_content ?? message.reasoning);
  const stripped = stripThinkTags(fromContent);
  if (stripped && !isEllipsisOnly(stripped)) return stripped;
  const reasonStripped = stripThinkTags(fromReasoning);
  if (reasonStripped && !isEllipsisOnly(reasonStripped)) return reasonStripped;
  return stripped || reasonStripped || fromContent || fromReasoning;
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text?: unknown }).text ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

function isEllipsisOnly(s: string): boolean {
  return /^[.…\s.]*$/.test(s) && s.length < 8;
}

export function parseJsonFromLlm(text: string): unknown {
  let s = stripThinkTags(text).trim();
  if (!s || isEllipsisOnly(s)) {
    throw new Error(`Invalid JSON from model: empty content (${text.length} chars)`);
  }

  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i.exec(s);
  if (fenced) {
    s = fenced[1].trim();
  } else if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\r?\n?/i, "").replace(/\r?\n?```\s*$/i, "").trim();
  }

  const attempts = [s, extractBalancedObject(s), repairTruncatedJson(s)].filter(Boolean) as string[];
  let lastErr: Error | undefined;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const repaired = repairTruncatedJson(candidate);
      if (repaired && repaired !== candidate) {
        try {
          return JSON.parse(repaired);
        } catch (inner) {
          lastErr = inner instanceof Error ? inner : lastErr;
        }
      }
    }
  }

  const preview = JSON.stringify(s.slice(0, 80));
  const detail = lastErr?.message?.replace(/\s+/g, " ").slice(0, 80) ?? "parse failed";
  throw new Error(`Invalid JSON from model (${s.length} chars, ${detail}): ${preview}`);
}

function extractBalancedObject(s: string): string | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  const aStart = s.indexOf("[");
  const aEnd = s.lastIndexOf("]");
  if (aStart >= 0 && aEnd > aStart) return s.slice(aStart, aEnd + 1);
  return null;
}

/** Close truncated arrays/objects/strings when models hit token limits mid-JSON. */
export function repairTruncatedJson(s: string): string | null {
  const obj = s.indexOf("{");
  const arr = s.indexOf("[");
  let start = -1;
  if (obj >= 0 && (arr < 0 || obj < arr)) start = obj;
  else if (arr >= 0) start = arr;
  if (start < 0) return null;

  let fragment = s.slice(start).trim();
  fragment = fragment.replace(/,\s*$/, "");
  fragment = fragment.replace(/,\s*([}\]])/g, "$1");
  if (isInsideString(fragment)) fragment += '"';
  fragment = fragment.replace(/,\s*$/, "");

  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;
  for (const ch of fragment) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("{");
    else if (ch === "[") stack.push("[");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inString) fragment += '"';
  while (stack.length > 0) {
    fragment += stack.pop() === "{" ? "}" : "]";
  }
  fragment = fragment.replace(/,\s*([}\]])/g, "$1");
  try {
    JSON.parse(fragment);
    return fragment;
  } catch {
    return null;
  }
}

function isInsideString(s: string): boolean {
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    }
  }
  return inString;
}
