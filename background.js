// background.js — Tabstaq service worker (MV3 module).
//
// Responsibilities:
//   • The grouping engine: read tabs, decide a group name for each, and create
//     / reuse native Chrome tab groups (see computeBuckets).
//   • Toolbar-click, keyboard-command, and popup-message handlers.
//   • Helpers the popup calls: plan (dry-run preview), collapse/expand, dedupe,
//     list/search tabs, and close-a-group.
//
// Group-name priority per tab (see computeBuckets / classifyTab):
//   1. Keyword      — URL/title contains a user keyword.
//   2. Abstraction  — a host|regex rule extracts a name, suffixes stripped;
//                     tabs sharing a name group together.
//   3. Site group   — a fixed-host fallback that absorbs abstraction orphans.
//
// All matching is config-driven (identify.js); nothing is hardcoded.

import { DEFAULT_CONFIG } from './identify.js';
import { computeBuckets, buildUmbrellas } from './grouping.js';

// Keys under which the editable config lives in chrome.storage.sync.
const CONFIG_KEYS = ['excludedHosts', 'extractRules', 'stripSuffixes', 'fixedHostGroups', 'projects'];

// Load config from storage, falling back to DEFAULT_CONFIG per-key.
async function getConfig() {
  const stored = await chrome.storage.sync.get(CONFIG_KEYS);
  const config = {};
  for (const k of CONFIG_KEYS) {
    config[k] = (stored[k] !== undefined && stored[k] !== null) ? stored[k] : DEFAULT_CONFIG[k];
  }
  return config;
}

const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// Hash a name to a preferred palette index (deterministic, stable per name).
function hashIndex(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % COLORS.length;
}

// Assign a DISTINCT color to each group name, collision-aware.
//   - Pinned colors (from Settings colorMap) are honored and reserved first.
//   - Remaining names are processed in sorted order (deterministic run-to-run);
//     each takes its hash-preferred color if still free, else linear-probes to
//     the next free slot.
//   - Only if all 8 colors are exhausted do we wrap and allow reuse.
// Returns Map<name, color>.
function assignColors(names, colorMap) {
  const result = new Map();
  const used = new Set();

  // 1. Pinned colors win and reserve their slot.
  for (const name of names) {
    const explicit = colorMap[name] || colorMap[name.toLowerCase()];
    if (explicit && COLORS.includes(explicit)) {
      result.set(name, explicit);
      used.add(explicit);
    }
  }

  // 2. Everything else, in sorted order for stability.
  const rest = names.filter((n) => !result.has(n)).sort();
  for (const name of rest) {
    let idx = hashIndex(name);
    // Probe forward until we find a free color (or give up after a full lap).
    for (let step = 0; step < COLORS.length && used.has(COLORS[idx]); step++) {
      idx = (idx + 1) % COLORS.length;
    }
    const color = COLORS[idx];
    result.set(name, color);
    used.add(color); // once all 8 are used, used.has() is always true -> reuse begins
  }

  return result;
}

async function getSettings() {
  const {
    customKeywords = [], autoGroup = false, minGroupSize = 2,
    colorMap = {}, emojiMap = {}, autoEmoji = false, collapseOnGroup = true
  } = await chrome.storage.sync.get(
    ['customKeywords', 'autoGroup', 'minGroupSize', 'colorMap', 'emojiMap', 'autoEmoji', 'collapseOnGroup']);
  return { customKeywords, autoGroup, minGroupSize, colorMap, emojiMap, autoEmoji, collapseOnGroup };
}

// Palette of default emojis auto-assigned to groups (when autoEmoji is on and a
// group has no explicit emojiMap entry). Picked by name hash for stability.
const EMOJIS = ['🚀', '🛠️', '📦', '🔧', '⚙️', '🌊', '🔭', '🧭', '⚡', '🧩', '📊', '🔥', '🌐', '🛰️'];

