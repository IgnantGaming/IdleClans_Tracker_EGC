const DATA_BASE = "data";
const ASSET_BASE = "assets";
const MAX_LOG_ROWS = 1000;
const SKILL_ORDER = [
  "attack",
  "strength",
  "defence",
  "archery",
  "magic",
  "health",
  "crafting",
  "woodcutting",
  "carpentry",
  "fishing",
  "cooking",
  "mining",
  "smithing",
  "foraging",
  "farming",
  "agility",
  "plundering",
  "enchanting",
  "brewing",
  "exterminating"
];

const state = {
  clan: null,
  members: [],
  profiles: {},
  logs: [],
  market: [],
  levelEntries: [],
  goldTotals: null,
  weeklyGold: new Map()
};

const elements = {
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  refreshButton: document.getElementById("refresh-view"),
  clanName: document.getElementById("clan-name"),
  clanTag: document.getElementById("clan-tag"),
  metaUpdated: document.getElementById("meta-updated"),
  metaMembers: document.getElementById("meta-members"),
  statActivity: document.getElementById("stat-activity"),
  statMembers: document.getElementById("stat-members"),
  statUpdated: document.getElementById("stat-updated"),
  statGoldTotal: document.getElementById("stat-gold-total"),
  notifications: document.getElementById("notifications"),
  offlineThreshold: document.getElementById("offline-threshold"),
  membersTable: document.getElementById("members-table").querySelector("tbody"),
  logsTable: document.getElementById("logs-table").querySelector("tbody"),
  filterMember: document.getElementById("filter-member"),
  filterMessage: document.getElementById("filter-message"),
  filterStart: document.getElementById("filter-start"),
  filterEnd: document.getElementById("filter-end"),
  clearLogFilters: document.getElementById("clear-log-filters"),
  goldWeek: document.getElementById("gold-week"),
  goldTable: document.getElementById("gold-table").querySelector("tbody"),
  playerLogsSelect: document.getElementById("player-logs-select"),
  playerLogsTable: document.getElementById("player-logs-table").querySelector("tbody"),
  compareA: document.getElementById("compare-a"),
  compareB: document.getElementById("compare-b"),
  compareTierA: document.getElementById("compare-tier-a"),
  compareTierB: document.getElementById("compare-tier-b"),
  compareTable: document.getElementById("compare-table").querySelector("tbody"),
  marketTable: document.getElementById("market-table").querySelector("tbody"),
  playerModal: document.getElementById("player-modal"),
  playerModalTitle: document.getElementById("player-modal-title"),
  playerModalSubtitle: document.getElementById("player-modal-subtitle"),
  playerSkillGrid: document.getElementById("player-skill-grid"),
  playerSummary: document.getElementById("player-summary"),
  playerWithdrawTable: document.getElementById("player-withdraw-table").querySelector("tbody"),
  playerDepositTable: document.getElementById("player-deposit-table").querySelector("tbody"),
  marketModal: document.getElementById("market-modal"),
  marketModalTitle: document.getElementById("market-modal-title"),
  marketSummary: document.getElementById("market-summary"),
  marketSellTable: document.getElementById("market-sell-table").querySelector("tbody"),
  marketBuyTable: document.getElementById("market-buy-table").querySelector("tbody")
};

const WITHDRAW_RE = /^(.+?) withdrew (\d+)x (.+?)[.]?$/i;
const DEPOSIT_RE = /^(.+?) added (\d+)x (.+?)[.]?$/i;
const GOLD_RE = /^(.+?) added (\d+)x Gold[.]?$/i;

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat().format(value);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function loadOfflineThreshold() {
  const stored = localStorage.getItem("offlineThreshold");
  const value = stored ? Number(stored) : 12;
  elements.offlineThreshold.value = Number.isFinite(value) ? value : 12;
}

function saveOfflineThreshold() {
  localStorage.setItem("offlineThreshold", elements.offlineThreshold.value);
  renderMembers();
  renderNotifications();
}

function toPacificDate(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
}

function getPacificWeekStart(date) {
  const pacific = toPacificDate(date);
  const weekStart = new Date(pacific);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - day);
  weekStart.setHours(16, 0, 0, 0);
  if (pacific < weekStart) {
    weekStart.setDate(weekStart.getDate() - 7);
  }
  return weekStart;
}

