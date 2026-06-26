import {
  DEFAULT_CONFIG,
  parseLines,
  parseExtractRules, serializeExtractRules,
  parseFixedGroups, serializeFixedGroups
} from './identify.js';

const $ = (id) => document.getElementById(id);
const VALID_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// colorMap <-> "Name = color" lines.
function colorMapToText(map) {
  return Object.entries(map || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
}
function parseColorMap(text) {
  const map = {};
  for (const line of (text || '').split('\n')) {
    const m = line.match(/^\s*(.+?)\s*=\s*(\w+)\s*$/);
    if (!m) continue;
    const name = m[1].trim();
    const color = m[2].trim().toLowerCase();
    if (name && VALID_COLORS.includes(color)) map[name] = color;
  }
  return map;
}

// emojiMap <-> "Name = 🚀" lines (value can be any non-space emoji/text).
function emojiMapToText(map) {
  return Object.entries(map || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
}
function parseEmojiMap(text) {
  const map = {};
  for (const line of (text || '').split('\n')) {
    const m = line.match(/^\s*(.+?)\s*=\s*(\S+)\s*$/);
    if (m) map[m[1].trim()] = m[2].trim();
  }
  return map;
}

// Populate the rule/config fields. Note: legacy "projects" are folded into the
// single Keywords box (they were always just umbrella keywords).
function renderConfig(cfg) {
  $('extractRules').value = serializeExtractRules(cfg.extractRules);
  $('stripSuffixes').value = (cfg.stripSuffixes || []).join('\n');
  $('fixedHostGroups').value = serializeFixedGroups(cfg.fixedHostGroups);
  $('excludedHosts').value = (cfg.excludedHosts || []).join('\n');
}

// Merge two keyword lists, de-duplicated, preserving order.
function mergeKeywords(...lists) {
  const seen = new Set(), out = [];
  for (const list of lists) for (const k of (list || [])) {
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

// Populate the behavior/look fields (not preset-driven).
function renderSettings(settings) {
  $('autoGroup').checked = settings.autoGroup;
  $('collapseOnGroup').checked = settings.collapseOnGroup;
  $('minGroupSize').value = settings.minGroupSize;
  $('autoEmoji').checked = settings.autoEmoji;
  $('kw').value = (settings.customKeywords || []).join('\n');
  $('colors').value = colorMapToText(settings.colorMap);
  $('emojiMap').value = emojiMapToText(settings.emojiMap);
}

async function load() {
  const stored = await chrome.storage.sync.get(null);
  const cfg = {
    extractRules: stored.extractRules ?? DEFAULT_CONFIG.extractRules,
    stripSuffixes: stored.stripSuffixes ?? DEFAULT_CONFIG.stripSuffixes,
    fixedHostGroups: stored.fixedHostGroups ?? DEFAULT_CONFIG.fixedHostGroups,
    excludedHosts: stored.excludedHosts ?? DEFAULT_CONFIG.excludedHosts
  };
  const settings = {
    autoGroup: stored.autoGroup ?? false,
    collapseOnGroup: stored.collapseOnGroup ?? true,
    minGroupSize: stored.minGroupSize ?? 2,
    autoEmoji: stored.autoEmoji ?? false,
    // Fold any legacy "projects" into the unified keywords box.
    customKeywords: mergeKeywords(stored.customKeywords, stored.projects),
    colorMap: stored.colorMap ?? {},
    emojiMap: stored.emojiMap ?? {}
  };
  renderConfig(cfg);
  renderSettings(settings);
}

async function save() {
  await chrome.storage.sync.set({
    autoGroup: $('autoGroup').checked,
    collapseOnGroup: $('collapseOnGroup').checked,
    minGroupSize: Math.max(2, parseInt($('minGroupSize').value, 10) || 2),
    autoEmoji: $('autoEmoji').checked,
    customKeywords: parseLines($('kw').value),
    colorMap: parseColorMap($('colors').value),
    emojiMap: parseEmojiMap($('emojiMap').value),
    projects: [], // merged into customKeywords; keep empty for compatibility
    extractRules: parseExtractRules($('extractRules').value),
    stripSuffixes: parseLines($('stripSuffixes').value),
    fixedHostGroups: parseFixedGroups($('fixedHostGroups').value),
    excludedHosts: parseLines($('excludedHosts').value)
  });
  flash('Preferences saved');
}

function reset() {
  // Restore rule sections to the shipped default preset; leave behavior/look as-is.
  renderConfig(DEFAULT_CONFIG);
  flash('Defaults restored — click Save to apply');
}

let toastTimer = null;
function flash(msg, warn = false) {
  const toast = $('toast');
  $('toastMsg').textContent = msg;
  toast.classList.toggle('warn', warn);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// Read every field on the page into one plain settings object.
function collectAll() {
  return {
    autoGroup: $('autoGroup').checked,
    collapseOnGroup: $('collapseOnGroup').checked,
    minGroupSize: Math.max(2, parseInt($('minGroupSize').value, 10) || 2),
    autoEmoji: $('autoEmoji').checked,
    customKeywords: parseLines($('kw').value),
    colorMap: parseColorMap($('colors').value),
    emojiMap: parseEmojiMap($('emojiMap').value),
    projects: [],
    extractRules: parseExtractRules($('extractRules').value),
    stripSuffixes: parseLines($('stripSuffixes').value),
    fixedHostGroups: parseFixedGroups($('fixedHostGroups').value),
    excludedHosts: parseLines($('excludedHosts').value)
  };
}

// Put a settings object (full or partial) back onto the page.
function applyAll(data) {
  renderConfig({
    extractRules: data.extractRules ?? [],
    stripSuffixes: data.stripSuffixes ?? [],
    fixedHostGroups: data.fixedHostGroups ?? [],
    excludedHosts: data.excludedHosts ?? []
  });
  renderSettings({
    autoGroup: data.autoGroup ?? false,
    collapseOnGroup: data.collapseOnGroup ?? true,
    minGroupSize: data.minGroupSize ?? 2,
    autoEmoji: data.autoEmoji ?? false,
    customKeywords: mergeKeywords(data.customKeywords, data.projects),
    colorMap: data.colorMap ?? {},
    emojiMap: data.emojiMap ?? {}
  });
}

// Export the current settings as a downloadable JSON file.
function exportSettings() {
  const data = { _app: 'Tabstaq', _version: 1, ...collectAll() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tabstaq-settings.json';
  a.click();
  URL.revokeObjectURL(url);
  flash('Exported tabstaq-settings.json');
}

// Import settings from a chosen JSON file (replaces the form; review then Save).
function importSettings(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (typeof data !== 'object' || data === null) throw new Error('not an object');
      applyAll(data);
      flash('Imported — review, then click Save to apply');
    } catch (e) {
      flash('Invalid settings file', true);
    }
  };
  reader.readAsText(file);
}

// Wire export/import.
$('export').addEventListener('click', exportSettings);
$('import').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importSettings(file);
  e.target.value = ''; // allow re-importing the same file
});

// Cmd/Ctrl+S saves.
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

// Sidebar nav: smooth-scroll to a section and mark active.
const navLinks = [...document.querySelectorAll('nav a[data-target]')];
navLinks.forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById(a.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Scroll-spy: highlight the section currently in view. Scroll-position based so
// the LAST (short) sections still activate when the page is scrolled to the end.
const sections = navLinks.map((a) => document.getElementById(a.dataset.target)).filter(Boolean);

function setActive(id) {
  navLinks.forEach((a) => a.classList.toggle('active', a.dataset.target === id));
}

function updateSpy() {
  const marker = 120; // px from top where a section counts as "current"
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
  let activeId = sections[0]?.id;
  if (nearBottom) {
    activeId = sections[sections.length - 1].id; // bottom → last section
  } else {
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= marker) activeId = s.id;
    }
  }
  if (activeId) setActive(activeId);
}

window.addEventListener('scroll', updateSpy, { passive: true });
window.addEventListener('resize', updateSpy);
updateSpy();

$('save').addEventListener('click', save);
$('reset').addEventListener('click', reset);
load();
