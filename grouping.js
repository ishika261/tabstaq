// grouping.js
//
// The pure grouping engine: given a list of tabs and the user's config, decide
// which group each tab belongs to. No Chrome APIs here — everything is plain
// functions over plain data, so this module is fully unit-testable in Node
// (see grouping.test.js). background.js wraps these with the chrome.* calls.

import { extractId, fixedGroup } from './identify.js';

// Classify a single tab into its candidate group, recording WHY (kind) so the
// two-pass step can re-route abstraction singletons to their site bucket.
// Returns { key, kind, site } or null.
//   kind 'keyword'     -> final, never re-routed.
//   kind 'abstraction' -> club by name IF >=minGroupSize, else fall to `site`.
//   kind 'site'        -> the tab only matched a fixed-host rule.
// `site` is the fixed-host group name if any (used as the fallback bucket).
function classifyTab(tab, umbrellas, config) {
  const hay = ((tab.url || '') + ' ' + (tab.title || '')).toLowerCase();
  const site = fixedGroup(tab.url || '', config); // may be null

  // 1. Keyword override — wins outright.
  for (const u of umbrellas) {
    if (hay.includes(u.lower)) return { key: u.token, kind: 'keyword', site };
  }
  // 2. Abstraction — extracted + suffix-stripped name.
  const res = extractId(tab.url || '', config);
  if (res) return { key: res.id, kind: 'abstraction', site };
  // 3. Site only.
  if (site) return { key: site, kind: 'site', site };
  return null;
}

// Two-pass bucketing shared by grouping + preview.
// Returns Map<groupName, tabObj[]> for groups that should exist.
// skipGrouped: when true, tabs already in ANY tab group are ignored, so existing
//   (incl. hand-made "custom") groups are never disturbed — grouping only acts on
//   loose tabs. Set false for actions that must see every tab (e.g. close-group).
// existingNames: plain names of groups that already exist in the window. A bucket
//   matching one of these survives even with a single tab, so a lone loose tab can
//   JOIN an existing group (and won't be re-routed to a site fallback).
function computeBuckets(tabs, umbrellas, config, minGroupSize, skipGrouped = false, existingNames = new Set()) {
  // Pass 1: classify every (non-pinned) tab and tally abstraction names.
  const classified = [];
  const absCount = new Map(); // abstraction name -> tab count
  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (skipGrouped && tab.groupId !== undefined && tab.groupId !== -1) continue;
    const c = classifyTab(tab, umbrellas, config);
    if (!c) continue;
    classified.push({ tab, ...c });
    if (c.kind === 'abstraction') absCount.set(c.key, (absCount.get(c.key) || 0) + 1);
  }

  // Pass 2: assign final group. An abstraction name that didn't reach
  // minGroupSize is an orphan -> re-route to its site bucket -- UNLESS a group of
  // that name already exists, in which case keep the name so the tab joins it.
  const buckets = new Map();
  for (const item of classified) {
    let name = item.key;
    if (item.kind === 'abstraction'
        && absCount.get(item.key) < minGroupSize
        && !existingNames.has(item.key)) {
      if (!item.site) continue; // lonely and no site -> leave ungrouped
      name = item.site;
    }
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push(item.tab);
  }

  // Keep a bucket if it meets the size threshold OR a group of that name already
  // exists (so a single tab can merge into it).
  for (const [name, arr] of [...buckets]) {
    if (arr.length < minGroupSize && !existingNames.has(name)) buckets.delete(name);
  }
  return buckets;
}

// Build the `umbrellas` list (keyword overrides) from config + custom keywords.
function buildUmbrellas(customKeywords, config) {
  return [...(customKeywords || []), ...((config && config.projects) || [])]
    .filter(Boolean)
    .map((t) => ({ token: t, lower: t.toLowerCase() }));
}

// From all computed buckets, keep only the ones that are SPLIT across windows:
// a bucket with at least one tab in the target window AND at least one tab in
// another window. Used by the cross-window "Group across windows" action so it
// only relocates tabs that genuinely need consolidating — a group living wholly
// in one window (target or elsewhere) is left untouched. Each tab is expected to
// carry a `windowId`. Returns [{ name, tabs, foreign }] where `foreign` is the
// subset of `tabs` that lives outside the target window (the tabs to move).
function splitBuckets(buckets, targetWindowId) {
  const out = [];
  for (const [name, tabs] of buckets) {
    const foreign = tabs.filter((t) => t.windowId !== targetWindowId);
    const hasLocal = tabs.some((t) => t.windowId === targetWindowId);
    if (hasLocal && foreign.length > 0) out.push({ name, tabs, foreign });
  }
  return out;
}

export { classifyTab, computeBuckets, buildUmbrellas, splitBuckets };
