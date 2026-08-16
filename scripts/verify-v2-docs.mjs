import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["site/docs", "protocol", "arbitration", "reputation", "launch-skills", "agents", "api"];
const ignored = new Set(["node_modules", ".agents", "dist", "public", "archive", "generated"]);
const ignoredFiles = new Set(["launch-skills/azzle-film.html", "launch-skills/trailer_video.html", "agents/scaffolding/aeon/GITHUB_ACTIONS.md"]);
const forbidden = ["postTask", "claimTask", "fundTask", "startWork", "submitProof", "acceptMilestone", "IN_REVIEW", "PAUSED", "DELETED"];
const explanation = /\b(?:legacy|retired|deprecated|reserved|historical|v1|does not expose|no longer|do not|never)\b/i;

async function walk(dir) {
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
      for (const term of forbidden) {
        for (const match of content.matchAll(new RegExp(`\\b${term}\\b`, "g"))) {
          const start = content.lastIndexOf("\n", match.index) + 1;
          const end = content.indexOf("\n", match.index);
          const context = content.slice(Math.max(0, start - 180), end < 0 ? content.length : end + 180);
          if (!explanation.test(context)) violations.push(`${rel}: active ${term}`);
        }
      }
    }
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
if (violations.length) throw new Error(`active V2 docs contain legacy logic:\n${[...new Set(violations)].join("\n")}`);
console.log(`Active V2 documentation scan passed (${scanned} files).`);
