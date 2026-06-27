const $ = (id) => document.getElementById(id);

const SWATCH = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00',
  green: '#1e8e3e', pink: '#d01884', purple: '#9334e6', cyan: '#007b83',
  orange: '#e8710a'
};

async function currentWindowId() {
  const win = await chrome.windows.getCurrent();
  return win.id;
}

function ask(type, extra = {}) {
  return new Promise(async (resolve) => {
    const windowId = await currentWindowId();
    chrome.runtime.sendMessage({ type, windowId, ...extra }, (res) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(res || { error: 'No response' });
    });
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

// --- group preview ----------------------------------------------------------
async function renderPreview() {
  const res = await ask('plan');
  const box = $('preview');
  if (res.error || !res.plan) { box.innerHTML = ''; return; }
  if (res.plan.length === 0) {
    box.innerHTML = '<div class="empty">No groups yet — open some related tabs and hit Group.</div>';
    return;
  }
  const chips = res.plan.map((g) => {
    const dot = SWATCH[g.color] || '#5f6368';
    // "+N" badge when loose tabs would join/create; counts already include them.
    const addBadge = g.added ? `<span class="add">+${g.added}</span>` : '';
    return `<span class="chip${g.isNew ? ' new' : ''}" data-name="${escapeHtml(g.name)}" data-count="${g.count}">` +
      `<span class="swatch" style="background:${dot}"></span>` +
      `<span class="cname">${escapeHtml(g.label)}</span>` +
      addBadge +
      `<span class="n">${g.count}</span>` +
      `<button class="x" title="Close all ${g.count} tabs in this group" aria-label="Close group">✕</button>` +
      `</span>`;
  }).join('');
  const groups = res.plan.length;
  const pending = res.plan.reduce((s, g) => s + (g.added || 0), 0);
  const head = `${groups} group${groups > 1 ? 's' : ''}` +
    (pending ? ` · ${pending} tab${pending > 1 ? 's' : ''} to add` : '');
  box.innerHTML = `<div class="label">${head}</div><div class="chips">${chips}</div>`;
  wireChips();
}

// Tapping a chip slides it open to reveal an × ; tapping the × closes every tab
// in that group. Only one chip is revealed at a time.
function wireChips() {
  document.querySelectorAll('#preview .chip').forEach((chip) => {
    const x = chip.querySelector('.x');
    const label = chip.querySelector('.cname').textContent;

    // Tap chip body → toggle reveal.
    chip.addEventListener('click', () => {
      const open = chip.classList.contains('revealed');
      document.querySelectorAll('#preview .chip.revealed').forEach((c) => c.classList.remove('revealed'));
      if (!open) chip.classList.add('revealed');
    });

    // Tap × → close the group's tabs.
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await ask('closeGroupByName', { name: chip.dataset.name });
      if (res && res.closed !== undefined) {
        $('status').textContent = `Closed ${res.closed} tab${res.closed > 1 ? 's' : ''} in “${label}”.`;
      }
      renderPreview();
      loadTabs();
    });
  });
}

// Click anywhere else collapses a revealed chip.
document.addEventListener('click', (e) => {
  if (!e.target.closest('#preview .chip')) {
    document.querySelectorAll('#preview .chip.revealed').forEach((c) => c.classList.remove('revealed'));
  }
});

// --- search / jump ----------------------------------------------------------
let allTabs = [];
let selIndex = -1;

async function loadTabs() {
  const res = await ask('listTabs');
  allTabs = res.tabs || [];
}

function renderResults() {
  const q = $('q').value.trim().toLowerCase();
  const box = $('results');
  if (!q) { box.innerHTML = ''; selIndex = -1; return; }
  const matches = allTabs.filter((t) =>
    t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)).slice(0, 12);
  if (matches.length === 0) { box.innerHTML = '<div class="empty">No matching tabs.</div>'; return; }
  selIndex = 0;
  box.innerHTML = matches.map((t, i) => {
    const icon = t.favIconUrl
      ? `<img src="${escapeHtml(t.favIconUrl)}" onerror="this.style.visibility='hidden'">`
      : '<img style="visibility:hidden">';
    return `<div class="tab ${i === 0 ? 'sel' : ''}" data-id="${t.id}">
      ${icon}<span class="ti">${escapeHtml(t.title || t.url)}</span>
      <span class="host">${escapeHtml(hostOf(t.url))}</span></div>`;
  }).join('');
  box.querySelectorAll('.tab').forEach((el) => {
    el.addEventListener('click', () => jumpTo(parseInt(el.dataset.id, 10)));
  });
}

