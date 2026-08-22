import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(root, "site");
const sitemap = await readFile(join(siteRoot, "sitemap.xml"), "utf8");
const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
const routeTargets = new Map((vercel.rewrites ?? [])
  .filter(({ source, destination }) => !source.includes(":") && !source.includes("("))
  .map(({ source, destination }) => [source.replace(/\/$/, "") || "/", destination]));
const generatedFrom = new Map([
  [normalize(join(siteRoot, "role-wallet.bundle.js")), join(root, "src", "wallet-entry.jsx")],
  [normalize(join(siteRoot, "wallet-qr.js")), join(root, "src", "wallet-qr.mjs")],
]);
const failures = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    if (["generated", "archive", "legacy-v1"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }))).flat();
}

const files = await walk(siteRoot);
const htmlFiles = files.filter((file) => extname(file).toLowerCase() === ".html");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (new Set(sitemapUrls).size !== sitemapUrls.length) failures.push("sitemap contains duplicate URLs");

function routeToFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\/$/, "") || "/";
  if (clean.startsWith("/reference/")) return join(root, clean.slice("/reference/".length));
  const rewritten = routeTargets.get(clean);
  if (rewritten && !rewritten.startsWith("/api/")) return join(siteRoot, rewritten.replace(/^\/+/, ""));
  if (clean === "/") return join(siteRoot, "index.html");
  const direct = join(siteRoot, clean.replace(/^\/+/, ""));
  if (extname(direct)) return direct;
  return `${direct}.html`;
}

async function exists(path, allowDirectory = false) {
  try {
    const info = await stat(path);
    return info.isFile() || (allowDirectory && info.isDirectory());
  } catch {
    const source = generatedFrom.get(normalize(path));
    if (!source) return false;
    try {
      return (await stat(source)).isFile();
    } catch {
      return false;
    }
  }
}

for (const raw of sitemapUrls) {
  let url;
  try { url = new URL(raw); } catch { failures.push(`invalid sitemap URL ${raw}`); continue; }
  if (!["azzle.org", "www.azzle.org"].includes(url.hostname)) failures.push(`off-domain sitemap URL ${raw}`);
  if (url.protocol !== "https:" || url.search || url.hash) failures.push(`non-canonical sitemap URL ${raw}`);
  if (url.pathname.startsWith("/api/")) continue;
  let target;
  try { target = routeToFile(url.pathname); } catch { failures.push(`invalid encoded sitemap path ${raw}`); continue; }
  if (!await exists(target, url.pathname.startsWith("/reference/"))) failures.push(`sitemap target missing: ${url.pathname}`);
}

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const sourceRoute = `/${relative(siteRoot, file).split(sep).join("/")}`;
  for (const match of html.matchAll(/\b(href|src)\s*=\s*["']([^"'#]+)(?:#([^"']*))?["']/gi)) {
    const attribute = match[1].toLowerCase();
    const href = match[2].trim();
    const fragment = match[3] ?? "";
    if (!href || /^(?:https?:|mailto:|tel:|javascript:|data:|\/\/)/i.test(href) || href.includes("${") || href.includes("<")) continue;
    let url;
    try { url = new URL(href, `https://azzle.org${sourceRoute}`); } catch { failures.push(`${sourceRoute}: invalid href ${href}`); continue; }
    if (!["azzle.org", "www.azzle.org"].includes(url.hostname)) continue;
    let target;
    try { target = routeToFile(url.pathname); } catch { failures.push(`${sourceRoute}: invalid encoded link ${href}`); continue; }
    if (!await exists(target, url.pathname.startsWith("/reference/"))) {
      failures.push(`${sourceRoute}: broken ${attribute} ${href}`);
      continue;
    }
    if (attribute === "href" && fragment && extname(target).toLowerCase() === ".html") {
      const targetHtml = normalize(target) === normalize(file) ? html : await readFile(target, "utf8");
      let decodedFragment;
      try { decodedFragment = decodeURIComponent(fragment); } catch { failures.push(`${sourceRoute}: invalid fragment encoding ${href}`); continue; }
      const escaped = decodedFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\b(?:id|name)=["']${escaped}["']`).test(targetHtml)) {
        failures.push(`${sourceRoute}: missing fragment #${fragment} in ${url.pathname}`);
      }
    }
  }
}

if (failures.length) {
  console.error("Sitemap/link check failed:\n" + [...new Set(failures)].map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Sitemap/link check passed (${sitemapUrls.length} URLs, ${htmlFiles.length} HTML files).`);
