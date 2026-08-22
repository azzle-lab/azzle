/** Canonical outreach brand — from .env, not LLM memory. */

export interface OutreachBrand {
  siteUrl: string;
  siteHost: string;
  fromName: string;
}

export function loadOutreachBrand(): OutreachBrand {
  const fromName = process.env.OUTREACH_FROM_NAME ?? "AZZLE";
  let siteUrl = process.env.OUTREACH_SITE_URL?.trim();
  if (!siteUrl) {
    const fromEmail = process.env.OUTREACH_FROM_EMAIL ?? "";
    const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "azzle.org";
    siteUrl = `https://${domain}`;
  }
  if (!/^https?:\/\//i.test(siteUrl)) {
    siteUrl = `https://${siteUrl}`;
  }
  siteUrl = siteUrl.replace(/\/$/, "");
  const siteHost = new URL(siteUrl).hostname.replace(/^www\./i, "");
  return { siteUrl, siteHost, fromName };
}

/** Fix common wrong domains the model invents (e.g. azzle.xyz). */
export function normalizeOutreachCopy(text: string, brand: OutreachBrand): string {
  const wrongHosts = ["azzle.xyz", "azzle.com", "www.azzle.xyz", "www.azzle.com"];
  let out = text;
  for (const wrong of wrongHosts) {
    const re = new RegExp(`https?:\\/\\/(?:www\\.)?${wrong.replace(".", "\\.")}\\/?`, "gi");
    out = out.replace(re, brand.siteUrl);
    out = out.replace(new RegExp(`(?:www\\.)?${wrong.replace(".", "\\.")}`, "gi"), brand.siteHost);
  }
  return out;
}

export function outreachBrandRules(brand: OutreachBrand): string {
  return [
    `Official brand: ${brand.fromName}. Website: ${brand.siteUrl} only.`,
    `Never use azzle.xyz, azzle.com, or any other domain.`,
    `If you include a link or signature, use ${brand.siteUrl} and sign as ${brand.fromName}.`,
    `AZL wei is the task payment, escrow, deposit, fee, reward, and bond asset. USD6 figures are policy targets, not payment assets.`,
    `Never quote fixed economics. Link to ${brand.siteUrl}/docs/markets.html and name standard or micro explicitly.`,
    `Task references must be v2:standard:N or v2:micro:N. Never publish bare numeric or v2:N task ids.`,
    `Do not claim USDC task escrow, subgraph discovery, direct hire, milestones, streaming, proof review, or pause/delete recovery.`,
  ].join("\n");
}