async function jumpTo(tabId) {
  await ask('focusTab', { tabId });
  window.close();
}

function moveSel(delta) {
  const items = [...$('results').querySelectorAll('.tab')];
  if (!items.length) return;
  items[selIndex]?.classList.remove('sel');
  selIndex = (selIndex + delta + items.length) % items.length;
  items[selIndex].classList.add('sel');
  items[selIndex].scrollIntoView({ block: 'nearest' });
}

$('q').addEventListener('input', renderResults);
$('q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
  else if (e.key === 'Enter') {
    const sel = $('results').querySelector('.tab.sel');
    if (sel) jumpTo(parseInt(sel.dataset.id, 10));
  } else if (e.key === 'Escape') { $('q').value = ''; renderResults(); }
});

// --- actions ----------------------------------------------------------------
async function act(type, label) {
  $('status').textContent = '…';
  const res = await ask(type);
  if (res.error) { $('status').textContent = 'Error: ' + res.error; return; }
  if (res.moved !== undefined) {
    $('status').textContent = res.groups
      ? `Grouped ${res.grouped} tabs into ${res.groups} group${res.groups > 1 ? 's' : ''}` +
        (res.moved ? ` (pulled ${res.moved} from other windows).` : '.')
      : 'No groupable tabs found.';
  } else if (res.grouped !== undefined) {
    $('status').textContent = res.groups
      ? `Grouped ${res.grouped} tabs into ${res.groups} group${res.groups > 1 ? 's' : ''}.`
      : 'No groupable tabs found.';
  } else if (res.ungrouped !== undefined) {
    $('status').textContent = `Ungrouped ${res.ungrouped} tabs.`;
  } else if (res.affected !== undefined) {
    $('status').textContent = `${label} ${res.affected} group${res.affected > 1 ? 's' : ''}.`;
  } else if (res.closed !== undefined) {
    $('status').textContent = res.closed
      ? `Closed ${res.closed} duplicate${res.closed > 1 ? 's' : ''}.`
      : 'No duplicates found.';
  }
  renderPreview();
  loadTabs();
}

$('group').addEventListener('click', () => act('group'));
$('consolidate').addEventListener('click', () => act('consolidate'));
$('ungroup').addEventListener('click', () => act('ungroup'));
$('collapse').addEventListener('click', () => act('collapse', 'Collapsed'));
$('expand').addEventListener('click', () => act('expand', 'Expanded'));
$('dedupe').addEventListener('click', () => act('closeDuplicates'));
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

// --- shortcuts panel --------------------------------------------------------
async function fillShortcutKeys() {
  // Read the ACTUAL bound shortcuts (data-key matches the command name). Chrome
  // leaves a command's shortcut empty if its suggested key conflicted -- so show
  // the truth and prompt the user to assign one rather than display a dead key.
  const bound = {};
  try {
    const cmds = await chrome.commands.getAll();
    for (const c of cmds) bound[c.name] = c.shortcut || '';
  } catch (e) { /* leave empty */ }
  document.querySelectorAll('#shortcuts kbd[data-key]').forEach((el) => {
    const shortcut = bound[el.dataset.key];
    if (shortcut) {
      el.textContent = shortcut;
      el.classList.remove('unset');
    } else {
      el.textContent = 'Not set';
      el.classList.add('unset');
    }
  });
}

function setShortcuts(open) {
  $('shortcuts').classList.toggle('hidden', !open);
  $('scToggle').classList.toggle('active', open);
}
$('scToggle').addEventListener('click', () => {
  setShortcuts($('shortcuts').classList.contains('hidden'));
});
$('scClose').addEventListener('click', () => setShortcuts(false));
const openShortcutsPage = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
$('customizeKeys').addEventListener('click', openShortcutsPage);
// Clicking an unset keycap jumps to the page to assign it.
$('shortcuts').addEventListener('click', (e) => {
  if (e.target.classList.contains('unset')) openShortcutsPage();
});

renderPreview();
loadTabs();
fillShortcutKeys();
$('q').focus();
