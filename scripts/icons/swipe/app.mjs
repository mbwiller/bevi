// The swipe UI. State lives on the server (scripts/icons/swipe.ts); this page
// keeps a copy of the deck, changes it optimistically on a swipe, and replaces
// it with the server's whenever the server answers and no write is in flight.
const $ = id => document.getElementById(id);
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
const PILE = { good: 'Good', 'needs-work': 'Needs work', unsorted: 'To sort' };
const person = name => name ? name[0].toUpperCase() + name.slice(1) : '';
const day = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const iconUrl = icon => `/icons/${icon.slug}.svg?v=${icon.art}`;
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private window: remember for this visit only */ } },
};

let deck = null;        // { icons, counts, reviewers, warning? }
let etag = null;
let tab = 'unsorted';
let reviewer = null;
let pending = 0;        // writes not yet answered
let writes = 0;         // writes ever started; a poll that began before one is discarded
let chain = Promise.resolve();
let pinned = null;      // slug an undo put back on top of the deck
let offline = false;
let sheetSlug = null;
let artDark = matchMedia('(prefers-color-scheme: dark)').matches;
const undo = [];

const stack = $('stack'), grid = $('grid'), search = $('search'), sheet = $('sheet'), picker = $('picker'), note = $('sheet-note');
const find = slug => deck?.icons.find(icon => icon.slug === slug);
function unsorted() {
  const list = deck ? deck.icons.filter(icon => icon.pile === 'unsorted') : [];
  const i = list.findIndex(icon => icon.slug === pinned);
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}

// ---- Talking to the server ----
async function refresh() {
  if (pending) return;
  const started = writes;
  try {
    const response = await fetch('/api/deck', { headers: etag ? { 'If-None-Match': etag } : {} });
    if (response.status !== 304) {
      if (!response.ok) throw new Error(`deck ${response.status}`);
      const next = await response.json();
      if (pending || writes !== started) return;
      etag = response.headers.get('ETag');
      deck = next;
    }
    offline = false;
  } catch { offline = true; }
  render();
}

function send(icon, verdict, text) {
  writes++; pending++;
  const body = JSON.stringify({ slug: icon.slug, verdict, reviewer, art: icon.art, ...(text ? { note: text } : {}) });
  chain = chain.then(async () => {
    let response, data;
    try {
      response = await fetch('/api/verdict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      data = await response.json();
    } catch {
      pending--;
      toast(`Not saved: ${icon.name}. The server did not answer.`);
      if (!pending) { etag = null; refresh(); }
      return;
    }
    pending--;
    if (!response.ok) toast(`Not saved: ${data.error ?? 'the server refused it'}.`);
    const next = response.ok ? data : data.deck;
    if (pending) return;
    etag = null;
    if (next) { deck = next; offline = false; render(); } else refresh();
  });
}

function moveLocal(icon, verdict, text) {
  icon.pile = verdict;
  delete icon.previous; delete icon.note;
  if (verdict === 'unsorted') { delete icon.by; delete icon.at; return; }
  icon.by = reviewer; icon.at = new Date().toISOString();
  if (text) icon.note = text;
}

// ---- The deck ----
const keyOf = icon => `${icon.slug}:${icon.art}:${icon.previous ? `${icon.previous.at}` : ''}`;

function card(icon) {
  const node = el('article', 'card');
  node.dataset.key = keyOf(icon);
  node.dataset.slug = icon.slug;
  const art = el('div', `art${artDark ? ' dark' : ''}`);
  const hero = el('img', 'hero');
  hero.src = iconUrl(icon); hero.alt = `${icon.name} icon`; hero.draggable = false;
  const badges = el('div', 'badges');
  if (icon.previous) badges.append(el('span', 'badge redrawn', 'Redrawn'));
  if (icon.isStarter) badges.append(el('span', 'badge', 'Starter'));
  const minis = el('div', 'minis');
  for (const kind of ['light', 'light small', 'dark', 'dark small']) {
    const mini = el('div', `mini ${kind}`), img = el('img');
    img.src = iconUrl(icon); img.alt = '';
    mini.append(img); minis.append(mini);
  }
  const flip = el('button', 'flip');
  flip.type = 'button'; flip.setAttribute('aria-label', 'Switch between the light and dark tile');
  flip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor"/></svg>';
  flip.addEventListener('click', () => {
    artDark = !artDark;
    for (const a of stack.querySelectorAll('.art')) a.classList.toggle('dark', artDark);
  });
  art.append(hero, badges, minis, el('div', 'stamp good', 'Good'), el('div', 'stamp nope', 'Needs work'), flip);

  const info = el('div', 'info');
  const details = el('button', 'details', 'Details');
  details.type = 'button';
  details.addEventListener('click', () => openSheet(icon.slug));
  info.append(el('h2', '', icon.name), details, el('p', 'meta-line', [icon.brand, icon.family].filter(Boolean).join(' · ')));
  if (icon.previous) {
    const { by, verdict, note: text } = icon.previous;
    info.append(el('p', 'was', `Redrawn since ${person(by)} marked it ${PILE[verdict].toLowerCase()}${text ? `: “${text}”` : '.'}`));
  }
  node.append(art, info);
  drag(node, icon);
  return node;
}

function place(node, dx, dy) {
  node.style.transform = dx || dy ? `translate(${dx}px, ${dy * 0.35}px) rotate(${dx / 22}deg)` : '';
  const strength = Math.min(1, Math.abs(dx) / 90);
  node.querySelector('.stamp.good').style.opacity = dx > 0 ? strength : 0;
  node.querySelector('.stamp.nope').style.opacity = dx < 0 ? strength : 0;
  $('yep').classList.toggle('lit', dx > 60);
  $('nope').classList.toggle('lit', dx < -60);
}

function drag(node, icon) {
  let start = null, dx = 0, dy = 0;
  node.addEventListener('pointerdown', event => {
    if (start || node.classList.contains('leaving') || event.target.closest('button')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId, at: performance.now() };
    dx = dy = 0;
    node.setPointerCapture(event.pointerId);
    node.classList.remove('settle');
    node.classList.add('dragging');
  });
  node.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.id) return;
    dx = event.clientX - start.x; dy = event.clientY - start.y;
    place(node, dx, dy);
  });
  const end = event => {
    if (!start || event.pointerId !== start.id) return;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - start.at);
    start = null;
    node.classList.remove('dragging');
    const far = Math.abs(dx) > Math.min(110, node.offsetWidth * 0.3);
    const flick = speed > 0.55 && Math.abs(dx) > 40;
    if (event.type === 'pointerup' && (far || flick) && reviewer) decide(icon, dx > 0 ? 'good' : 'needs-work', node, dy);
    else {
      node.classList.add('settle');
      place(node, 0, 0);
      if (!reviewer) openPicker();
    }
  };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
}

