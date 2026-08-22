import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = await readFile(join(root, "site", "openapi.yaml"), "utf8");
const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
const failures = [];
const strictTaskIdPattern = "^v2:(standard|micro):[1-9][0-9]*$";

const pathMatches = [...spec.matchAll(/^  (\/api\/[^:]+):\s*$/gm)];
const rewrites = new Map((vercel.rewrites ?? []).map(({ source, destination }) => [source, destination]));
const operationIds = new Set();
const routes = new Set();

for (let index = 0; index < pathMatches.length; index++) {
  const match = pathMatches[index];
  const route = match[1];
  if (routes.has(route)) failures.push(`${route}: duplicate route declaration`);
  routes.add(route);
  const end = pathMatches[index + 1]?.index ?? spec.indexOf("\ncomponents:");
  const block = spec.slice(match.index, end < 0 ? spec.length : end);
  const operations = [...block.matchAll(/^    (get|post|put|patch|delete):\s*$/gm)];
  if (!operations.length) failures.push(`${route}: missing HTTP operation`);
  for (let operationIndex = 0; operationIndex < operations.length; operationIndex++) {
    const operation = operations[operationIndex];
    const operationEnd = operations[operationIndex + 1]?.index ?? block.length;
    const operationBlock = block.slice(operation.index, operationEnd);
    const operationId = operationBlock.match(/^      operationId:\s*(\S+)\s*$/m)?.[1];
    if (!operationId) failures.push(`${operation[1].toUpperCase()} ${route}: missing operationId`);
    else if (operationIds.has(operationId)) failures.push(`${route}: duplicate operationId ${operationId}`);
    else operationIds.add(operationId);

    if (!/(#\/components\/parameters\/Market|#\/components\/schemas\/Market|#\/components\/schemas\/MarketAddressBody)/.test(operationBlock)) {
      failures.push(`${operation[1].toUpperCase()} ${route}: operation does not select a standard|micro market`);
    }
  }

  const destination = rewrites.get(route) ?? route;
  if (!destination.startsWith("/api/")) failures.push(`${route}: rewrite leaves the API namespace`);
  const apiPath = join(root, `${destination.replace(/^\/+/, "")}.js`);
  try {
    await access(apiPath);
  } catch {
    failures.push(`${route}: implementation missing at ${destination}.js`);
  }
}

if (!pathMatches.length) failures.push("OpenAPI contains no /api routes");
if (!spec.includes(`pattern: "${strictTaskIdPattern}"`)) {
  failures.push(`TaskId.pattern must be ${strictTaskIdPattern}`);
}
if (!/schemas:\s*[\s\S]*?Market:\s*\n\s+type: string\s*\n\s+enum: \[standard, micro\]/m.test(spec)) {
  failures.push("Market schema must enumerate standard and micro");
}
for (const match of spec.matchAll(/\bv2:([0-9]+)\b/g)) {
  failures.push(`unscoped task-id example ${match[0]}`);
}
for (const match of spec.matchAll(/\bv2:(standard|micro):([0-9]+)\b/g)) {
  if (!/^v2:(standard|micro):[1-9][0-9]*$/.test(match[0])) failures.push(`non-strict task-id example ${match[0]}`);
}
for (const match of spec.matchAll(/(?:name:\s*(?:id|taskId)|^\s+taskId:)/gm)) {
  if (!spec.slice(match.index, match.index + 240).includes("#/components/schemas/TaskId")) {
    failures.push(`task-id field does not reference components.schemas.TaskId: ${match[0].trim()}`);
  }
}

if (failures.length) {
  console.error("OpenAPI contract check failed:\n" + [...new Set(failures)].map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`OpenAPI contract check passed (${pathMatches.length} market-scoped routes).`);
