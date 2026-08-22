import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots = [
  "README.md", "AGENTS.md", "QUICKSTART.md", "BOOTSTRAP.md", "MASTERSKILL.md",
  "site/docs", "protocol", "arbitration", "reputation", "launch-skills", "agents",
  "docs", "xmtp-spec", "examples", "azzle-force",
];
const ignored = new Set(["node_modules", ".agents", "dist", "public", "archive", "legacy-v1", "generated"]);
const ignoredFiles = new Set([
  "launch-skills/azzle-film.html", "launch-skills/trailer_video.html",
  "agents/scaffolding/aeon/GITHUB_ACTIONS.md",
]);
const forbidden = ["postTask", "claimTask", "fundTask", "startWork", "submitProof", "acceptMilestone", "IN_REVIEW", "PAUSED", "DELETED"];
const claims = [
  [/\bUSDC\b[^.;\n]{0,100}\b(?:task|job)\s+(?:payment|escrow)\b/gi, "USDC task escrow"],
  [/\b(?:task|job)\s+(?:payment|escrow)\b[^.;\n]{0,100}\bUSDC\b/gi, "USDC task escrow"],
  [/\b(?:direct[- ]hire|proof[- ]review|proof review)\b/gi, "retired lifecycle"],
  [/\b(?:subgraph|The Graph)\b[^\n]{0,100}\b(?:task|market|discover|index|authoritative)\w*\b/gi, "retired subgraph authority"],
  [/\b(?:fixed|flat)\s+(?:(?:1(?:,|_)?000|[0-9]+)\s*[- ]?)?(?:(?:AZL|AZZLE|token|access|claim)\s*[- ]?)?fee\b/gi, "fixed fee"],
  [/\bsingle\s+(?:V2\s+)?market\b|\bthe\s+only\s+(?:V2\s+)?market\b|\b(?:standard|micro)\s+is\s+the\s+only\s+market\b/gi, "single-market claim"],
];
const explanation = /\b(?:legacy|retired|deprecated|reserved|historical|v1|removed|unsupported|does not|has no|there is no|is no|no longer|do not|never|instead of|unlike|separate from|not task|not a separate|reject(?:ed|s)?|forbid(?:den|s)?|illegal)\b/i;
const unscopedIdExplanation = /\b(?:unscoped|bare|legacy|v1|reject(?:ed|s)?|forbid(?:den|s)?|illegal|unsupported)\b/i;
const invalidIdExplanation = /\b(?:invalid|reject(?:ed|s)?|forbid(?:den|s)?|illegal|unsupported)\b/i;

async function walk(dir) {
  if (/\.(?:md|html)$/i.test(dir)) return [dir];
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    if (ignored.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : /\.(?:md|html)$/i.test(path) ? [path] : [];
  }))).flat();
}

const violations = [];
let scanned = 0;
for (const dir of roots) {
  try {
    for (const path of await walk(join(root, dir))) {
      scanned++;
      const rel = relative(root, path).split(sep).join("/");
      if (ignoredFiles.has(rel)) continue;
      const content = await readFile(path, "utf8");
      const lineContext = (index) => {
        const start = content.lastIndexOf("\n", index) + 1;
        const end = content.indexOf("\n", index);
        return content.slice(start, end < 0 ? content.length : end);
      };
      for (const term of forbidden) {
        for (const match of content.matchAll(new RegExp(`\\b${term}\\b`, "g"))) {
          if (!explanation.test(lineContext(match.index))) violations.push(`${rel}: active ${term}`);
        }
      }
      for (const [pattern, label] of claims) {
        pattern.lastIndex = 0;
        for (const match of content.matchAll(pattern)) {
          if (!explanation.test(lineContext(match.index))) violations.push(`${rel}: ${label}`);
        }
      }
      for (const match of content.matchAll(/\bv2:([0-9]+)\b/g)) {
        if (!unscopedIdExplanation.test(lineContext(match.index))) violations.push(`${rel}: unscoped task id ${match[0]}`);
      }
      for (const match of content.matchAll(/\bv2:(standard|micro):([0-9]+)\b/gi)) {
        if (!/^v2:(standard|micro):[1-9][0-9]*$/.test(match[0].toLowerCase())
          && !invalidIdExplanation.test(lineContext(match.index))) {
          violations.push(`${rel}: non-strict task id ${match[0]}`);
        }
      }
      for (const match of content.matchAll(/\^v2:\(standard\|micro\):(?:(?:\[0-9\]|\\d)\+|\((?:\[0-9\]|\\d)\+\))\$/g)) {
        violations.push(`${rel}: permissive task-id pattern ${match[0]}`);
      }
    }
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
if (violations.length) throw new Error(`active V2 docs contain legacy logic:\n${[...new Set(violations)].join("\n")}`);
console.log(`Active V2 documentation scan passed (${scanned} files).`);