// The label Chrome shows on the group: "<emoji> <name>" or just "<name>".
function labelFor(name, emojiMap, autoEmoji) {
  const explicit = emojiMap[name] || emojiMap[name.toLowerCase()];
  if (explicit) return `${explicit} ${name}`;
  if (autoEmoji) return `${EMOJIS[hashIndex2(name) % EMOJIS.length]} ${name}`;
  return name;
}

// Separate hash for emoji so emoji and color don't always correlate.
function hashIndex2(name) {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  return h;
}

// Strip a leading emoji prefix from a group title to recover its plain name.
// Labels are "<emoji> <name>"; if the first whitespace-delimited token has no
// letters/digits, it's the emoji and we drop it. "🚀 MyProject" -> "MyProject";
// "CR Review" -> "CR Review" (first token has letters, kept).
function plainTitle(title) {
  const sp = title.indexOf(' ');
  if (sp > 0 && !/[A-Za-z0-9]/.test(title.slice(0, sp))) return title.slice(sp + 1);
  return title;
}

// Recover the plain group name from a possibly-decorated existing title, by
// matching against the set of names we're about to assign. Falls back to the
// raw title. This lets us reuse a group titled "🚀 MyProject" for bucket
// "MyProject" instead of creating a duplicate.
function plainNameOf(title, knownNames) {
  if (knownNames.has(title)) return title;
  for (const n of knownNames) {
    if (title === n || title.endsWith(' ' + n)) return n;
  }
  return title;
}


async function targetWindowId(explicitWindowId) {
  if (explicitWindowId) return explicitWindowId;
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  return win.id;
}

// The pure grouping engine (classifyTab/computeBuckets) lives in grouping.js so
// it can be unit-tested without Chrome APIs. See grouping.test.js.

/**
 * @param {number} [windowId]
 * @returns {Promise<{grouped:number, groups:number}>}
 */
async function groupTabs(windowId) {
  const { customKeywords, minGroupSize, colorMap, emojiMap, autoEmoji, collapseOnGroup } = await getSettings();
  const config = await getConfig();
  const winId = await targetWindowId(windowId);
  const tabs = await chrome.tabs.query({ windowId: winId });

  // Custom keywords take priority over config projects.
  const umbrellas = buildUmbrellas(customKeywords, config);

  // Existing groups in this window, by plain name (titles may carry an emoji).
  const existingGroups = await chrome.tabGroups.query({ windowId: winId });
  const groupByName = new Map(existingGroups.map((g) => [plainTitle(g.title), g.id]));
  const existingNames = new Set(groupByName.keys());

  // group name -> tab[] (two-pass: abstraction first, site groups absorb orphans).
  // skipGrouped=true: only act on loose tabs, leaving existing/custom groups intact.
  // existingNames lets a single loose tab join a group that already exists.
  const bucketsTabs = computeBuckets(tabs, umbrellas, config, minGroupSize, true, existingNames);
  const buckets = new Map(); // group name -> [tabId, ...]
  for (const [name, arr] of bucketsTabs) buckets.set(name, arr.map((t) => t.id));

  const liveNames = [...buckets.keys()];
  const colors = assignColors(liveNames, colorMap);

  let grouped = 0;
  let groupCount = 0;

  for (const [name, tabIds] of buckets) {
    groupCount++;

    const color = colors.get(name);
    const title = labelFor(name, emojiMap, autoEmoji);
    let groupId;
    if (groupByName.has(name)) {
      groupId = await chrome.tabs.group({ groupId: groupByName.get(name), tabIds });
    } else {
      groupId = await chrome.tabs.group({ tabIds });
    }
    // Always (re)apply title + color, so reused groups get redecorated too.
    // Collapse on group when enabled (keeps the tab strip tidy).
    await chrome.tabGroups.update(groupId, { title, color, collapsed: collapseOnGroup });
    grouped += tabIds.length;
  }

  return { grouped, groups: groupCount };
}

