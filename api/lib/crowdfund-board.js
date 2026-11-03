/**
 * Collaborative task rosters for the marketplace.
 * The pass count is the crowdfund schedule `(3n + 4) / 5`.
 * This board records wallets and pledges. It does not post a task and it does not move AZL.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_OWNERS = 200;
const MAX_CAMPAIGNS = 100;
const KV_KEY = "crowdfund:campaigns:v1";
const SCALE = 1_000_000n;

const storePath = process.env.VERCEL
  ? join(tmpdir(), "azzle-crowdfund-campaigns.json")
  : join(process.cwd(), "api", "data", "crowdfund-campaigns.json");

let memory = { campaigns: [] };
let chain = Promise.resolve();

export function quorum(n) {
  const count = Number(n);
  if (!Number.isInteger(count) || count < 1 || count > MAX_OWNERS) {
    throw boardError("A bounty can have 1 to 200 wallets.");
  }
  return Math.floor((3 * count + 4) / 5);
}

export function parseAzl(value, label) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text) || /^0+(\.0+)?$/.test(text)) {
    throw boardError(`${label} must be a positive AZL amount with up to 6 decimals.`);
  }
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole) * SCALE + BigInt((frac + "000000").slice(0, 6));
}

export function formatAzl(units) {
  const value = BigInt(units);
  const whole = value / SCALE;
  const frac = (value % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

function boardError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function cleanText(value, label, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw boardError(`Enter ${label}.`);
  if (text.length > max) throw boardError(`${label} must be ${max} characters or fewer.`);
  return text;
}

function cleanWallet(value, required) {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw boardError("Enter the wallet that will sign.");
    return null;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) throw boardError("Wallet must be a 20-byte hex address.");
  return text.toLowerCase();
}

function unitsOf(text) {
  const raw = String(text ?? "").trim();
  if (!raw || /^0+(\.0+)?$/.test(raw)) return 0n;
  return parseAzl(raw, "Amount");
}

function pledgedUnits(campaign) {
  return unitsOf(campaign.openerAmountAzl) + campaign.members.reduce((sum, member) => sum + unitsOf(member.amountAzl), 0n);
}

function viewOf(campaign) {
  const owners = 1 + campaign.members.length;
  const signaturesRequired = quorum(owners);
  const blockers = owners - signaturesRequired + 1;
  const next = owners < MAX_OWNERS
    ? { owners: owners + 1, signaturesRequired: quorum(owners + 1) }
    : null;
  const pledged = pledgedUnits(campaign);
  return {
    id: campaign.id,
    title: campaign.title,
    brief: campaign.brief,
    market: campaign.market,
    totalAzl: campaign.totalAzl,
    minJoinAzl: campaign.minJoinAzl,
    pledgedAzl: formatAzl(pledged),
    owners,
    signaturesRequired,
    signaturesLabel: `${signaturesRequired} of ${owners}`,
    blockers,
    opener: {
      name: campaign.openerName,
      wallet: campaign.openerWallet,
      amountAzl: campaign.openerAmountAzl,
    },
    members: campaign.members.map((member) => ({
      name: member.name,
      wallet: member.wallet,
      amountAzl: member.amountAzl,
    })),
    seatsLeft: MAX_OWNERS - owners,
    nextJoin: next
      ? {
          owners: next.owners,
          signaturesRequired: next.signaturesRequired,
          signaturesLabel: `${next.signaturesRequired} of ${next.owners}`,
        }
      : null,
    createdAt: campaign.createdAt,
  };
}

function find(state, id) {
  const key = String(id ?? "").trim();
  const campaign = state.campaigns.find((item) => item.id === key);
  if (!campaign) {
    const error = new Error("That bounty does not exist.");
    error.status = 404;
    throw error;
  }
  return campaign;
}

export function createCampaign(state, input) {
  if (state.campaigns.length >= MAX_CAMPAIGNS) {
    throw boardError("The board holds 100 bounties.");
  }
  const title = cleanText(input.title, "a task title", 80);
  const brief = cleanText(input.brief, "what you want done", 600);
  const market = input.market === "micro" ? "micro" : input.market === "standard" ? "standard" : null;
  if (!market) throw boardError("Pick Standard or Micro.");
  const total = parseAzl(input.totalAzl, "Goal");
  const minJoin = parseAzl(input.minJoinAzl, "Minimum join");
  if (minJoin > total) throw boardError("Minimum join cannot be above the goal.");
  const rawOpener = String(input.openerAmountAzl ?? "").trim();
  const openerAmount = !rawOpener || /^0+(\.0+)?$/.test(rawOpener)
    ? 0n
    : parseAzl(rawOpener, "Opening pledge");
  if (openerAmount !== 0n && openerAmount < minJoin) {
    throw boardError(`The opening pledge must be 0 or at least ${formatAzl(minJoin)} AZL.`);
  }
  if (openerAmount > total) throw boardError("The opening pledge cannot pass the goal.");
  const openerName = cleanText(input.openerName, "your name", 40);
  const openerWallet = cleanWallet(input.openerWallet, false);
  const campaign = {
    id: randomBytes(9).toString("base64url"),
    title,
    brief,
    market,
    totalAzl: formatAzl(total),
    minJoinAzl: formatAzl(minJoin),
    openerName,
    openerWallet,
    openerAmountAzl: formatAzl(openerAmount),
    members: [],
    createdAt: new Date().toISOString(),
  };
  state.campaigns.unshift(campaign);
  return viewOf(campaign);
}

export function joinCampaign(state, input) {
  const campaign = find(state, input.id);
  if (campaign.members.length + 1 >= MAX_OWNERS) throw boardError("This bounty is full at 200 wallets.");
  const name = cleanText(input.name, "your name", 40);
  const wallet = cleanWallet(input.wallet, true);
  if (wallet === campaign.openerWallet || campaign.members.some((member) => member.wallet === wallet)) {
    throw boardError("That wallet is already on this bounty.");
  }
  const amount = parseAzl(input.amountAzl, "Pledge");
  const minJoin = unitsOf(campaign.minJoinAzl);
  if (amount < minJoin) throw boardError(`Minimum join for this task is ${campaign.minJoinAzl} AZL.`);
  if (pledgedUnits(campaign) + amount > unitsOf(campaign.totalAzl)) {
    throw boardError("That pledge would pass the goal.");
  }
  campaign.members.push({
    name,
    wallet,
    amountAzl: formatAzl(amount),
    joinedAt: new Date().toISOString(),
  });
  return viewOf(campaign);
}

export function leaveCampaign(state, input) {
  const campaign = find(state, input.id);
  const wallet = cleanWallet(input.wallet, true);
  const index = campaign.members.findIndex((member) => member.wallet === wallet);
  if (index < 0) throw boardError("That wallet is not a contributor on this bounty.");
  campaign.members.splice(index, 1);
  return viewOf(campaign);
}

function useKv() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
    || (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
    || process.env.REDIS_URL
    || process.env.REDIS_URL_,
  );
}

async function readState() {
  if (useKv()) {
    const { kvGet } = await import("./kv.js");
    const stored = await kvGet(KV_KEY);
    if (stored && Array.isArray(stored.campaigns)) return stored;
    return { campaigns: [] };
  }
  try {
    const raw = await readFile(storePath, "utf8");
    const stored = JSON.parse(raw);
    if (stored && Array.isArray(stored.campaigns)) {
      memory = stored;
      return stored;
    }
  } catch {
    /* first run, or a local file that is not there yet */
  }
  return memory;
}

