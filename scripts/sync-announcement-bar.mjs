/**
 * Sync the launch-status announcement into every site HTML page.
 * The generated public copy is rebuilt from site/ during the Vercel build.
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");
const announcement = `\n<div class="azzle-announcement" role="status"><span>V2 is live🥳 Stake your AZL on <a href="/union">azzle.org/union</a></span></div>\n`;

async function walk(dir) {
  const files = [];
  for (const name of await readdir(dir)) {
    const file = join(dir, name);
    if ((await stat(file)).isDirectory()) files.push(...(await walk(file)));
    else if (name.endsWith(".html") && !name.startsWith("_")) files.push(file);
  }
  return files;
}

for (const file of await walk(siteDir)) {
  let html = await readFile(file, "utf8");
  html = html.replace(/\n?<div class="azzle-announcement"[\s\S]*?<\/div>\n?/i, "\n");
  html = html.replace(/(<body\b[^>]*>)/i, `$1${announcement}`);
  await writeFile(file, html, "utf8");
}

console.log(`[announcement] synchronized ${await walk(siteDir).then((files) => files.length)} site pages`);
