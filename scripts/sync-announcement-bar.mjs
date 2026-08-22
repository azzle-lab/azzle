/**
 * Sync the launch-status announcement into every site HTML page.
 * The generated public copy is rebuilt from site/ during the Vercel build.
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");
const announcement = `<div class="azzle-announcement" role="status"><span>V2 is live🥳 Stake your AZL on <a href="/union">azzle.org/union</a></span></div>`;
const skip = new Set([
  "ascii_beach_waves.html",
  "film.html",
  "launch-cartoon.html",
  "launch-film.html",
  "trailer-azl.html",
]);

async function walk(dir) {
  const files = [];
  for (const name of await readdir(dir)) {
    const file = join(dir, name);
    if ((await stat(file)).isDirectory()) files.push(...(await walk(file)));
    else if (name.endsWith(".html") && !name.startsWith("_")) files.push(file);
  }
  return files;
}

let changed = 0;
for (const file of await walk(siteDir)) {
  if (skip.has(basename(file))) continue;
  const html = await readFile(file, "utf8");
  const next = html
    .replace(/\r?\n*<div class="azzle-announcement"[\s\S]*?<\/div>\r?\n*/gi, "\n")
    .replace(/(<body\b[^>]*>)(?:\r?\n)*/i, `$1\n${announcement}\n`);
  if (next === html) continue;
  await writeFile(file, next, "utf8");
  changed += 1;
}

console.log(`[announcement] synchronized ${changed} site pages`);