function formatPacificRange(weekStart) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 7);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short"
  });
  return `${fmt.format(weekStart)} - ${fmt.format(end)}`;
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

async function loadLevels() {
  const response = await fetch(`${ASSET_BASE}/levels.csv`);
  if (!response.ok) {
    throw new Error("Missing levels.csv");
  }
  const text = await response.text();
  const entries = [];
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const parts = trimmed.split(",");
    if (parts.length < 3) {
      return;
    }
    const level = Number(parts[0].trim());
    const xpNeeded = Number(parts[1].trim());
    const diff = Number(parts[2].trim());
    if (Number.isFinite(level) && Number.isFinite(xpNeeded) && Number.isFinite(diff)) {
      entries.push({ level, xpNeeded, diff });
    }
  });
  state.levelEntries = entries;
}

function resolveLevel(xp) {
  if (!state.levelEntries.length) {
    return { level: 0, xpNeeded: 0, diff: 0 };
  }
  let current = state.levelEntries[0];
  for (const entry of state.levelEntries) {
    if (xp >= entry.xpNeeded) {
      current = entry;
    } else {
      break;
    }
  }
  return current;
}

function getXpForLevel(level) {
  for (const entry of state.levelEntries) {
    if (entry.level === level) {
      return entry.xpNeeded;
    }
  }
  return state.levelEntries[state.levelEntries.length - 1]?.xpNeeded || 0;
}

function parseWithdraw(message) {
  const match = message?.trim().match(WITHDRAW_RE);
  if (!match) {
    return null;
  }
  return { item: match[3].trim(), amount: Number(match[2]) };
}

function parseDeposit(message) {
  const match = message?.trim().match(DEPOSIT_RE);
  if (!match) {
    return null;
  }
  return { item: match[3].trim(), amount: Number(match[2]) };
}

function parseGold(message) {
  const match = message?.trim().match(GOLD_RE);
  if (!match) {
    return null;
  }
  return Number(match[2]);
}

function getProfile(name) {
  return state.profiles?.[name] || null;
}

function getHoursOffline(profile) {
  if (!profile || profile.hoursOffline === undefined || profile.hoursOffline === null) {
    return null;
  }
  return Number(profile.hoursOffline);
}

function isActive(profile) {
  if (!profile) {
    return null;
  }
  const taskName = profile.taskNameOnLogout;
  const hasTaskName = taskName && taskName.trim().length > 0;
  const hasTaskType = Number(profile.taskTypeOnLogout) !== 0;
  return hasTaskName && hasTaskType;
}

function getMemberLogs(memberName, limit = 0) {
  const logs = state.logs.filter(
    (entry) => entry.memberUsername?.toLowerCase() === memberName.toLowerCase()
  );
  if (limit > 0) {
    return logs.slice(0, limit);
  }
  return logs;
}

function computeGoldTotals() {
  const weeklyTotals = new Map();
  let totalAllTime = 0;
  for (const entry of state.logs) {
    const amount = parseGold(entry.message);
    if (amount === null || Number.isNaN(amount)) {
      continue;
    }
    totalAllTime += amount;
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : null;
    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      continue;
    }
    const weekStart = getPacificWeekStart(timestamp);
    const weekKey = weekStart.getTime();
    if (!weeklyTotals.has(weekKey)) {
      weeklyTotals.set(weekKey, new Map());
    }
    const totals = weeklyTotals.get(weekKey);
    const member = entry.memberUsername || "Unknown";
    totals.set(member, (totals.get(member) || 0) + amount);
  }
  state.weeklyGold = weeklyTotals;
  state.goldTotals = totalAllTime || null;
}

function renderHeader() {
  const clan = state.clan;
  elements.clanName.textContent = clan?.clanName || "Idle Clans";
  elements.clanTag.textContent = clan?.tag || "-";
  elements.statActivity.textContent = clan?.activityScore?.toFixed(2) || "-";
  elements.statMembers.textContent = state.members.length || "-";
  elements.statUpdated.textContent = formatDate(clan?.lastUpdated);
  elements.statGoldTotal.textContent = state.goldTotals ? formatNumber(state.goldTotals) : "-";
  elements.metaUpdated.textContent = formatDate(clan?.lastUpdated);
  elements.metaMembers.textContent = state.members.length || "-";
}