async function writeState(state) {
  memory = state;
  if (useKv()) {
    const { kvSet } = await import("./kv.js");
    await kvSet(KV_KEY, state);
    return;
  }
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(state));
}

function withState(fn) {
  const run = chain.then(async () => {
    const state = await readState();
    const result = await fn(state);
    await writeState(state);
    return result;
  });
  chain = run.then(() => {}, () => {});
  return run;
}

export async function handleCrowdfundRequest({ method, searchParams, body = {} }) {
  try {
    if (method === "OPTIONS") return { status: 204, json: null };
    if (method === "GET") {
      const state = await readState();
      const id = searchParams.get("id");
      if (id) return { status: 200, json: { campaign: viewOf(find(state, id)) } };
      return { status: 200, json: { campaigns: state.campaigns.map(viewOf) } };
    }
    if (method !== "POST") return { status: 405, json: { error: "method_not_allowed" } };
    const action = body.action;
    const campaign = await withState((state) => {
      if (action === "create") return createCampaign(state, body);
      if (action === "join") return joinCampaign(state, body);
      if (action === "leave") return leaveCampaign(state, body);
      throw boardError("Unknown action.");
    });
    return { status: 200, json: { campaign } };
  } catch (error) {
    return { status: error.status || 500, json: { error: error.message || "crowdfund_failed" } };
  }
}