// Dry-run: compute what groups WOULD be created, for the popup preview.
// Returns [{ name, label, color, count }], sorted by size desc.
async function planGroups(windowId) {
  const { customKeywords, minGroupSize, colorMap, emojiMap, autoEmoji } = await getSettings();
  const config = await getConfig();
  const winId = await targetWindowId(windowId);
  const tabs = await chrome.tabs.query({ windowId: winId });

  const umbrellas = buildUmbrellas(customKeywords, config);

  // Existing groups in this window, with live tab counts.
  const existingGroups = await chrome.tabGroups.query({ windowId: winId });
  const existingNames = new Set(existingGroups.map((g) => plainTitle(g.title)));
  const countInGroup = new Map();
  for (const t of tabs) {
    if (t.groupId === undefined || t.groupId === -1) continue;
    countInGroup.set(t.groupId, (countInGroup.get(t.groupId) || 0) + 1);
  }

  // What loose tabs would add (new groups, or tabs joining an existing one).
  const pending = computeBuckets(tabs, umbrellas, config, minGroupSize, true, existingNames);

  // Build the display list: every existing group + any brand-new pending group.
  // `added` = how many loose tabs would join; `isNew` = group doesn't exist yet.
  const rows = new Map(); // name -> { name, count, added, isNew, color? }
  for (const g of existingGroups) {
    const name = plainTitle(g.title);
    rows.set(name, {
      name,
      count: countInGroup.get(g.id) || 0,
      added: 0,
      isNew: false,
      color: g.color
    });
  }
  for (const [name, arr] of pending) {
    if (rows.has(name)) {
      rows.get(name).added = arr.length;            // joining an existing group
    } else {
      rows.set(name, { name, count: arr.length, added: arr.length, isNew: true });
    }
  }

  // Colors: keep each existing group's real color; assign for new ones.
  const newNames = [...rows.values()].filter((r) => r.isNew).map((r) => r.name);
  const newColors = assignColors(newNames, colorMap);

  return [...rows.values()]
    .map((r) => ({
      name: r.name,
      label: labelFor(r.name, emojiMap, autoEmoji),
      color: r.color || newColors.get(r.name),
      count: r.count,
      added: r.added,
      isNew: r.isNew
    }))
    .sort((a, b) => b.count - a.count);
}

async function ungroupAll(windowId) {
  const winId = await targetWindowId(windowId);
  const tabs = await chrome.tabs.query({ windowId: winId });
  const grouped = tabs.filter((t) => t.groupId !== -1).map((t) => t.id);
  if (grouped.length) await chrome.tabs.ungroup(grouped);
  return { ungrouped: grouped.length };
}

// Collapse or expand every tab group in the window.
async function setGroupsCollapsed(windowId, collapsed) {
  const winId = await targetWindowId(windowId);
  const groups = await chrome.tabGroups.query({ windowId: winId });
  for (const g of groups) {
    await chrome.tabGroups.update(g.id, { collapsed });
  }
  return { affected: groups.length };
}

// Normalize a URL for duplicate comparison: drop hash + common tracking params.
function dedupeKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'ref_'].forEach((p) => u.searchParams.delete(p));
    u.searchParams.sort();
    return u.toString();
  } catch (e) {
    return rawUrl;
  }
}

// Close duplicate tabs in the window, keeping the oldest (or active) of each set.
async function closeDuplicates(windowId) {
  const winId = await targetWindowId(windowId);
  const tabs = await chrome.tabs.query({ windowId: winId });
  const seen = new Map(); // key -> tab we keep
  const toClose = [];
  for (const tab of tabs) {
    if (tab.pinned) continue;
    const key = dedupeKey(tab.url || '');
    if (!seen.has(key)) {
      seen.set(key, tab);
      continue;
    }
    // Decide which to keep: prefer the active tab, else the lower index (older).
    const kept = seen.get(key);
    const keepNew = tab.active || (!kept.active && tab.index < kept.index);
    if (keepNew) { toClose.push(kept.id); seen.set(key, tab); }
    else { toClose.push(tab.id); }
  }
  if (toClose.length) await chrome.tabs.remove(toClose);
  return { closed: toClose.length };
}