function renderNotifications() {
  const threshold = Number(elements.offlineThreshold.value || 0);
  const alerts = [];
  for (const member of state.members) {
    const profile = getProfile(member.memberName);
    const hours = getHoursOffline(profile);
    const active = isActive(profile);
    if (hours !== null && hours >= threshold) {
      alerts.push(`${member.memberName} offline ${hours.toFixed(1)}h`);
    }
    if (active === false) {
      alerts.push(`${member.memberName} inactive`);
    }
  }
  elements.notifications.textContent = alerts.length ? alerts.join(" | ") : "No alerts.";
}

function renderMembers() {
  elements.membersTable.innerHTML = "";
  const threshold = Number(elements.offlineThreshold.value || 0);
  const weeklyTotals = state.weeklyGold;
  const latestWeekKey = [...weeklyTotals.keys()].sort((a, b) => b - a)[0];
  const weekly = latestWeekKey ? weeklyTotals.get(latestWeekKey) : new Map();
  const rows = [...state.members].sort((a, b) => (b.rank || 0) - (a.rank || 0));

  for (const member of rows) {
    const profile = getProfile(member.memberName);
    const hours = getHoursOffline(profile);
    const active = isActive(profile);
    const gold = weekly?.get(member.memberName) || null;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="link-cell">${member.memberName}</td>
      <td>${member.rank ?? "-"}</td>
      <td>${hours === null ? "-" : hours.toFixed(1)}</td>
      <td>${active === null ? "-" : active ? "Active" : "Inactive"}</td>
      <td>${gold === null ? "-" : formatNumber(gold)}</td>
    `;
    if (hours !== null && hours >= threshold) {
      row.classList.add("warn-row");
    }
    row.addEventListener("click", () => openPlayerModal(member.memberName));
    elements.membersTable.appendChild(row);
  }
}

function renderLogs() {
  const memberFilter = elements.filterMember.value.trim().toLowerCase();
  const messageFilter = elements.filterMessage.value.trim().toLowerCase();
  const startValue = elements.filterStart.value;
  const endValue = elements.filterEnd.value;
  const startDate = startValue ? new Date(startValue) : null;
  const endDate = endValue ? new Date(endValue) : null;

  const filtered = state.logs.filter((entry) => {
    const member = entry.memberUsername?.toLowerCase() || "";
    const message = entry.message?.toLowerCase() || "";
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : null;
    if (memberFilter && !member.includes(memberFilter)) {
      return false;
    }
    if (messageFilter && !message.includes(messageFilter)) {
      return false;
    }
    if (startDate && timestamp && timestamp < startDate) {
      return false;
    }
    if (endDate && timestamp && timestamp > endDate) {
      return false;
    }
    return true;
  });

  const slice = filtered.slice(0, MAX_LOG_ROWS);
  elements.logsTable.innerHTML = "";
  for (const entry of slice) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatDate(entry.timestamp)}</td>
      <td>${entry.memberUsername || "-"}</td>
      <td>${entry.message || "-"}</td>
    `;
    elements.logsTable.appendChild(row);
  }
}

function renderGoldLogs() {
  elements.goldWeek.innerHTML = "";
  const weeks = [...state.weeklyGold.keys()].sort((a, b) => b - a);
  weeks.forEach((weekKey, index) => {
    const option = document.createElement("option");
    option.value = weekKey;
    option.textContent = formatPacificRange(new Date(Number(weekKey)));
    if (index === 0) {
      option.selected = true;
    }
    elements.goldWeek.appendChild(option);
  });
  updateGoldTable();
}

