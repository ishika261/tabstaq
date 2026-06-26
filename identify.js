// identify.js
//
// Config-driven tab grouping. Nothing here is hardcoded to one company -- the
// rules are PRESETS the user can load, all editable in the Settings page.
//
// The five configurable pieces of a config:
//   excludedHosts   - hosts never grouped (exact hostname match)
//   extractRules    - "host | regex": on a matching host, run the regex against
//                     path+query; capture group 1 is the group name.
//   stripSuffixes   - role/realm suffixes peeled off a captured name so related
//                     packages collapse together (e.g. MyServiceCDK ->
//                     MyService). The base word (e.g. "Service") is kept.
//   fixedHostGroups - "host = Name": every tab on the host joins group "Name",
//                     regardless of the URL (e.g. all JIRA tabs -> "JIRA").
//   projects        - umbrella tokens: a tab whose url/title contains the token
//                     joins that group, overriding extraction.

// --- presets ---------------------------------------------------------------
// "generic" is shipped as the default on fresh install. "empty" wipes
// everything. Additional presets can be imported from a JSON file at runtime.

const PRESETS = {
  empty: {
    excludedHosts: [],
    extractRules: [],
    stripSuffixes: [],
    fixedHostGroups: [],
    projects: []
  },

  // Universal rules useful to anyone, with no company-specific names.
  generic: {
    excludedHosts: [
      'google.com', 'www.google.com', 'youtube.com', 'www.youtube.com',
      'mail.google.com', 'docs.google.com', 'drive.google.com'
    ],
    extractRules: [
      // Group code-host tabs by repository name.
      { host: 'github.com', pattern: '^/[^/]+/([^/?#]+)' },
      { host: 'gitlab.com', pattern: '^/[^/]+/([^/?#]+)' },
      { host: 'bitbucket.org', pattern: '^/[^/]+/([^/?#]+)' }
    ],
    // Common code-package role suffixes so e.g. MyAppApi + MyApp group together.
    stripSuffixes: [
      'CDK', 'Model', 'Client', 'Lambda', 'Api', 'API', 'Service',
      'Tests', 'Test', 'Config', 'App', 'UI', 'Web'
    ],
    fixedHostGroups: [],
    projects: []
  }
};

// The default config used until the user saves their own.
const DEFAULT_CONFIG = PRESETS.generic;

// --- text <-> structured config helpers (shared by options + background) ----

function parseLines(text) {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// "host | regex" per line.
function parseExtractRules(text) {
  const out = [];
  for (const line of parseLines(text)) {
    const i = line.indexOf('|');
    if (i < 0) continue;
    const host = line.slice(0, i).trim();
    const pattern = line.slice(i + 1).trim();
    if (host && pattern) out.push({ host, pattern });
  }
  return out;
}
function serializeExtractRules(rules) {
  return (rules || []).map((r) => `${r.host} | ${r.pattern}`).join('\n');
}

// "host = Name" per line.
function parseFixedGroups(text) {
  const out = [];
  for (const line of parseLines(text)) {
    const m = line.match(/^(.+?)\s*=\s*(.+)$/);
    if (m) out.push({ host: m[1].trim(), name: m[2].trim() });
  }
  return out;
}
function serializeFixedGroups(groups) {
  return (groups || []).map((g) => `${g.host} = ${g.name}`).join('\n');
}

// --- core logic --------------------------------------------------------------

// Peel known role/realm suffixes until stable. MyServiceCDK -> MyService.
function normalizeName(name, stripSuffixes) {
  let out = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of stripSuffixes) {
      if (out.length > s.length && out.endsWith(s)) {
        out = out.slice(0, -s.length);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

// Fixed host group name for a url, or null. A rule's `host` is matched against
// hostname + path, so rules can include a path prefix (e.g. "example.com/reviews").
function fixedGroup(url, config) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  const hostPath = (u.hostname + u.pathname).toLowerCase();
  for (const g of config.fixedHostGroups || []) {
    if (g.host && hostPath.includes(g.host.toLowerCase())) return g.name;
  }
  return null;
}

// Extracted group key for a url (after suffix stripping), or null.
function extractId(url, config) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;

  const host = u.hostname.toLowerCase();
  if ((config.excludedHosts || []).some((h) => host === h.toLowerCase())) return null;

  // Match path + decoded query so rules can target query params, e.g. ?path=/x/Y.
  const hay = u.pathname + (u.search ? '?' + safeDecode(u.search) : '');

  for (const rule of config.extractRules || []) {
    if (!rule.host || !host.includes(rule.host.toLowerCase())) continue;
    let re;
    try { re = new RegExp(rule.pattern); } catch (e) { continue; }
    const m = hay.match(re);
    if (m && m[1]) {
      return { id: normalizeName(m[1], config.stripSuffixes || []), raw: m[1] };
    }
  }
  return null;
}

export {
  PRESETS,
  DEFAULT_CONFIG,
  extractId,
  fixedGroup,
  normalizeName,
  parseLines,
  parseExtractRules,
  serializeExtractRules,
  parseFixedGroups,
  serializeFixedGroups
};
