/**
 * Generate the branded 1200x630 Open Graph image set.
 *
 * The checked-in site/og/*.png files are the deployable output. This script
 * keeps regeneration deterministic from the canonical logo and Clash font.
 */
import { createCanvas, loadImage, registerFont } from "canvas";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const output = join(site, "og");
const font = join(root, "scripts/assets/ClashDisplay.ttf");

registerFont(font, { family: "Clash Display", weight: "500" });

async function htmlFiles(dir) {
  const files = [];
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) files.push(...await htmlFiles(path));
    else if (name.name.endsWith(".html") && !name.name.startsWith("_")) files.push(path);
  }
  return files;
}

function meta(html, pattern, fallback) {
  return clean(html.match(pattern)?.[1] || fallback);
}

function clean(value) {
  return value
    .replace(/[ /  /  / ]/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = `${line} ${word}`.trim();
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

const logo = await loadImage(join(site, "azzletypee.png"));
const baseLogo = await loadImage(join(site, "baselogo.png"));
const bankrLogo = await loadImage(join(site, "bankr.png"));

function drawContained(ctx, image, x, y, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, x, y + (maxHeight - height) / 2, width, height);
  return { width, height };
}

for (const path of await htmlFiles(site)) {
  const html = await readFile(path, "utf8");
  const title = meta(html, /<title>(.*?)<\/title>/i, "AZZLE Protocol");
  const description = meta(html, /<meta\s+name=["']description["']\s+content=["'](.*?)["']/i, "Task coordination for onchain AI agents.");
  const slug = relative(site, path).replace(/\\/g, "/").replace(/\.html$/, "");
  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#080A10";
  ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = "#121928";
  for (let x = 0; x < 1200; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 630); ctx.stroke(); }
  for (let y = 0; y < 630; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); }
  const isDocs = slug.startsWith("docs/");
  ctx.fillStyle = isDocs ? "#0000FF" : "#C8F169";
  ctx.fillRect(0, 0, 1200, 7);
  ctx.fillStyle = isDocs ? "#C8F169" : "#0000FF";
  ctx.fillRect(0, 623, 1200, 7);
  ctx.globalAlpha = 0.9; ctx.drawImage(logo, 76, 54, 300, 168); ctx.globalAlpha = 1;
  ctx.fillStyle = isDocs ? "#0000FF" : "#C8F169";
  ctx.beginPath();
  ctx.arc(1110, 35, 225, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#080A10";
  ctx.beginPath();
  ctx.arc(1154, 84, 158, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "18px monospace"; ctx.fillStyle = "#C8F169";
  ctx.fillText(isDocs ? "DOCS / PROTOCOL" : slug === "llms" ? "MACHINE INDEX" : "AZZLE PROTOCOL", 78, 198);
  if (isDocs) {
    ctx.strokeStyle = "#C8F169";
    ctx.lineWidth = 2;
    ctx.strokeRect(930, 54, 192, 47);
    ctx.font = "700 24px 'Clash Display'";
    ctx.fillStyle = "#C8F169";
    const documentationLabel = "DOCUMENTATION";
    const documentationWidth = ctx.measureText(documentationLabel).width;
    ctx.fillText(documentationLabel, 1026 - documentationWidth / 2, 84);
  }
  ctx.font = "500 50px 'Clash Display'"; ctx.fillStyle = "#F0F4FF";
  wrap(ctx, title, 1000).forEach((line, i) => ctx.fillText(line, 76, 264 + i * 64));
  ctx.font = "17px monospace"; ctx.fillStyle = "#98A6BF";
  ctx.fillText(description.slice(0, 92), 78, 410);
  ctx.strokeStyle = "#293754"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(78, 455); ctx.lineTo(1122, 455); ctx.stroke();
  ctx.fillStyle = "#0000FF"; ctx.fillText(`azzle.org/${slug}`, 78, 490);
  ctx.globalAlpha = 0.92;
  drawContained(ctx, baseLogo, 78, 530, 96, 28);
  drawContained(ctx, bankrLogo, 188, 530, 34, 28);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#68748D";
  ctx.font = "14px monospace";
  const footerLine = "Done or Not Paid.";
  ctx.fillText(footerLine, 1122 - ctx.measureText(footerLine).width, 548);
  const destination = join(output, `${slug}.png`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, canvas.toBuffer("image/png"));
}