function decide(icon, verdict, node = stack.querySelector(`.card[data-slug="${icon.slug}"]:not(.leaving)`), dy = 0) {
  if (!reviewer) { openPicker(); return; }
  const side = verdict === 'good' ? 1 : -1;
  if (node) {
    node.classList.remove('settle', 'dragging', 'under');
    node.classList.add('leaving');
    node.querySelector(`.stamp.${verdict === 'good' ? 'good' : 'nope'}`).style.opacity = 1;
    node.getBoundingClientRect(); // commit the starting transform so the exit animates from it
    node.style.transform = `translate(${side * (innerWidth * 0.5 + node.offsetWidth)}px, ${dy * 0.35 + 30}px) rotate(${side * 22}deg)`;
    setTimeout(() => node.remove(), 380);
  }
  $('yep').classList.remove('lit'); $('nope').classList.remove('lit');
  undo.push({ slug: icon.slug, side });
  if (pinned === icon.slug) pinned = null;
  moveLocal(icon, verdict);
  send(icon, verdict);
  navigator.vibrate?.(8);
  if (verdict === 'needs-work') toast(`${icon.name} needs work`, 'Add a note', () => openSheet(icon.slug, true));
  else hideToast();
  render();
}

function undoLast() {
  const last = undo.pop();
  const icon = last && find(last.slug);
  if (!icon) { render(); return; }
  hideToast();
  if (icon.pile !== 'unsorted') { moveLocal(icon, 'unsorted'); send(icon, 'unsorted'); }
  pinned = icon.slug;
  tab = 'unsorted';
  render();
  const node = stack.querySelector(`.card[data-slug="${icon.slug}"]:not(.leaving)`);
  if (node) {
    node.classList.remove('settle');
    node.style.transform = `translate(${last.side * (innerWidth * 0.5 + node.offsetWidth)}px, 30px) rotate(${last.side * 22}deg)`;
    node.getBoundingClientRect();
    node.classList.add('settle');
    node.style.transform = '';
  }
}