function updateGoldTable() {
  elements.goldTable.innerHTML = "";
  const key = elements.goldWeek.value;
  if (!key) {
    return;
  }
  const totals = state.weeklyGold.get(Number(key));
  if (!totals) {
    return;
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  for (const [member, total] of sorted) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${member}</td>
      <td>${formatNumber(total)}</td>
    `;
    elements.goldTable.appendChild(row);
  }
}

function renderPlayerLogs() {
  elements.playerLogsTable.innerHTML = "";
  const name = elements.playerLogsSelect.value;
  if (!name) {
    return;
  }
  const logs = getMemberLogs(name, 0);
  for (const entry of logs) {
    const withdraw = parseWithdraw(entry.message);
    if (withdraw) {
      appendPlayerLogRow(entry, "Withdraw", withdraw.item, withdraw.amount);
    }
    const deposit = parseDeposit(entry.message);
    if (deposit) {
      appendPlayerLogRow(entry, "Deposit", deposit.item, deposit.amount);
    }
  }
}

function appendPlayerLogRow(entry, type, item, amount) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${formatDate(entry.timestamp)}</td>
    <td>${type}</td>
    <td>${item}</td>
    <td>${formatNumber(amount)}</td>
  `;
  elements.playerLogsTable.appendChild(row);
}

function renderCompare() {
  elements.compareTable.innerHTML = "";
  const aName = elements.compareA.value;
  const bName = elements.compareB.value;
  if (!aName || !bName) {
    return;
  }
  const a = getProfile(aName);
  const b = getProfile(bName);
  if (!a || !b) {
    elements.compareTierA.textContent = "";
    elements.compareTierB.textContent = "";
    return;
  }
  elements.compareTierA.innerHTML = buildTierSummary(a);
  elements.compareTierB.innerHTML = buildTierSummary(b);
  const xp120 = getXpForLevel(120);
  for (const skill of SKILL_ORDER) {
    const aXp = Number(a.skillExperiences?.[skill] || 0);
    const bXp = Number(b.skillExperiences?.[skill] || 0);
    const aLevel = resolveLevel(aXp).level;
    const bLevel = resolveLevel(bXp).level;
    const leader = compareLeader(aLevel, aXp, bLevel, bXp);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${skill}</td>
      <td>${aLevel}</td>
      <td>${formatNumber(aXp)}</td>
      <td>${formatPercent(aXp, xp120)}</td>
      <td>${bLevel}</td>
      <td>${formatNumber(bXp)}</td>
      <td>${formatPercent(bXp, xp120)}</td>
      <td>${leader}</td>
    `;
    elements.compareTable.appendChild(row);
  }
}

function buildTierSummary(profile) {
  let minLevel = Infinity;
  for (const skill of SKILL_ORDER) {
    const xp = Number(profile.skillExperiences?.[skill] || 0);
    const level = resolveLevel(xp).level;
    minLevel = Math.min(minLevel, level);
  }
  if (!Number.isFinite(minLevel)) {
    minLevel = 0;
  }
  const tiers = [90, 100, 110, 120];
  const lines = tiers.map((req, index) => {
    const pct = minLevel >= req ? "Completed" : `${((minLevel / req) * 100).toFixed(1)}%`;
    return `Tier ${index + 1} (${req}): ${pct}`;
  });
  const nextReq = tiers.find((req) => minLevel < req) || null;
  const nextLine = nextReq
    ? `Next Goal: Tier ${tiers.indexOf(nextReq) + 1} (${nextReq}) - ${(
        (minLevel / nextReq) *
        100
      ).toFixed(1)}%`
    : "Next Goal: Completed";
  return `<div>${lines.join("<br>")}<br>${nextLine}</div>`;
}

function compareLeader(aLevel, aXp, bLevel, bXp) {
  if (aLevel > bLevel) {
    return "A";
  }
  if (bLevel > aLevel) {
    return "B";
  }
  if (aXp > bXp) {
    return "A";
  }
  if (bXp > aXp) {
    return "B";
  }
  return "-";
}

function formatPercent(xp, total) {
  if (!total) {
    return "-";
  }
  return `${Math.min(100, (xp / total) * 100).toFixed(1)}%`;
}

function renderMarket() {
  elements.marketTable.innerHTML = "";
  for (const item of state.market) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="link-cell">${displayMarketName(item.name)}</td>
      <td>${item.lowestSellPrice ? formatNumber(item.lowestSellPrice) : "-"}</td>
    `;
    row.addEventListener("click", () => openMarketModal(item));
    elements.marketTable.appendChild(row);
  }
}

function displayMarketName(name) {
  const base = name.replace("exceptional_scroll_of_", "").replace(/_/g, " ");
  return `Exceptional Scroll of ${base.replace(/\b\w/g, (c) => c.toUpperCase())}`;
}

async function openMarketModal(item) {
  elements.marketModalTitle.textContent = displayMarketName(item.name);
  elements.marketSummary.innerHTML = "";
  elements.marketSellTable.innerHTML = "";
  elements.marketBuyTable.innerHTML = "";
  const details = await loadJson(`${DATA_BASE}/market/items/${item.id}.json`);
  elements.marketSummary.innerHTML = `
    <div class="stat"><div class="stat-label">Avg 1d</div><div class="stat-value">${formatNumber(details.averagePrice1Day)}</div></div>
    <div class="stat"><div class="stat-label">Avg 7d</div><div class="stat-value">${formatNumber(details.averagePrice7Days)}</div></div>
    <div class="stat"><div class="stat-label">Avg 30d</div><div class="stat-value">${formatNumber(details.averagePrice30Days)}</div></div>
    <div class="stat"><div class="stat-label">Volume 1d</div><div class="stat-value">${formatNumber(details.tradeVolume1Day)}</div></div>
  `;
  for (const row of details.lowestSellPricesWithVolume || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${formatNumber(row.key)}</td><td>${formatNumber(row.value)}</td>`;
    elements.marketSellTable.appendChild(tr);
  }
  for (const row of details.highestBuyPricesWithVolume || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${formatNumber(row.key)}</td><td>${formatNumber(row.value)}</td>`;
    elements.marketBuyTable.appendChild(tr);
  }
  openModal(elements.marketModal);
}

function openPlayerModal(memberName) {
  const profile = getProfile(memberName);
  if (!profile) {
    return;
  }
  elements.playerModalTitle.textContent = `Player Details - ${memberName}`;
  elements.playerModalSubtitle.textContent = `${profile.gameMode || "-"} | Guild: ${profile.guildName || "-"}`;
  elements.playerSkillGrid.innerHTML = "";
  for (const skill of SKILL_ORDER) {
    const xp = Number(profile.skillExperiences?.[skill] || 0);
    const info = resolveLevel(xp);
    const card = document.createElement("div");
    card.className = "skill-card";
    card.innerHTML = `
      <img src="${ASSET_BASE}/images/${skill}.png" alt="${skill}" />
      <div>${formatSkillLabel(skill, info.level)}</div>
    `;
    elements.playerSkillGrid.appendChild(card);
  }
  const taskDisplay =
    profile.taskNameOnLogout && profile.taskNameOnLogout.trim().length
      ? profile.taskNameOnLogout
      : "-";
  const goldTotal = totalGoldForMember(memberName);
  elements.playerSummary.textContent = `Hours offline: ${profile.hoursOffline ?? "-"} | Task type: ${
    profile.taskTypeOnLogout ?? "-"
  } | Task: ${taskDisplay} | Gold donated: ${goldTotal ? formatNumber(goldTotal) : "-"}`;
  renderPlayerAggregates(memberName);
  openModal(elements.playerModal);
}

function totalGoldForMember(memberName) {
  let total = 0;
  for (const entry of state.logs) {
    if (entry.memberUsername?.toLowerCase() !== memberName.toLowerCase()) {
      continue;
    }
    const amount = parseGold(entry.message);
    if (amount !== null && !Number.isNaN(amount)) {
      total += amount;
    }
  }
  return total || null;
}

function formatSkillLabel(skill, level) {
  const tiers = [90, 100, 110, 120];
  let tierValue = 0;
  let nextTier = 0;
  for (const req of tiers) {
    if (level >= req) {
      tierValue += 1;
    } else if (nextTier === 0) {
      nextTier = req;
    }
  }
  const tierText = tierValue === 0 ? "T0" : `T${tierValue}`;
  const pct = nextTier === 0 ? 100 : Math.min(100, (level / nextTier) * 100);
  const label = skill.charAt(0).toUpperCase() + skill.slice(1);
  return `${label}<br>${level} ${tierText} ${pct.toFixed(1)}%`;
}

function renderPlayerAggregates(memberName) {
  elements.playerWithdrawTable.innerHTML = "";
  elements.playerDepositTable.innerHTML = "";
  const logs = getMemberLogs(memberName, 200);
  const withdraws = new Map();
  const deposits = new Map();
  for (const entry of logs) {
    const when = entry.timestamp ? new Date(entry.timestamp) : null;
    const withdraw = parseWithdraw(entry.message);
    if (withdraw) {
      accumulateAggregate(withdraws, withdraw, when);
    }
    const deposit = parseDeposit(entry.message);
    if (deposit) {
      accumulateAggregate(deposits, deposit, when);
    }
  }
  renderAggregateTable(elements.playerWithdrawTable, withdraws);
  renderAggregateTable(elements.playerDepositTable, deposits);
}

function accumulateAggregate(map, entry, when) {
  const current = map.get(entry.item) || { total: 0, latest: null };
  current.total += entry.amount;
  if (when && (!current.latest || when > current.latest)) {
    current.latest = when;
  }
  map.set(entry.item, current);
}

function renderAggregateTable(target, map) {
  const rows = [...map.entries()].sort((a, b) => {
    const ad = a[1].latest ? a[1].latest.getTime() : 0;
    const bd = b[1].latest ? b[1].latest.getTime() : 0;
    return bd - ad;
  });
  for (const [item, data] of rows) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatNumber(data.total)}x ${item}</td>
      <td>${data.latest ? formatDate(data.latest) : "-"}</td>
    `;
    target.appendChild(row);
  }
}

function openModal(modal) {
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  modal.setAttribute("aria-hidden", "true");
}

function registerModalHandlers() {
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-close");
      closeModal(document.getElementById(id));
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal(elements.playerModal);
      closeModal(elements.marketModal);
    }
  });
}

function registerNavHandlers() {
  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.getAttribute("data-view");
      elements.navItems.forEach((node) => node.classList.remove("active"));
      item.classList.add("active");
      elements.views.forEach((section) => {
        section.classList.toggle("active", section.getAttribute("data-view") === view);
      });
    });
  });
}

function registerFilters() {
  const rerenderLogs = () => renderLogs();
  elements.filterMember.addEventListener("input", rerenderLogs);
  elements.filterMessage.addEventListener("input", rerenderLogs);
  elements.filterStart.addEventListener("change", rerenderLogs);
  elements.filterEnd.addEventListener("change", rerenderLogs);
  elements.clearLogFilters.addEventListener("click", () => {
    elements.filterMember.value = "";
    elements.filterMessage.value = "";
    elements.filterStart.value = "";
    elements.filterEnd.value = "";
    renderLogs();
  });
  elements.goldWeek.addEventListener("change", updateGoldTable);
  elements.playerLogsSelect.addEventListener("change", renderPlayerLogs);
  elements.compareA.addEventListener("change", renderCompare);
  elements.compareB.addEventListener("change", renderCompare);
  elements.offlineThreshold.addEventListener("change", saveOfflineThreshold);
}

async function loadData() {
  const [meta, clan, members, profiles, logs, market] = await Promise.all([
    loadJson(`${DATA_BASE}/meta.json`).catch(() => null),
    loadJson(`${DATA_BASE}/clan.json`),
    loadJson(`${DATA_BASE}/clan_members.json`),
    loadJson(`${DATA_BASE}/player_profiles.json`),
    loadJson(`${DATA_BASE}/clan_logs.json`),
    loadJson(`${DATA_BASE}/market/exceptional_scrolls.json`)
  ]);
  state.clan = clan;
  state.members = members || [];
  state.profiles = profiles || {};
  state.logs = logs || [];
  state.market = market || [];
  if (meta?.generatedAt) {
    state.clan.lastUpdated = meta.generatedAt;
  }
}

async function renderAll() {
  computeGoldTotals();
  renderHeader();
  renderNotifications();
  renderMembers();
  renderLogs();
  renderGoldLogs();
  renderPlayerLogs();
  renderCompare();
  renderMarket();
  populateSelects();
}

function populateSelects() {
  const names = state.members.map((m) => m.memberName).filter(Boolean);
  populateSelect(elements.playerLogsSelect, names);
  populateSelect(elements.compareA, names);
  populateSelect(elements.compareB, names, 1);
}

function populateSelect(select, names, defaultIndex = 0) {
  select.innerHTML = "";
  names.forEach((name, index) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (index === defaultIndex) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

async function init() {
  try {
    await loadLevels();
    await loadData();
    loadOfflineThreshold();
    registerNavHandlers();
    registerFilters();
    registerModalHandlers();
    await renderAll();
    elements.refreshButton.addEventListener("click", async () => {
      await loadData();
      await renderAll();
    });
  } catch (error) {
    console.error(error);
    elements.notifications.textContent = "Failed to load data. Run the updater and refresh.";
  }
}

document.addEventListener("DOMContentLoaded", init);
