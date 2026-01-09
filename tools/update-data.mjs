import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import path from "node:path";

const BASE_URL = "https://query.idleclans.com/api";
const MARKET_ITEMS = [
  { id: 365, name: "exceptional_scroll_of_woodcutting" },
  { id: 366, name: "exceptional_scroll_of_plundering" },
  { id: 367, name: "exceptional_scroll_of_fishing" },
  { id: 368, name: "exceptional_scroll_of_mining" },
  { id: 369, name: "exceptional_scroll_of_smithing" },
  { id: 370, name: "exceptional_scroll_of_foraging" },
  { id: 371, name: "exceptional_scroll_of_farming" },
  { id: 372, name: "exceptional_scroll_of_agility" },
  { id: 373, name: "exceptional_scroll_of_crafting" },
  { id: 380, name: "exceptional_scroll_of_rigour" },
  { id: 445, name: "exceptional_scroll_of_strength" },
  { id: 446, name: "exceptional_scroll_of_defence" },
  { id: 447, name: "exceptional_scroll_of_magic" },
  { id: 448, name: "exceptional_scroll_of_archery" },
  { id: 449, name: "exceptional_scroll_of_carpentry" },
  { id: 450, name: "exceptional_scroll_of_enchanting" },
  { id: 451, name: "exceptional_scroll_of_brewing" },
  { id: 549, name: "exceptional_scroll_of_cooking" },
  { id: 936, name: "exceptional_scroll_of_exterminating" }
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const MARKET_DIR = path.join(DATA_DIR, "market");
const MARKET_ITEMS_DIR = path.join(MARKET_DIR, "items");
const CONFIG_PATH = path.join(__dirname, "config.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const config = await readJson(CONFIG_PATH);
if (!config.clanName || config.clanName.trim().length === 0) {
  throw new Error("Missing clanName in WebApp/tools/config.json.");
}

const rateLimitPerMinute = Number(config.rateLimitPerMinute || 15);
const minIntervalMs = Math.ceil(60000 / Math.max(rateLimitPerMinute, 1)) + 250;
let nextAvailable = Date.now();

function normalizeClanName(name) {
  return name.trim();
}

function buildUrl(pathname) {
  return `${BASE_URL}${pathname}`;
}

async function rateLimitedFetchJson(url, options = {}) {
  const now = Date.now();
  const wait = Math.max(0, nextAvailable - now);
  if (wait > 0) {
    await sleep(wait);
  }
  const response = await fetch(url, {
    headers: { "User-Agent": "IdleClans-WebApp-Updater" }
  });
  nextAvailable = Date.now() + minIntervalMs;
  if (options.allowNotFound && response.status === 404) {
    return options.notFoundValue ?? null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${url} ${text}`);
  }
  return response.json();
}

async function fetchClanProfile(clanName) {
  const encoded = encodeURIComponent(clanName);
  return rateLimitedFetchJson(buildUrl(`/Clan/recruitment/${encoded}`));
}

async function fetchPlayerProfile(playerName) {
  const encoded = encodeURIComponent(playerName);
  return rateLimitedFetchJson(buildUrl(`/Player/profile/${encoded}`));
}

async function fetchClanLogs(clanName, skip, limit) {
  const encoded = encodeURIComponent(clanName);
  return rateLimitedFetchJson(buildUrl(`/Clan/logs/clan/${encoded}?skip=${skip}&limit=${limit}`));
}

async function fetchPlayerClanLogs(playerName, skip, limit) {
  const encoded = encodeURIComponent(playerName);
  return rateLimitedFetchJson(
    buildUrl(`/Player/clan-logs/${encoded}?skip=${skip}&limit=${limit}`),
    { allowNotFound: true, notFoundValue: [] }
  );
}

async function fetchMarketPrice(itemId) {
  return rateLimitedFetchJson(buildUrl(`/PlayerMarket/items/prices/latest/comprehensive/${itemId}`));
}

function hashMessage(message) {
  if (!message) {
    return "";
  }
  return createHash("sha256").update(message).digest("hex");
}

function normalizeLogEntry(entry, clanName) {
  const normalized = { ...entry };
  if (!normalized.clanName || normalized.clanName.trim().length === 0) {
    normalized.clanName = clanName;
  }
  normalized.messageHash = hashMessage(normalized.message || "");
  return normalized;
}

function logKey(entry) {
  return [
    entry.clanName || "",
    entry.memberUsername || "",
    entry.timestamp || "",
    entry.messageHash || ""
  ].join("|");
}

async function readJson(filePath, fallback = null) {
  try {
    const data = await readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (fallback !== null) {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  await writeFile(filePath, `${json}\n`, "utf8");
}

async function ensureDirs() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(MARKET_ITEMS_DIR, { recursive: true });
}

async function mergeLogs(existingLogs, newLogs, clanName) {
  const merged = [];
  const seen = new Set();
  for (const entry of existingLogs) {
    const normalized = normalizeLogEntry(entry, clanName);
    const key = logKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(normalized);
    }
  }
  for (const entry of newLogs) {
    const normalized = normalizeLogEntry(entry, clanName);
    const key = logKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(normalized);
    }
  }
  merged.sort((a, b) => {
    const ta = Date.parse(a.timestamp || "") || 0;
    const tb = Date.parse(b.timestamp || "") || 0;
    return tb - ta;
  });
  return merged;
}

function formatIsoNow() {
  return new Date().toISOString();
}

function runGit(args, options = {}) {
  return execSync(`git ${args}`, {
    stdio: "pipe",
    cwd: ROOT_DIR,
    ...options
  }).toString("utf8").trim();
}

async function gitCommitAndPush(message) {
  try {
    runGit("rev-parse --is-inside-work-tree");
  } catch {
    console.warn("Not inside a git repository. Skipping git commit/push.");
    return;
  }
  runGit("add data");
  const status = runGit("status --porcelain");
  if (!status) {
    console.log("No data changes to commit.");
    return;
  }
  runGit(`commit -m "${message}"`);
  runGit("push");
}

async function main() {
  const clanName = normalizeClanName(config.clanName);
  const logsSkip = Number(config.logsSkip || 0);
  const logsLimit = Number(config.logsLimit || 500);
  const commitMessage = `${config.gitCommitMessage || "Update data"} ${new Date().toISOString().slice(0, 10)}`;

  await ensureDirs();

  console.log(`Fetching clan profile for "${clanName}"...`);
  const clanProfile = await fetchClanProfile(clanName);
  const members = Array.isArray(clanProfile.memberlist) ? clanProfile.memberlist : [];

  const existingLogs = await readJson(path.join(DATA_DIR, "clan_logs.json"), []);
  const clanLogs = await fetchClanLogs(clanName, logsSkip, logsLimit);
  let mergedLogs = await mergeLogs(existingLogs, clanLogs, clanName);

  const playerProfiles = {};

  for (const member of members) {
    const memberName = member.memberName || member.membername || member.member || member.name;
    if (!memberName) {
      continue;
    }
    console.log(`Fetching profile for ${memberName}...`);
    const profile = await fetchPlayerProfile(memberName);
    playerProfiles[memberName] = profile;

    console.log(`Fetching logs for ${memberName}...`);
    const playerLogs = await fetchPlayerClanLogs(memberName, logsSkip, logsLimit);
    mergedLogs = await mergeLogs(mergedLogs, playerLogs, clanName);
  }

  const marketRows = [];
  for (const item of MARKET_ITEMS) {
    console.log(`Fetching market data for ${item.name} (${item.id})...`);
    const details = await fetchMarketPrice(item.id);
    await writeJson(path.join(MARKET_ITEMS_DIR, `${item.id}.json`), details);
    const lowest = Array.isArray(details?.lowestSellPricesWithVolume)
      ? Math.min(...details.lowestSellPricesWithVolume.map((row) => row.key))
      : null;
    marketRows.push({
      id: item.id,
      name: item.name,
      lowestSellPrice: Number.isFinite(lowest) ? lowest : null
    });
  }

  await writeJson(path.join(DATA_DIR, "clan.json"), {
    ...clanProfile,
    lastUpdated: formatIsoNow()
  });
  await writeJson(path.join(DATA_DIR, "clan_members.json"), members);
  await writeJson(path.join(DATA_DIR, "player_profiles.json"), playerProfiles);
  await writeJson(path.join(DATA_DIR, "clan_logs.json"), mergedLogs);
  await writeJson(path.join(MARKET_DIR, "exceptional_scrolls.json"), marketRows);
  await writeJson(path.join(DATA_DIR, "meta.json"), {
    clanName,
    generatedAt: formatIsoNow(),
    memberCount: members.length,
    logCount: mergedLogs.length
  });

  await gitCommitAndPush(commitMessage);
  console.log("Done.");
}

await main();