function renderDeck() {
  const list = unsorted();
  const want = list.slice(0, 2);
  const have = new Map();
  for (const node of [...stack.children]) {
    if (node.classList.contains('leaving')) continue;
    if (want.some(icon => keyOf(icon) === node.dataset.key)) have.set(node.dataset.key, node); else node.remove();
  }
  const [top, under] = want.map(icon => have.get(keyOf(icon)) ?? card(icon));
  if (top) {
    if (top.classList.contains('under')) { top.classList.remove('under'); top.classList.add('settle'); }
    if (!top.isConnected) stack.insertBefore(top, stack.querySelector('.leaving'));
  }
  if (under) {
    under.classList.add('under'); under.classList.remove('settle'); under.style.transform = '';
    if (!under.isConnected || under.nextElementSibling !== top) stack.insertBefore(under, top);
  }
  for (const icon of list.slice(2, 6)) new Image().src = iconUrl(icon);

  const empty = deck && !list.length;
  stack.hidden = Boolean(empty);
  $('done').hidden = !empty;
  if (empty) {
    const total = deck.icons.length;
    $('done-text').textContent = total
      ? `${total} icons: ${count('good')} good, ${count('needs-work')} need work. New and redrawn icons will show up here on their own.`
      : 'No icons in design/beverage-icons/manifest.json yet.';
    document.querySelector('.done-title').textContent = total ? 'All sorted.' : 'Nothing here yet.';
  }
  $('yep').disabled = $('nope').disabled = !list.length;
  $('undo').disabled = !undo.length;
}

// ---- The sorted piles ----
const count = pile => deck ? deck.icons.filter(icon => icon.pile === pile).length : 0;

function tile(icon) {
  const node = el('button', 'tile');
  node.type = 'button'; node.dataset.slug = icon.slug;
  const thumb = el('div', 'thumb'), img = el('img');
  img.src = iconUrl(icon); img.alt = ''; img.loading = 'lazy';
  thumb.append(img);
  node.append(thumb, el('span', 'name', icon.name), el('span', `by${icon.note ? ' noted' : ''}`, icon.note ?? `${person(icon.by)} · ${day(icon.at)}`));
  return node;
}
grid.addEventListener('click', event => {
  const slug = event.target.closest('.tile')?.dataset.slug;
  if (slug) openSheet(slug);
});

function renderList() {
  const query = search.value.trim().toLowerCase();
  const all = deck.icons.filter(icon => icon.pile === tab);
  const shown = all
    .filter(icon => !query || `${icon.name} ${icon.brand} ${icon.family}`.toLowerCase().includes(query))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  grid.replaceChildren(...shown.map(tile));
  const empty = $('list-empty');
  empty.hidden = shown.length > 0;
  empty.textContent = all.length ? 'No icon in this pile matches.'
    : tab === 'good' ? 'Nothing marked good yet. Swipe right on an icon that is ready.'
    : 'Nothing marked as needing work yet. Swipe left on an icon to send it here.';
  search.hidden = all.length === 0;
}
search.addEventListener('input', renderList);

// ---- Details ----
function openSheet(slug, focusNote = false) {
  sheetSlug = slug;
  const icon = find(slug);
  if (!icon) return;
  note.value = icon.note ?? '';
  fillSheet();
  if (!sheet.open) sheet.showModal();
  if (focusNote) note.focus(); else $('sheet-close').focus();
}

function fillSheet() {
  const icon = find(sheetSlug);
  if (!icon) { if (sheet.open) sheet.close(); return; }
  for (const id of ['sheet-img-light', 'sheet-img-dark']) { const img = $(id); if (!img.src.endsWith(iconUrl(icon))) img.src = iconUrl(icon); }
  $('sheet-img-light').alt = `${icon.name} icon on the light tile`;
  $('sheet-img-dark').alt = `${icon.name} icon on the dark tile`;
  $('sheet-name').textContent = icon.name;
  $('sheet-meta').textContent = [icon.brand, icon.family, icon.isStarter ? 'Starter' : ''].filter(Boolean).join(' · ');
  const status = $('sheet-status');
  status.className = `status-line ${icon.pile}`;
  status.textContent = icon.pile !== 'unsorted' ? `${PILE[icon.pile]} · ${person(icon.by)}, ${day(icon.at)}`
    : icon.previous ? `Redrawn since ${person(icon.previous.by)} marked it ${PILE[icon.previous.verdict].toLowerCase()}${icon.previous.note ? `: “${icon.previous.note}”` : '.'}`
    : 'Not sorted yet';
  $('sheet-note-wrap').hidden = icon.pile !== 'needs-work';

  const moves = $('sheet-moves');
  moves.replaceChildren();
  const move = (label, verdict) => {
    const button = el('button', 'btn', label);
    button.type = 'button';
    button.addEventListener('click', () => moveFromSheet(icon, verdict));
    moves.append(button);
  };
  if (icon.pile !== 'good') move(icon.pile === 'unsorted' ? 'Good' : 'Move to Good', 'good');
  if (icon.pile !== 'needs-work') move(icon.pile === 'unsorted' ? 'Needs work' : 'Move to Needs work', 'needs-work');
  if (icon.pile !== 'unsorted') move('Back to the deck', 'unsorted');

  $('sheet-package').textContent = icon.packageChoice || 'Not recorded';
  $('sheet-uncertainty').textContent = icon.uncertainty || 'None recorded';
  const refs = $('sheet-refs');
  refs.replaceChildren(...icon.references.map(url => {
    const link = el('a', '', new URL(url).hostname.replace(/^www\./, ''));
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  }));
  if (!icon.references.length) refs.textContent = 'None recorded';
}