// List tabs in the window for the popup's search/jump feature.
async function listTabs(windowId) {
  const winId = await targetWindowId(windowId);
  const tabs = await chrome.tabs.query({ windowId: winId });
  return {
    tabs: tabs.map((t) => ({
      id: t.id, title: t.title || '', url: t.url || '',
      favIconUrl: t.favIconUrl || '', active: t.active
    }))
  };
}

// Activate a tab (and focus its window) for search/jump.
async function focusTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { ok: true };
}

// List the EXISTING native tab groups in the window (for the "close group" UI).
async function listGroups(windowId) {
  const winId = await targetWindowId(windowId);
  const groups = await chrome.tabGroups.query({ windowId: winId });
  const tabs = await chrome.tabs.query({ windowId: winId });
  const countByGroup = new Map();
  for (const t of tabs) {
    if (t.groupId === -1) continue;
    countByGroup.set(t.groupId, (countByGroup.get(t.groupId) || 0) + 1);
  }
  return {
    groups: groups.map((g) => ({
      id: g.id,
      title: g.title || '(unnamed)',
      color: g.color,
      collapsed: g.collapsed,
      count: countByGroup.get(g.id) || 0
    })).sort((a, b) => b.count - a.count)
  };
}

// Close every tab in a given native group (by id).
async function closeGroup(groupId) {
  const tabs = await chrome.tabs.query({ groupId });
  const ids = tabs.map((t) => t.id);
  if (ids.length) await chrome.tabs.remove(ids);
  return { closed: ids.length };
}

// Close every tab that belongs to a group NAME -- works whether the tabs are
// already in a native group or just match the rules. Never closes pinned tabs.
async function closeGroupByName(windowId, name) {
  const { customKeywords, minGroupSize } = await getSettings();
  const config = await getConfig();
  const winId = await targetWindowId(windowId);
  const tabs = await chrome.tabs.query({ windowId: winId });

  const umbrellas = buildUmbrellas(customKeywords, config);

  // Use the same two-pass bucketing the preview/grouping use, so "close group X"
  // closes exactly the tabs that the chip for X represents.
  const buckets = computeBuckets(tabs, umbrellas, config, minGroupSize);
  const arr = buckets.get(name) || [];
  const ids = arr.map((t) => t.id);
  if (ids.length) await chrome.tabs.remove(ids);
  return { closed: ids.length, name };
}

chrome.action.onClicked.addListener((tab) => { groupTabs(tab.windowId); });

// Keyboard shortcuts (configurable at chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener(async (command) => {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  if (command === 'group-tabs') groupTabs(win.id);
  else if (command === 'ungroup-tabs') ungroupAll(win.id);
  else if (command === 'collapse-groups') setGroupsCollapsed(win.id, true);
  else if (command === 'expand-groups') setGroupsCollapsed(win.id, false);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'group') sendResponse(await groupTabs(msg.windowId));
      else if (msg.type === 'ungroup') sendResponse(await ungroupAll(msg.windowId));
      else if (msg.type === 'plan') sendResponse({ plan: await planGroups(msg.windowId) });
      else if (msg.type === 'collapse') sendResponse(await setGroupsCollapsed(msg.windowId, true));
      else if (msg.type === 'expand') sendResponse(await setGroupsCollapsed(msg.windowId, false));
      else if (msg.type === 'closeDuplicates') sendResponse(await closeDuplicates(msg.windowId));
      else if (msg.type === 'listTabs') sendResponse(await listTabs(msg.windowId));
      else if (msg.type === 'focusTab') sendResponse(await focusTab(msg.tabId));
      else if (msg.type === 'listGroups') sendResponse(await listGroups(msg.windowId));
      else if (msg.type === 'closeGroup') sendResponse(await closeGroup(msg.groupId));
      else if (msg.type === 'closeGroupByName') sendResponse(await closeGroupByName(msg.windowId, msg.name));
      else sendResponse({ error: 'unknown message' });
    } catch (e) {
      sendResponse({ error: String(e && e.message || e) });
    }
  })();
  return true;
});

let debounceTimer = null;
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const { autoGroup } = await getSettings();
  if (!autoGroup) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => groupTabs(tab.windowId), 800);
});