function moveFromSheet(icon, verdict) {
  if (!reviewer) { sheet.close(); openPicker(); return; }
  if (icon.pile === 'unsorted') undo.push({ slug: icon.slug, side: verdict === 'good' ? 1 : -1 });
  moveLocal(icon, verdict);
  send(icon, verdict);
  if (verdict === 'needs-work') { note.value = ''; render(); note.focus(); return; }
  sheet.close();
  toast(verdict === 'good' ? `${icon.name} moved to Good` : `${icon.name} is back in the deck`);
  render();
}

// Closing the sheet keeps what was typed: a note is saved whenever it differs from the stored one.
sheet.addEventListener('close', () => {
  const icon = find(sheetSlug);
  sheetSlug = null;
  const text = note.value.trim();
  if (!icon || icon.pile !== 'needs-work' || !reviewer || text === (icon.note ?? '')) return;
  moveLocal(icon, 'needs-work', text);
  send(icon, 'needs-work', text);
  toast(text ? 'Note saved' : 'Note removed');
  render();
});
$('sheet-close').addEventListener('click', () => sheet.close());
$('sheet-save').addEventListener('click', () => sheet.close());
sheet.addEventListener('click', event => { if (event.target === sheet) sheet.close(); });

// ---- Who is sorting ----
function setReviewer(name) {
  reviewer = name;
  store.set('icon-swipe-reviewer', name);
  $('who').textContent = person(name);
  $('who').dataset.initial = person(name)[0];
}
function openPicker() {
  if (!deck || picker.open) return;
  $('picker-choices').replaceChildren(...deck.reviewers.map(name => {
    const button = el('button', `btn${name === reviewer ? ' primary' : ''}`, person(name));
    button.type = 'button';
    button.addEventListener('click', () => { setReviewer(name); picker.close(); });
    return button;
  }));
  picker.showModal();
}
picker.addEventListener('cancel', event => { if (!reviewer) event.preventDefault(); });
$('who').addEventListener('click', openPicker);

// ---- Toast ----
let toastTimer;
function toast(text, action, run) {
  $('toast-text').textContent = text;
  const button = $('toast-action');
  button.hidden = !action;
  button.textContent = action ?? '';
  button.onclick = action ? () => { hideToast(); run(); } : null;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2500);
}
function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; }

// ---- Everything ----
function render() {
  const banner = $('banner');
  banner.hidden = !(offline || deck?.warning);
  banner.textContent = offline ? 'Cannot reach the server. Is npm run icons:swipe still running on the Mac?' : deck?.warning ?? '';
  if (!deck) return;
  const total = deck.icons.length;
  for (const pile of ['unsorted', 'good', 'needs-work']) {
    $(`n-${pile}`).textContent = count(pile);
    if (pile !== 'unsorted') $(`bar-${pile}`).style.width = total ? `${(count(pile) / total) * 100}%` : '0';
  }
  const progress = $('progress');
  progress.setAttribute('aria-valuemax', total);
  progress.setAttribute('aria-valuenow', total - count('unsorted'));
  for (const button of document.querySelectorAll('.tabs button')) button.setAttribute('aria-selected', String(button.dataset.pile === tab));
  $('deck-view').hidden = tab !== 'unsorted';
  $('list-view').hidden = tab === 'unsorted';
  renderDeck();
  if (tab !== 'unsorted') renderList();
  if (sheet.open) fillSheet();
}

for (const button of document.querySelectorAll('.tabs button')) {
  button.addEventListener('click', () => { tab = button.dataset.pile; search.value = ''; render(); });
}
const topIcon = () => unsorted()[0];
$('yep').addEventListener('click', () => { const icon = topIcon(); if (icon) decide(icon, 'good'); });
$('nope').addEventListener('click', () => { const icon = topIcon(); if (icon) decide(icon, 'needs-work'); });
$('undo').addEventListener('click', undoLast);

addEventListener('keydown', event => {
  if (event.altKey || document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key !== 'z') return;
  if (key === 'z' || key === 'backspace') { if (undo.length) { event.preventDefault(); undoLast(); } return; }
  const icon = tab === 'unsorted' && topIcon();
  if (!icon) return;
  if (key === 'arrowright') decide(icon, 'good');
  else if (key === 'arrowleft') decide(icon, 'needs-work');
  else if (key === 'i') openSheet(icon.slug);
  else return;
  event.preventDefault();
});

setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

const remembered = store.get('icon-swipe-reviewer');
await refresh();
if (deck?.reviewers.includes(remembered)) setReviewer(remembered); else { $('who').textContent = 'Who?'; $('who').dataset.initial = '?'; openPicker(); }
