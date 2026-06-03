/* ─────────────────────────────────────────────────────────────
   Poker Tracker — app.js
   Loaded by index.html after config.js + settlement.js.
   ───────────────────────────────────────────────────────────── */

// Currency symbol — from config.js (CURRENCY), falls back to '$'.
const CUR = (typeof CURRENCY !== 'undefined' && CURRENCY) ? CURRENCY : '$';

async function api(path, method = 'GET', body) {
  // Config guard — API_BASE missing or still the placeholder
  if (typeof API_BASE === 'undefined' || !API_BASE || API_BASE.includes('YOUR-WORKER')) {
    return { data: null, error: { kind: 'config',
      message: 'API not configured. Set API_BASE in config.js to your deployed Worker URL (ending in /api).' } };
  }

  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  // Network layer — Worker unreachable, wrong URL, CORS, offline
  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (e) {
    return { data: null, error: { kind: 'network',
      message: `Can't reach the API at ${API_BASE}${path}. Check the Worker is deployed and API_BASE in config.js is correct.` } };
  }

  // Parse body (may be empty/non-JSON on some errors)
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    const detail = (json && json.error) ? json.error : `HTTP ${res.status}`;
    return { data: null, error: { kind: 'http', status: res.status,
      message: `${detail} (${method} ${path})` } };
  }

  return { data: json, error: null };
}

/* ── State ────────────────────────────────────────────────────── */
let currentSession        = null;  // { id, name, status, created_at }
let currentPlayers        = [];    // [{ id, player_name, final_chips, buyins: [{id, amount}] }]
let allSessions           = [];    // full list, kept for sessions-search filtering

// Delete modal
let pendingDeleteSessionId = null;

// Rename mode — reuses the new-session modal
let renameMode = false;

// App mode
let currentMode = 'home';

// Casino visit modal state
let editingVisitId  = null;
let selectedGames   = new Set();

// Casino period filter
let casinoPeriod = 'all'; // 'all' | 'year' | 'month'

// Blinds timer state
// Escalating tournament blind schedule. The small blind scales through these
// multipliers (a standard pub progression); the schedule is rebuilt from a chosen
// opening blind when a structure preset is applied (see applyStructure).
const BLIND_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 100];
function buildBlindSchedule(openingSmall) {
  return BLIND_STEPS.map(m => ({ small: openingSmall * m, big: openingSmall * m * 2 }));
}
let blindSchedule = buildBlindSchedule(25); // default opening 25/50

// Tournament structure presets a pub would actually run. APL is "play for fun":
// tournament chips have no cash value, everyone gets the same starting stack, blinds
// escalate, and a flat entry fee (where permitted) is the same for all players.
// `breakdown` = suggested physical chips per player for the starting stack
// (pairs of [denomination, count]); totals must equal `chips`.
const TOURNAMENT_STRUCTURES = [
  { name: 'Turbo',    chips: 5000,  small: 25,  big: 50,  levelSecs: 900,  breakdown: [[25, 8], [100, 8], [500, 4], [1000, 2]] },
  { name: 'Standard', chips: 10000, small: 50,  big: 100, levelSecs: 1200, breakdown: [[25, 8], [100, 8], [500, 6], [1000, 6]] },
  { name: 'Deep',     chips: 20000, small: 100, big: 200, levelSecs: 1200, breakdown: [[100, 10], [500, 8], [1000, 5], [5000, 2]] },
];
let activeStructure = null;   // the structure chosen for the current tournament

// Chip denomination ladder used by the colour-up guide.
const CHIP_DENOMS = [25, 100, 500, 1000, 5000, 25000];

// Guide: the smallest chip worth keeping on the table at a given small blind —
// the largest denomination that isn't smaller than the blind. As blinds climb
// this rises, which is the cue to colour up / race off the smaller chips.
function smallestChip(smallBlind) {
  return [...CHIP_DENOMS].reverse().find(d => d <= smallBlind) || CHIP_DENOMS[0];
}

// "8 × 25 · 8 × 100 · …" for a structure's starting-stack breakdown.
function formatBreakdown(breakdown) {
  return (breakdown || []).map(([d, n]) => `${n} × ${d.toLocaleString()}`).join('  ·  ');
}

// ── Placement scoring ──────────────────────────────────────────────
// A player's finishing place is stored in session_players.final_chips
// (1 = winner, 2 = runner-up, …; null = still in / not yet recorded).
// Points scheme — the single place to change scoring. Default scales with
// field size: winning an N-player game = N points, busting first = 1 point.
function placePoints(place, fieldSize) {
  if (!place || !fieldSize) return 0;
  return Math.max(1, fieldSize - place + 1);
}
const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
let timerInterval     = null;
let timerRunning      = false;
let timerLevel        = 0;
let timerSecondsLeft  = 300;
let timerLevelDuration = 300;

// Dealer tip — dismissed per session
let dealerTipDismissed = false;

// Session timer
let sessionTimerInterval = null;

function updateSessionTimer(createdAt) {
  const el   = document.getElementById('session-timer');
  if (!el) return;
  const diff = Date.now() - new Date(createdAt).getTime();
  const h    = Math.floor(diff / 3600000);
  const m    = Math.floor((diff % 3600000) / 60000);
  el.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function clearSessionTimer() {
  clearInterval(sessionTimerInterval);
  sessionTimerInterval = null;
}

// Results state
let currentSorted       = [];      // players sorted by finishing place for the results view
let justSettled         = false;   // true only on the freshly-finished tournament (for confetti)

// Picker state — names added for the current tournament only (not persisted)
let pickerSelected  = new Set();

/* ═══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════ */

function toast(msg, type = 'info', duration = 3200) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-msg">${msg}</span>`;
  container.appendChild(el);
  const remove = () => {
    el.style.transition = 'opacity 0.25s, transform 0.25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px) scale(0.96)';
    setTimeout(() => el.remove(), 260);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, duration);
}

function toastUndo(msg, undoFn, duration = 5000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast info';
  el.innerHTML = `<span class="toast-msg">${msg}</span><button class="toast-undo">Undo</button>`;
  container.appendChild(el);
  let acted = false;
  const remove = () => {
    el.style.transition = 'opacity 0.25s, transform 0.25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector('.toast-undo').addEventListener('click', () => {
    if (acted) return;
    acted = true;
    undoFn();
    remove();
  });
  setTimeout(() => { if (!acted) remove(); }, duration);
}

/* ── Skeleton loader ─────────────────────────────────────────────── */
function skeletonHTML(count = 3) {
  return Array.from({ length: count }, () =>
    `<div class="skeleton-card">
       <div class="skeleton-line w-40"></div>
       <div class="skeleton-line w-75"></div>
     </div>`).join('');
}

/* ── View router (placeholder — real one in BOTTOM NAVIGATION) ─── */
// Defined below after DETAIL_VIEWS is declared.

/* ═══════════════════════════════════════════════════════════════
   HOME VIEW
   ═══════════════════════════════════════════════════════════════ */

// Called by: boot, back buttons, after delete
async function loadSessions() { return loadHome(); }
async function loadHome() {
  show('view-sessions');
  const list = document.getElementById('sessions-list');
  list.innerHTML = skeletonHTML(4);

  const { data, error } = await api('/sessions');

  if (error) { list.innerHTML = `<p class="empty-state">Error: ${error.message}</p>`; return; }
  allSessions = data || [];
  const q = document.getElementById('sessions-search').value.trim().toLowerCase();
  renderSessions(q ? allSessions.filter(s => s.name.toLowerCase().includes(q)) : allSessions);
}

// Called by: loadHome, sessions-search input
function renderSessions(sessions) {
  const list = document.getElementById('sessions-list');
  if (!sessions.length) {
    const msg = allSessions.length
      ? 'No sessions match your search.'
      : 'No sessions yet. Start a new game!';
    list.innerHTML = `<p class="empty-state">${msg}</p>`;
    return;
  }

  list.innerHTML = '';
  sessions.forEach(s => {
    // Compute winner + pot for settled sessions
    let winnerLine = '';
    let potLine    = '';
    if (s.status === 'settled' && s.session_players?.length) {
      let topNet = -Infinity, winnerName = '', totalPot = 0;
      s.session_players.forEach(p => {
        const buyin = (p.buyins || []).reduce((sum, b) => sum + Number(b.amount), 0);
        const net   = (p.final_chips ?? 0) - buyin;
        totalPot   += buyin;
        if (net > topNet) { topNet = net; winnerName = p.player_name; }
      });
      if (winnerName && topNet > 0) {
        winnerLine = `<span class="session-card-winner"><svg class="icon"><use href="#i-trophy"/></svg> ${winnerName} +${CUR}${topNet}</span>`;
      }
      potLine = `<span class="session-card-pot">Pot ${CUR}${totalPot}</span>`;
    }

    // Wrap card for swipe support
    const locked = isLockedForDelete(s);
    const wrap = document.createElement('div');
    wrap.className = 'session-swipe-wrap';
    if (!locked) wrap.innerHTML = `<div class="swipe-delete-bg"><svg class="icon"><use href="#i-x"/></svg></div>`;

    const card = document.createElement('div');
    card.className = `session-card ${s.status === 'active' ? 'active-session' : 'settled-session'}`;
    card.innerHTML = `
      <div class="session-card-info">
        <span class="session-card-name">${s.name}</span>
        <span class="session-card-meta">${formatDate(s.created_at)}</span>
        ${winnerLine}${potLine}
      </div>
      <div class="session-card-right">
        <span class="badge ${s.status === 'active' ? 'badge-active' : 'badge-settled'}">${s.status}</span>
        ${locked ? '' : `<button class="btn-delete" data-id="${s.id}" data-name="${s.name}" title="Delete session"><svg class="icon"><use href="#i-x"/></svg></button>`}
      </div>`;

    card.addEventListener('click', e => {
      if (!e.target.closest('.btn-delete')) openSession(s, 'forward');
    });

    const deleteBtn = card.querySelector('.btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        openDeleteModal(s.id, s.name);
      });
    }

    wrap.appendChild(card);
    if (!locked) addSwipeToDelete(card, () => openDeleteModal(s.id, s.name));
    list.appendChild(wrap);
  });
}

document.getElementById('sessions-search').addEventListener('input', () => {
  const q = document.getElementById('sessions-search').value.trim().toLowerCase();
  renderSessions(q ? allSessions.filter(s => s.name.toLowerCase().includes(q)) : allSessions);
});

// Swipe left past threshold to trigger delete modal
function addSwipeToDelete(cardEl, onSwipe) {
  let startX = 0, dx = 0, dragging = false;
  const THRESHOLD = 72;

  cardEl.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    dragging = true;
    cardEl.style.transition = 'none';
  }, { passive: true });

  cardEl.addEventListener('touchmove', e => {
    if (!dragging) return;
    dx = e.touches[0].clientX - startX;
    if (dx < 0) cardEl.style.transform = `translateX(${Math.max(dx, -THRESHOLD - 16)}px)`;
  }, { passive: true });

  cardEl.addEventListener('touchend', () => {
    dragging = false;
    cardEl.style.transition = 'transform 0.22s ease';
    cardEl.style.transform  = 'translateX(0)';
    if (dx < -THRESHOLD) onSwipe();
    dx = 0;
  });
}

/* ── New session modal ──────────────────────────────────────────── */

function openNewSessionModal() {
  renameMode = false;
  document.getElementById('input-session-name').value = '';
  document.getElementById('input-session-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('input-session-date').style.display = '';
  document.querySelector('#modal-new-session h3').textContent          = 'New Session';
  document.querySelector('#modal-new-session .modal-label').textContent = 'Name this game night.';
  document.getElementById('modal-new-session').classList.remove('hidden');
  setTimeout(() => document.getElementById('input-session-name').focus(), 50);
}

document.getElementById('btn-new-session').addEventListener('click', openNewSessionModal);

document.getElementById('modal-new-cancel').addEventListener('click', () => {
  renameMode = false;
  document.getElementById('modal-new-session').classList.add('hidden');
});

document.getElementById('modal-new-confirm').addEventListener('click', async () => {
  const name = document.getElementById('input-session-name').value.trim();
  if (!name) return;
  document.getElementById('modal-new-session').classList.add('hidden');

  if (renameMode) {
    renameMode = false;
    const { error } = await api(`/sessions/${currentSession.id}`, 'PATCH', { name });
    if (error) { toast('Error renaming session: ' + error.message, 'error'); return; }
    currentSession.name = name;
    document.getElementById('session-title').textContent = name;
    toast('Session renamed.', 'success');
    return;
  }

  const dateVal    = document.getElementById('input-session-date').value;
  const created_at = dateVal ? new Date(dateVal + 'T20:00:00').toISOString() : undefined;
  const { data, error } = await api('/sessions', 'POST', { name, ...(created_at && { created_at }) });

  if (error) { toast('Error creating session: ' + error.message, 'error'); return; }
  openSession(data);
});

document.getElementById('input-session-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('modal-new-confirm').click();
  if (e.key === 'Escape') document.getElementById('modal-new-cancel').click();
});

/* ── Delete session modal ───────────────────────────────────────── */

// Called by: delete button on session card
function openDeleteModal(sessionId, sessionName) {
  pendingDeleteSessionId = sessionId;
  document.getElementById('modal-delete-label').textContent =
    `"${sessionName}" and all its data will be permanently removed.`;
  document.getElementById('modal-delete').classList.remove('hidden');
}

document.getElementById('modal-delete-cancel').addEventListener('click', () => {
  document.getElementById('modal-delete').classList.add('hidden');
  pendingDeleteSessionId = null;
});

document.getElementById('modal-delete-confirm').addEventListener('click', async () => {
  if (!pendingDeleteSessionId) return;
  document.getElementById('modal-delete').classList.add('hidden');

  const { error } = await api(`/sessions/${pendingDeleteSessionId}`, 'DELETE');

  pendingDeleteSessionId = null;
  if (error) { toast('Error deleting session: ' + error.message, 'error'); return; }
  await loadHome();
});

document.getElementById('btn-rename-session').addEventListener('click', () => {
  renameMode = true;
  document.getElementById('input-session-name').value                   = currentSession.name;
  document.getElementById('input-session-date').style.display           = 'none';
  document.querySelector('#modal-new-session h3').textContent           = 'Rename Session';
  document.querySelector('#modal-new-session .modal-label').textContent = 'Enter a new name for this session.';
  document.getElementById('modal-new-session').classList.remove('hidden');
  setTimeout(() => document.getElementById('input-session-name').focus(), 50);
});

/* ═══════════════════════════════════════════════════════════════
   SESSION VIEW
   ═══════════════════════════════════════════════════════════════ */

// Called by: session-card click, new session confirm
async function openSession(session, dir = 'none') {
  currentSession = session;
  document.getElementById('session-title').textContent       = session.name;
  document.getElementById('session-date').textContent        = formatDate(session.created_at);
  document.getElementById('session-notes-input').value       = session.notes || '';
  document.getElementById('session-notes-input').readOnly    = session.status === 'settled';

  // Header button only appears once settled (→ View Results). During play the
  // tournament ends by knocking players out, so there's no manual "settle".
  const settleBtn = document.getElementById('btn-settle');
  settleBtn.textContent = 'View Results';
  settleBtn.classList.toggle('hidden', session.status !== 'settled');

  document.getElementById('btn-blinds-timer').classList.toggle('hidden', session.status === 'settled');

  // Session timer — only for active sessions
  const timerEl = document.getElementById('session-timer');
  clearSessionTimer();
  if (session.status === 'active') {
    timerEl.classList.remove('hidden');
    updateSessionTimer(session.created_at);
    sessionTimerInterval = setInterval(() => updateSessionTimer(session.created_at), 60000);
  } else {
    timerEl.classList.add('hidden');
  }

  dealerTipDismissed = false;
  show('view-session', dir);
  await loadPlayers();
}

// Called by: openSession(), after add-player/buyin/edit-buyin
async function loadPlayers() {
  const { data, error } = await api(`/sessions/${currentSession.id}/players`);

  if (error) { console.error(error); return; }
  currentPlayers = data || [];
  renderPlayers();
}


function setSettledAt(id)   { localStorage.setItem(`settled_at_${id}`, Date.now().toString()); }
function clearSettledAt(id) { localStorage.removeItem(`settled_at_${id}`); }
function isLockedForDelete(session) {
  if (session.status !== 'settled') return false;
  const raw = localStorage.getItem(`settled_at_${session.id}`);
  if (!raw) return true; // no timestamp → settled before this feature → treat as old → locked
  return (Date.now() - parseInt(raw, 10)) > 3 * 24 * 60 * 60 * 1000;
}

// Called by: loadPlayers()
// Tournament view: knock players out as they bust; the last standing wins.
// A player's finishing place lives in p.final_chips (null = still in).
function renderPlayers() {
  const seatsBtn  = document.getElementById('btn-randomize-seats');
  const dealerTip = document.getElementById('dealer-tip');
  const isSettled = currentSession.status === 'settled';

  const active = currentPlayers.filter(p => p.final_chips == null);
  const busted = currentPlayers.filter(p => p.final_chips != null)
                   .sort((a, b) => a.final_chips - b.final_chips); // best finish first
  const fieldSize = currentPlayers.length;

  seatsBtn.classList.toggle('hidden', !(active.length >= 2 && !isSettled));
  dealerTip.classList.toggle('hidden', !(active.length > 5 && !isSettled && !dealerTipDismissed));

  const list = document.getElementById('players-list');

  if (!currentPlayers.length) {
    list.innerHTML = '<p class="empty-state">Add players above to start the tournament.</p>';
    return;
  }

  list.innerHTML = '';

  // Status bar: how many remain + undo last knockout
  if (!isSettled) {
    const status = document.createElement('div');
    status.className = 'tourney-status';
    status.innerHTML = `
      <span class="tourney-left"><strong>${active.length}</strong> of ${fieldSize} left</span>
      ${busted.length ? `<button class="btn btn-ghost btn-sm" id="btn-undo-knockout"><svg class="icon"><use href="#i-rotate-ccw"/></svg> Undo</button>` : ''}`;
    list.appendChild(status);
  }

  // Still in
  active.forEach(p => {
    const card = document.createElement('div');
    card.className = 'tourney-card active';
    card.innerHTML = `
      <span class="tourney-name">${p.player_name}</span>
      <div class="tourney-actions">
        ${!isSettled ? `<button class="btn-knockout" data-id="${p.id}">Knock Out</button>` : ''}
        ${!isSettled ? `<button class="btn-remove-player" data-id="${p.id}" data-name="${p.player_name}" title="Remove player"><svg class="icon"><use href="#i-x"/></svg></button>` : ''}
      </div>`;
    list.appendChild(card);
  });

  // Knocked out / final standings
  if (busted.length) {
    const divider = document.createElement('div');
    divider.className = 'tourney-divider';
    divider.textContent = isSettled ? 'Final standings' : 'Knocked out';
    list.appendChild(divider);

    busted.forEach(p => {
      const place = p.final_chips;
      const medal = place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : '';
      const card = document.createElement('div');
      card.className = `tourney-card busted${place === 1 ? ' winner' : ''}`;
      card.innerHTML = `
        <span class="tourney-place ${medal}">${ordinal(place)}</span>
        <span class="tourney-name">${p.player_name}</span>
        <span class="tourney-pts">+${placePoints(place, fieldSize)} pts</span>`;
      list.appendChild(card);
    });
  }

  document.querySelectorAll('.btn-knockout').forEach(btn =>
    btn.addEventListener('click', () => bustPlayer(btn.dataset.id))
  );
  document.getElementById('btn-undo-knockout')?.addEventListener('click', undoLastKnockout);
  document.querySelectorAll('.btn-remove-player').forEach(btn =>
    btn.addEventListener('click', () => removePlayer(btn.dataset.id, btn.dataset.name))
  );
}

// Knock a player out — they finish in the current remaining position.
// When only one player is left, crown them and finalize the tournament.
async function bustPlayer(id) {
  const active = currentPlayers.filter(p => p.final_chips == null);
  if (active.length <= 1) return;
  const place = active.length;
  const { error } = await api(`/session-players/${id}`, 'PATCH', { final_chips: place });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  await loadPlayers();

  const stillActive = currentPlayers.filter(p => p.final_chips == null);
  if (stillActive.length === 1) {
    await api(`/session-players/${stillActive[0].id}`, 'PATCH', { final_chips: 1 });
    await finalizeTournament();
  }
}

// Revive the most recently knocked-out player (smallest place number).
async function undoLastKnockout() {
  const busted = currentPlayers.filter(p => p.final_chips != null);
  if (!busted.length) return;
  const last = [...busted].sort((a, b) => a.final_chips - b.final_chips)[0];
  const { error } = await api(`/session-players/${last.id}`, 'PATCH', { final_chips: null });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  await loadPlayers();
}

// Crown the winner and lock the session.
async function finalizeTournament() {
  await api(`/sessions/${currentSession.id}`, 'PATCH', { status: 'settled' });
  currentSession.status = 'settled';
  setSettledAt(currentSession.id);
  justSettled = true;
  await loadPlayers();
  openResultsView();
}

/* ═══════════════════════════════════════════════════════════════
   PLAYER PICKER
   No saved roster — the player list is empty every tournament and the
   names you add live only inside that session. Players are typed fresh
   each night (the season leaderboard still aggregates them by name).
   ═══════════════════════════════════════════════════════════════ */

// Called by: btn-open-picker click — shows blind-level picker first
async function openPlayerPicker() {
  if (currentSession.status === 'settled') return;
  renderBlindsPresets();
  document.getElementById('modal-blinds').classList.remove('hidden');
}

// Called by: renderBlindsPresets preset click, #blinds-skip
async function continueToPlayerPicker() {
  pickerSelected = new Set();          // empty every tournament — no saved roster
  renderRosterChips();
  renderPickerCount();
  document.getElementById('new-roster-input').value = '';
  const label = document.querySelector('#modal-picker .modal-label');
  if (label) label.textContent = "Add tonight's players — saved only to this tournament";
  document.getElementById('modal-picker').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-roster-input').focus(), 60);
}

// Called by: openPlayerPicker
function renderBlindsPresets() {
  const list = document.getElementById('blinds-preset-list');
  list.innerHTML = '';
  TOURNAMENT_STRUCTURES.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'blinds-preset-btn';
    btn.innerHTML = `
      <div class="blinds-preset-left">
        <span class="blinds-preset-level">${s.name}</span>
        <span class="blinds-preset-desc">${s.small} / ${s.big} start · ${s.levelSecs / 60}-min levels</span>
      </div>
      <span class="blinds-preset-buyin">${s.chips.toLocaleString()}<small>chips</small></span>`;
    btn.addEventListener('click', () => {
      applyStructure(s);
      document.getElementById('modal-blinds').classList.add('hidden');
      continueToPlayerPicker();
    });
    list.appendChild(btn);
  });
}

// Seed the blind timer + chip guides from a chosen structure.
function applyStructure(s) {
  activeStructure    = s;
  blindSchedule      = buildBlindSchedule(s.small);
  timerLevel         = 0;
  timerLevelDuration = s.levelSecs;
  timerSecondsLeft   = s.levelSecs;
  timerRunning       = false;
  clearInterval(timerInterval);
  const durSel = document.getElementById('timer-duration');
  if (durSel) durSel.value = String(s.levelSecs);
}

document.getElementById('btn-open-picker').addEventListener('click', openPlayerPicker);

// Called by: continueToPlayerPicker, btn-add-roster — renders the names added
// for this tournament as removable chips (tap to remove).
function renderRosterChips() {
  const container = document.getElementById('roster-chips');
  container.innerHTML = '';

  if (!pickerSelected.size) {
    container.innerHTML = '<p class="empty-state roster-empty">No players yet — add them below.</p>';
    return;
  }

  [...pickerSelected].forEach(name => {
    const chip = document.createElement('button');
    chip.className = 'roster-chip selected';
    chip.title = 'Tap to remove';
    chip.textContent = name;
    const x = document.createElement('span');
    x.className = 'chip-x';
    x.textContent = ' ×';
    chip.appendChild(x);

    chip.addEventListener('click', () => {
      pickerSelected.delete(name);
      renderRosterChips();
      renderPickerCount();
    });

    container.appendChild(chip);
  });
}

// Called by: chip click, continueToPlayerPicker
function renderPickerCount() {
  const container = document.getElementById('picker-buyins');
  const n = pickerSelected.size;
  container.innerHTML = n
    ? `<p class="picker-count">${n} player${n !== 1 ? 's' : ''} added</p>`
    : '';
}

// Confirm — add all selected players (names only; no buy-ins in tournament mode)
document.getElementById('picker-confirm').addEventListener('click', async () => {
  if (!pickerSelected.size) {
    document.getElementById('modal-picker').classList.add('hidden'); return;
  }

  const names = [...pickerSelected];
  document.getElementById('modal-picker').classList.add('hidden');

  for (const name of names) {
    const { error: pe } = await api('/session-players', 'POST', { session_id: currentSession.id, player_name: name });
    if (pe) { toast('Error adding ' + name + ': ' + pe.message, 'error'); }
  }

  await loadPlayers();
});

document.getElementById('picker-cancel').addEventListener('click', () => {
  document.getElementById('modal-picker').classList.add('hidden');
});

document.getElementById('blinds-cancel').addEventListener('click', () => {
  document.getElementById('modal-blinds').classList.add('hidden');
});

document.getElementById('blinds-skip').addEventListener('click', () => {
  activeStructure = null;   // manual: no structure → no starting-stack breakdown
  document.getElementById('modal-blinds').classList.add('hidden');
  continueToPlayerPicker();
});

// Add a player to this tournament (not persisted anywhere).
document.getElementById('btn-add-roster').addEventListener('click', () => {
  const input = document.getElementById('new-roster-input');
  const name  = input.value.trim();
  if (!name) return;

  const inSession = currentPlayers.some(p => p.player_name.toLowerCase() === name.toLowerCase());
  const already   = [...pickerSelected].some(n => n.toLowerCase() === name.toLowerCase());
  if (inSession) { toast(`${name} is already in this tournament.`, 'info'); input.value = ''; return; }
  if (already)   { toast(`${name} is already added.`, 'info'); input.value = ''; return; }

  pickerSelected.add(name);
  input.value = '';
  input.focus();
  renderRosterChips();
  renderPickerCount();
});

document.getElementById('new-roster-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-roster').click();
});

// Called by: remove button on player card
async function removePlayer(playerId, playerName) {
  // Snapshot data for potential undo
  const snapshot = currentPlayers.find(p => p.id === playerId);

  const { error } = await api(`/session-players/${playerId}`, 'DELETE');
  if (error) { toast('Error removing player: ' + error.message, 'error'); return; }
  await loadPlayers();

  toastUndo(`Removed ${playerName}`, async () => {
    if (!snapshot) return;
    const { data: restored, error: re } = await api('/session-players', 'POST', { session_id: currentSession.id, player_name: snapshot.player_name });
    if (re) { toast('Could not undo', 'error'); return; }
    for (const b of snapshot.buyins) {
      await api('/buyins', 'POST', { session_player_id: restored.id, amount: b.amount });
    }
    await loadPlayers();
    toast(`${playerName} restored`, 'success');
  });
}

document.getElementById('dealer-tip-dismiss').addEventListener('click', () => {
  dealerTipDismissed = true;
  document.getElementById('dealer-tip').classList.add('hidden');
});

/* ── Seat Randomizer ────────────────────────────────────────────── */

function renderSeats() {
  const shuffled = [...currentPlayers].sort(() => Math.random() - 0.5);
  document.getElementById('seats-list').innerHTML = shuffled.map((p, i) => `
    <div class="seat-row">
      <span class="seat-num">${i + 1}</span>
      <span class="seat-player">${p.player_name}</span>
    </div>`).join('');
}

document.getElementById('btn-randomize-seats').addEventListener('click', () => {
  renderSeats();
  document.getElementById('modal-seats').classList.remove('hidden');
});

document.getElementById('btn-reshuffle').addEventListener('click', renderSeats);

document.getElementById('btn-seats-close').addEventListener('click', () => {
  document.getElementById('modal-seats').classList.add('hidden');
});

/* ── Session Notes ──────────────────────────────────────────────── */
document.getElementById('session-notes-input').addEventListener('blur', async () => {
  if (!currentSession || currentSession.status !== 'active') return;
  const notes = document.getElementById('session-notes-input').value.trim();
  await api(`/sessions/${currentSession.id}`, 'PATCH', { notes });
});

/* ── Settle / Back ──────────────────────────────────────────────── */

document.getElementById('btn-back-home').addEventListener('click', () => {
  clearSessionTimer();
  loadHome();
});

document.getElementById('btn-settle').addEventListener('click', () => {
  // Only visible once settled — opens the final standings.
  if (currentSession.status === 'settled') openResultsView();
});



/* ═══════════════════════════════════════════════════════════════
   RESULTS VIEW
   ═══════════════════════════════════════════════════════════════ */

function openResultsView() {
  show('view-results', 'forward');
  document.getElementById('results-session-name').textContent = currentSession.name;

  const fieldSize = currentPlayers.length;
  // Sort by finishing place (1 = winner); anyone without a place sorts last.
  currentSorted = [...currentPlayers].sort((a, b) => (a.final_chips ?? 999) - (b.final_chips ?? 999));

  renderStandings(fieldSize);

  if (justSettled) {
    justSettled = false;
    const winner = currentSorted.find(p => p.final_chips === 1);
    if (winner) {
      setTimeout(() => {
        launchConfetti();
        showWinnerAnnouncement(winner.player_name, placePoints(1, fieldSize));
      }, 400);
    }
  }
}

// Final standings: place + points per player (tournament mode — no money).
function renderStandings(fieldSize) {
  const list = document.getElementById('results-list');
  list.innerHTML = '';

  currentSorted.forEach(p => {
    const place = p.final_chips;
    const pts   = placePoints(place, fieldSize);
    const medal = place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : '';
    const rankClass = place === 1 ? 'result-rank-1' : place === 2 ? 'result-rank-2' : place === 3 ? 'result-rank-3' : '';

    const card = document.createElement('div');
    card.className = `result-card ${place === 1 ? 'winner' : ''} ${rankClass}`.trim();
    card.innerHTML = `
      <span class="result-rank ${medal}">${place ?? '—'}</span>
      <div class="result-info">
        <span class="result-name">${p.player_name}</span>
        <span class="result-detail">${place ? ordinal(place) + ' place' : 'Did not finish'}</span>
      </div>
      <span class="net-gain positive">+${pts} pts</span>`;
    list.appendChild(card);
  });
}

document.getElementById('btn-back-results-home').addEventListener('click', () => {
  clearSessionTimer();
  loadHome();
});

document.getElementById('btn-reopen-session').addEventListener('click', () => {
  document.getElementById('modal-reopen-confirm').classList.remove('hidden');
});

document.getElementById('reopen-confirm-cancel').addEventListener('click', () => {
  document.getElementById('modal-reopen-confirm').classList.add('hidden');
});

document.getElementById('reopen-confirm-ok').addEventListener('click', async () => {
  document.getElementById('modal-reopen-confirm').classList.add('hidden');
  for (const p of currentPlayers) {
    await api(`/session-players/${p.id}`, 'PATCH', { final_chips: null });
  }
  await api(`/sessions/${currentSession.id}`, 'PATCH', { status: 'active' });
  currentSession.status = 'active';
  clearSettledAt(currentSession.id);
  document.getElementById('btn-settle').classList.add('hidden');
  await loadPlayers();
  show('view-session', 'back');
  clearSessionTimer();
  const timerEl = document.getElementById('session-timer');
  timerEl.classList.remove('hidden');
  updateSessionTimer(currentSession.created_at);
  sessionTimerInterval = setInterval(() => updateSessionTimer(currentSession.created_at), 60000);
  toast('Session re-opened.', 'success');
});

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD VIEW
   ═══════════════════════════════════════════════════════════════ */

async function loadDashboard() {
  show('view-dashboard');

  const leaderEl = document.getElementById('dash-leader');
  const winEl    = document.getElementById('dash-top-win');
  const lossEl   = document.getElementById('dash-top-loss');

  // Skeleton while fetching
  leaderEl.innerHTML =
    `<div class="dash-skeleton">
       <div class="skeleton-line w-40" style="margin:0 auto 10px"></div>
       <div class="skeleton-line w-60" style="margin:0 auto 10px"></div>
       <div class="skeleton-line w-30" style="margin:0 auto"></div>
     </div>`;
  winEl.innerHTML  = '<div class="skeleton-line w-75"></div>';
  lossEl.innerHTML = '<div class="skeleton-line w-75"></div>';

  const { stats, allResults, error } = await fetchStats();

  if (error || !stats || !Object.keys(stats).length) {
    leaderEl.innerHTML = '<p class="empty-state" style="padding:32px 0">No settled sessions yet.</p>';
    winEl.innerHTML    = '<p class="dash-stat-empty">No data yet</p>';
    lossEl.innerHTML   = '<p class="dash-stat-empty">No data yet</p>';
    return;
  }

  const players = Object.values(stats);

  // ── Champion (most season points) ────────────────────────────
  const leader = rankByPoints(stats)[0];
  leaderEl.innerHTML = `
    <div class="dash-crown"><svg class="icon"><use href="#i-crown"/></svg></div>
    <div class="dash-leader-name">${leader.name}</div>
    <div class="dash-leader-net">${leader.totalPoints} pts</div>
    <div class="dash-leader-meta">${leader.sessions} played · ${leader.wins} win${leader.wins !== 1 ? 's' : ''} · avg ${leader.avgPlace.toFixed(1)}</div>`;

  // ── Most wins ─────────────────────────────────────────────────
  const mostWins = [...players].filter(p => p.wins > 0).sort((a, b) => b.wins - a.wins)[0];
  winEl.innerHTML = mostWins
    ? `<div class="dash-stat-amount positive">${mostWins.wins}</div>
       <div class="dash-stat-name">${mostWins.name}</div>
       <div class="dash-stat-session">tournament win${mostWins.wins !== 1 ? 's' : ''}</div>`
    : '<p class="dash-stat-empty">No wins yet</p>';

  // ── Most played ───────────────────────────────────────────────
  const mostPlayed = [...players].sort((a, b) => b.sessions - a.sessions)[0];
  lossEl.innerHTML = mostPlayed
    ? `<div class="dash-stat-amount">${mostPlayed.sessions}</div>
       <div class="dash-stat-name">${mostPlayed.name}</div>
       <div class="dash-stat-session">tournament${mostPlayed.sessions !== 1 ? 's' : ''} played</div>`
    : '<p class="dash-stat-empty">No data yet</p>';
}

document.getElementById('btn-new-session-dash').addEventListener('click', openNewSessionModal);

/* ═══════════════════════════════════════════════════════════════
   BOTTOM NAVIGATION
   ═══════════════════════════════════════════════════════════════ */

const DETAIL_VIEWS = new Set(['view-session', 'view-settle', 'view-results']);

// Called by: everywhere. dir: 'forward' | 'back' | 'none'
function show(viewId, dir = 'none') {
  document.querySelectorAll('.view').forEach(v =>
    v.classList.remove('active', 'slide-forward', 'slide-back')
  );
  const view = document.getElementById(viewId);
  view.classList.add('active');
  if (dir === 'forward') view.classList.add('slide-forward');
  if (dir === 'back')    view.classList.add('slide-back');

  const nav = document.getElementById('bottom-nav');
  DETAIL_VIEWS.has(viewId) ? nav.classList.add('hidden') : nav.classList.remove('hidden');
}

// Bottom nav buttons
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.view;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (currentMode === 'casino') {
      if (target === 'dashboard')   { show('view-casino-dashboard'); loadCasinoDashboard(); }
      if (target === 'sessions')    { show('view-casino-visits');    loadCasinoVisits();    }
      if (target === 'records')     { show('view-casino-stats');     loadCasinoStats();     }
      if (target === 'leaderboard') { show('view-casino-timer');     initCasinoTimer();     }
    } else {
      if (target === 'dashboard')   { show('view-dashboard');   loadDashboard();   }
      if (target === 'sessions')    { show('view-sessions');    loadSessions();    }
      if (target === 'records')     { show('view-records');     loadRecords();     }
      if (target === 'leaderboard') { show('view-leaderboard'); loadLeaderboard(); }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   SHARED STATS FETCH
   Used by both Leaderboard and Records views.
   ═══════════════════════════════════════════════════════════════ */

async function fetchStats() {
  const { data, error } = await api('/stats');
  if (error) return { error };

  // First pass — field size per tournament (players with a recorded place),
  // so points can scale with how many people were in the game.
  const fieldByDate = {};
  (data || []).forEach(p => { fieldByDate[p.session_date] = (fieldByDate[p.session_date] || 0) + 1; });

  const stats      = {};
  const allResults = [];

  (data || []).forEach(p => {
    const key         = p.player_name.toLowerCase().trim();
    const place       = p.final_chips;                       // finishing place (1 = winner)
    const fieldSize   = fieldByDate[p.session_date] || 1;
    const pts         = placePoints(place, fieldSize);
    const sessionName = p.session_name ?? 'Unknown session';

    if (!stats[key]) {
      stats[key] = { name: p.player_name, sessions: 0, wins: 0, podiums: 0,
                     totalPoints: 0, placeSum: 0, bestPlace: Infinity };
    }
    const s = stats[key];
    s.sessions++;
    s.totalPoints += pts;
    s.placeSum    += place;
    if (place === 1) s.wins++;
    if (place <= 3)  s.podiums++;
    if (place < s.bestPlace) s.bestPlace = place;

    allResults.push({ name: p.player_name, sessionName, place, points: pts, fieldSize });
  });

  // Derived: average finishing place
  Object.values(stats).forEach(s => { s.avgPlace = s.placeSum / s.sessions; });

  return { stats, allResults };
}

/* ── Leaderboard view — rankings only ──────────────────────────── */

async function loadLeaderboard() {
  const list = document.getElementById('leaderboard-list');
  list.innerHTML = skeletonHTML(5);

  const { stats, error } = await fetchStats();
  if (error) { list.innerHTML = `<p class="empty-state">Error: ${error.message}</p>`; return; }
  if (!stats || !Object.keys(stats).length) {
    list.innerHTML = '<p class="empty-state">No settled sessions yet.</p>'; return;
  }

  const sorted   = rankByPoints(stats);
  list.innerHTML = '';

  // ── Podium (top 1–3) ──────────────────────────────────────────
  if (sorted.length >= 1) {
    list.appendChild(buildPodium(sorted));
  }

  // ── Remaining players (#4 onwards) ────────────────────────────
  sorted.slice(3).forEach((p, i) => {
    const rank = i + 4;
    const card = document.createElement('div');
    card.className = 'lb-card';
    card.innerHTML = `
      <span class="lb-rank">#${rank}</span>
      <div class="lb-info">
        <span class="lb-name">${p.name}</span>
        <span class="lb-meta">${p.sessions} played · ${p.wins} win${p.wins !== 1 ? 's' : ''} · avg ${p.avgPlace.toFixed(1)}</span>
      </div>
      <span class="lb-net positive">${p.totalPoints} pts</span>`;
    card.addEventListener('click', () => openPlayerHistory(p.name));
    list.appendChild(card);
  });
}

// Season ranking: points, then wins, then best average finish.
function rankByPoints(stats) {
  return Object.values(stats).sort((a, b) =>
    b.totalPoints - a.totalPoints || b.wins - a.wins || a.avgPlace - b.avgPlace);
}

// Builds the podium element for top 1–3 players.
// Arrangement: 2nd · 1st · 3rd (Olympic order).
function buildPodium(sorted) {
  const wrap = document.createElement('div');
  wrap.className = 'podium-wrap';

  // Reorder: [2nd, 1st, 3rd] for visual display
  const slots = [sorted[1], sorted[0], sorted[2]].filter(Boolean);
  const ranks  = sorted[1] ? [2, 1, 3] : [1]; // handle < 3 players

  slots.forEach((p, idx) => {
    const rank = ranks[idx];
    const step = document.createElement('div');
    step.className = `podium-step podium-rank-${rank}`;

    step.innerHTML = `
      <div class="podium-info">
        <span class="podium-medal">${rank}</span>
        <span class="podium-name">${p.name}</span>
        <span class="podium-net positive">${p.totalPoints} pts</span>
        <span class="podium-meta">${p.sessions} played · ${p.wins} win${p.wins !== 1 ? 's' : ''}</span>
      </div>
      <div class="podium-block">
        <span class="podium-rank-num">${rank}</span>
      </div>`;

    step.addEventListener('click', () => openPlayerHistory(p.name));
    wrap.appendChild(step);
  });

  return wrap;
}

/* ── Records view — records + averages ─────────────────────────── */

async function loadRecords() {
  const ids = ['rec-most-wins','rec-most-points','rec-final-tables','rec-best-avg','rec-most-played'];
  ids.forEach(id => {
    document.getElementById(id).innerHTML = '<p class="empty-state" style="padding:16px 0">Loading…</p>';
  });

  const { stats, error } = await fetchStats();
  if (error || !stats || !Object.keys(stats).length) {
    ids.forEach(id => {
      document.getElementById(id).innerHTML = '<p class="empty-state" style="padding:16px 0">No data yet.</p>';
    });
    return;
  }

  const players = Object.values(stats);
  const sub = n => `across ${n} tournament${n !== 1 ? 's' : ''}`;

  // Most Wins (1st-place finishes)
  renderRecords('rec-most-wins',
    players.filter(p => p.wins > 0).sort((a, b) => b.wins - a.wins).slice(0, 3)
      .map(p => ({ name: p.name, sub: sub(p.sessions), value: `${p.wins} win${p.wins !== 1 ? 's' : ''}` })));

  // Most Points (season total)
  renderRecords('rec-most-points',
    players.sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 3)
      .map(p => ({ name: p.name, sub: sub(p.sessions), value: `${p.totalPoints} pts` })));

  // Most Final Tables (top-3 finishes)
  renderRecords('rec-final-tables',
    players.filter(p => p.podiums > 0).sort((a, b) => b.podiums - a.podiums).slice(0, 3)
      .map(p => ({ name: p.name, sub: sub(p.sessions), value: `${p.podiums}` })));

  // Best Average Finish (lowest avg place, min 3 tournaments)
  renderRecords('rec-best-avg',
    players.filter(p => p.sessions >= 3).sort((a, b) => a.avgPlace - b.avgPlace).slice(0, 3)
      .map(p => ({ name: p.name, sub: sub(p.sessions), value: `${p.avgPlace.toFixed(1)} avg` })));

  // Most Played (tournaments entered)
  renderRecords('rec-most-played',
    players.sort((a, b) => b.sessions - a.sessions).slice(0, 3)
      .map(p => ({ name: p.name, sub: `${p.wins} win${p.wins !== 1 ? 's' : ''} · ${p.podiums} final table${p.podiums !== 1 ? 's' : ''}`, value: `${p.sessions}` })));
}

// Renders a ranked top-3 record list. Each record: { name, sub, value }.
function renderRecords(containerId, records) {
  const el     = document.getElementById(containerId);
  el.innerHTML = '';

  if (!records.length) {
    el.innerHTML = '<p class="empty-state" style="padding:16px 0">No data yet.</p>';
    return;
  }

  records.forEach((r, i) => {
    const rankClass = i === 0 ? 'result-rank-1' : i === 1 ? 'result-rank-2' : i === 2 ? 'result-rank-3' : '';
    const card   = document.createElement('div');
    card.className = `lb-record-card ${rankClass}`.trim();
    card.innerHTML = `
      <span class="lb-record-rank ${['gold', 'silver', 'bronze'][i] ?? ''}">#${i + 1}</span>
      <div class="lb-record-info">
        <span class="lb-record-name">${r.name}</span>
        <span class="lb-record-session">${r.sub}</span>
      </div>
      <span class="lb-record-amount win">${r.value}</span>`;
    el.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════════
   P&L CHART
   ═══════════════════════════════════════════════════════════════ */


/* ── Share Results ───────────────────────────────────────────────── */

document.getElementById('btn-share-results').addEventListener('click', () => {
  const fieldSize = currentPlayers.length;
  const sorted    = [...currentPlayers].sort((a, b) => (a.final_chips ?? 999) - (b.final_chips ?? 999));
  const medals    = ['🥇', '🥈', '🥉'];
  const sep       = '─'.repeat(26);

  let text = `🃏 ${currentSession.name} · ${formatDate(currentSession.created_at)}\n${sep}\n`;
  sorted.forEach((p, i) => {
    const place = p.final_chips;
    const pts   = placePoints(place, fieldSize);
    text += `${medals[i] ?? ` ${place ? ordinal(place) : '—'}`} ${p.player_name} · +${pts} pts\n`;
  });
  text += `${sep}\n${fieldSize} players`;

  if (navigator.share) {
    navigator.share({ title: `${currentSession.name} Results`, text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(
      ()  => toast('Results copied!', 'success'),
      ()  => toast('Could not copy', 'error')
    );
  }
});

/* ═══════════════════════════════════════════════════════════════
   PLAYER HISTORY
   ═══════════════════════════════════════════════════════════════ */

// Called by: leaderboard card click, podium step click
async function openPlayerHistory(playerName) {
  document.getElementById('player-history-name').textContent    = playerName;
  document.getElementById('player-history-summary').textContent = 'Loading…';
  document.getElementById('player-history-list').innerHTML      = skeletonHTML(3);
  document.getElementById('modal-player-history').classList.remove('hidden');

  const { data, error } = await api(`/players/${encodeURIComponent(playerName)}/history`);

  const listEl = document.getElementById('player-history-list');

  if (error) {
    listEl.innerHTML = `<p class="empty-state">Error: ${error.message}</p>`;
    document.getElementById('player-history-summary').textContent = '';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p class="empty-state">No settled sessions yet.</p>';
    document.getElementById('player-history-summary').textContent = 'No history';
    return;
  }

  // Sort by session date, newest first
  data.sort((a, b) => new Date(b.session_date) - new Date(a.session_date));

  let wins = 0, best = Infinity;
  listEl.innerHTML = '';

  data.forEach(row => {
    const place = row.final_chips;
    if (place === 1) wins++;
    if (place != null && place < best) best = place;

    const el = document.createElement('div');
    el.className = 'history-row';
    el.innerHTML = `
      <div class="history-row-info">
        <span class="history-session-name">${row.session_name}</span>
        <span class="history-session-date">${formatDate(row.session_date)}</span>
      </div>
      <div class="history-row-right">
        <span class="history-net ${place === 1 ? 'positive' : ''}">${place != null ? ordinal(place) : '—'}</span>
      </div>`;
    listEl.appendChild(el);
  });

  const bestStr = best === Infinity ? '—' : ordinal(best);
  document.getElementById('player-history-summary').textContent =
    `${data.length} played · ${wins} win${wins !== 1 ? 's' : ''} · best ${bestStr}`;
}

document.getElementById('player-history-close').addEventListener('click', () => {
  document.getElementById('modal-player-history').classList.add('hidden');
});

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════ */

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

/* ═══════════════════════════════════════════════════════════════
   SPLASH SCREEN
   Sequence: bar fills → cards deal in → "Royal Flush" glows →
             splash fades out (app already loaded in background)
   ═══════════════════════════════════════════════════════════════ */

function initSplash(onComplete) {
  const splash   = document.getElementById('splash');
  const bar      = document.getElementById('splash-bar');
  const subtext  = document.getElementById('splash-subtext');
  const rfLabel  = document.getElementById('rf-label');
  const cards    = document.querySelectorAll('.playing-card');

  // Eased progress bar — slow start, slight pause near end for drama
  const steps = [
    { pct: 18,  delay: 180  },
    { pct: 35,  delay: 280  },
    { pct: 52,  delay: 260  },
    { pct: 68,  delay: 220  },
    { pct: 79,  delay: 300  },  // brief hesitation
    { pct: 88,  delay: 200  },
    { pct: 94,  delay: 280  },  // another pause near the end
    { pct: 100, delay: 200  },
  ];

  let elapsed = 0;
  steps.forEach(({ pct, delay }) => {
    setTimeout(() => { bar.style.width = pct + '%'; }, elapsed);
    elapsed += delay;
  });

  // Bar done → change text
  setTimeout(() => {
    subtext.style.opacity = '0';
    setTimeout(() => { subtext.textContent = 'Dealing the hand…'; subtext.style.opacity = '1'; }, 200);
  }, elapsed - 100);

  // Deal cards one by one
  const cardStart = elapsed + 100;
  cards.forEach((card, i) => {
    setTimeout(() => card.classList.add('show'), cardStart + i * 130);
  });

  // "Royal Flush" label after last card
  const labelStart = cardStart + cards.length * 130 + 200;
  setTimeout(() => {
    rfLabel.classList.add('show');
    subtext.style.opacity = '0';
    setTimeout(() => { subtext.textContent = '♠ ♥ ♦ ♣'; subtext.style.opacity = '0.4'; }, 200);
  }, labelStart);

  // Fade out splash
  const fadeStart = labelStart + 1100;
  setTimeout(() => {
    splash.classList.add('fade-out');
    document.body.classList.add('bg-dealt'); // deal the ambient card background as the splash dissolves
    setTimeout(() => {
      splash.style.display = 'none';
      if (onComplete) onComplete();
    }, 750);
  }, fadeStart);
}

/* ═══════════════════════════════════════════════════════════════
   WINNER CELEBRATION
   ═══════════════════════════════════════════════════════════════ */

function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;z-index:998;pointer-events:none;width:100%;height:100%';
  document.body.appendChild(canvas);
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx     = canvas.getContext('2d');

  const COLORS  = ['#f0b429','#2FB67D','#E5484D','#ffffff','#C9A24A','#38bdf8'];
  const SHAPES  = ['rect','circle','diamond'];
  const COUNT   = 140;
  const FRAMES  = 220;

  const particles = Array.from({ length: COUNT }, () => ({
    x:        Math.random() * canvas.width,
    y:        -20 - Math.random() * canvas.height * 0.3,
    vx:       (Math.random() - 0.5) * 5,
    vy:       Math.random() * 3 + 1.5,
    size:     Math.random() * 9 + 4,
    color:    COLORS[Math.floor(Math.random() * COLORS.length)],
    rot:      Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.18,
    shape:    SHAPES[Math.floor(Math.random() * SHAPES.length)],
    wobble:   Math.random() * Math.PI * 2,
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const alpha = Math.max(0, 1 - frame / FRAMES);

    particles.forEach(p => {
      p.wobble += 0.05;
      p.x  += p.vx + Math.sin(p.wobble) * 0.8;
      p.y  += p.vy;
      p.vy += 0.06;
      p.rot += p.rotSpeed;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);

      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -p.size / 2);
        ctx.lineTo(p.size / 2, 0);
        ctx.lineTo(0, p.size / 2);
        ctx.lineTo(-p.size / 2, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });

    frame++;
    if (frame < FRAMES) requestAnimationFrame(draw);
    else canvas.remove();
  }
  requestAnimationFrame(draw);
}

function showWinnerAnnouncement(name, points) {
  const el = document.createElement('div');
  el.className = 'winner-overlay';
  el.innerHTML = `
    <div class="winner-card-announce">
      <div class="winner-trophy"><svg class="icon"><use href="#i-trophy"/></svg></div>
      <div class="winner-announce-name">${name}</div>
      <div class="winner-announce-amount">+${points} pts</div>
      <div class="winner-announce-label">Champion</div>
      <button class="winner-dismiss">Tap to continue</button>
    </div>`;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('show'));

  const dismiss = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 500);
  };

  el.querySelector('.winner-dismiss').addEventListener('click', dismiss);
  setTimeout(dismiss, 4000);
}

/* ═══════════════════════════════════════════════════════════════
   MODE SELECTOR & CASINO MODE
   ═══════════════════════════════════════════════════════════════ */

// Called by: boot()
function updateModeUI(mode) {
  const btns = document.querySelectorAll('.nav-btn');
  const setNavIcon = (btn, id) => btn.querySelector('.nav-icon use').setAttribute('href', id);
  document.body.classList.toggle('mode-home',   mode === 'home');
  document.body.classList.toggle('mode-casino', mode === 'casino');
  if (mode === 'casino') {
    setNavIcon(btns[1], '#i-dice');
    btns[1].querySelector('.nav-label').textContent = 'Visits';
    btns[3].style.display = '';
    setNavIcon(btns[3], '#i-clock');
    btns[3].querySelector('.nav-label').textContent = 'Timer';
  } else {
    setNavIcon(btns[1], '#i-layers');
    btns[1].querySelector('.nav-label').textContent = 'Sessions';
    btns[3].style.display = '';
    setNavIcon(btns[3], '#i-trophy');
    btns[3].querySelector('.nav-label').textContent = 'Leaderboard';
  }
}


// ── Period filter helper ─────────────────────────────────────────

function filterByPeriod(data) {
  if (casinoPeriod === 'all') return data;
  const now = new Date();
  return data.filter(v => {
    const d = new Date(v.created_at);
    if (casinoPeriod === 'year')  return d.getFullYear() === now.getFullYear();
    if (casinoPeriod === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    return true;
  });
}

function setCasinoPeriod(period) {
  casinoPeriod = period;
  document.querySelectorAll('[data-period]').forEach(t => {
    t.classList.toggle('active', t.dataset.period === period);
  });
  const dashActive  = document.getElementById('view-casino-dashboard')?.classList.contains('active');
  const statsActive = document.getElementById('view-casino-stats')?.classList.contains('active');
  if (dashActive)  loadCasinoDashboard();
  if (statsActive) loadCasinoStats();
}

document.querySelectorAll('[data-period]').forEach(tab => {
  tab.addEventListener('click', () => setCasinoPeriod(tab.dataset.period));
});

// ── Casino Dashboard ─────────────────────────────────────────────

async function loadCasinoDashboard() {
  show('view-casino-dashboard');
  const el = document.getElementById('casino-dash-content');
  el.innerHTML = skeletonHTML(2);
  renderNextTrip();

  const { data: raw, error } = await api('/casino/stats');
  const data = filterByPeriod(raw || []);

  if (error || !data.length) {
    el.innerHTML = '<p class="empty-state">No visits recorded yet.<br>Tap + Log a Visit to get started.</p>';
    return;
  }

  const totalPL  = Math.round(data.reduce((s, v) => s + ((v.cash_out ?? 0) - v.buy_in), 0) * 100) / 100;
  const wins     = data.filter(v => (v.cash_out ?? 0) > v.buy_in).length;
  const winRate  = Math.round((wins / data.length) * 100);
  const plStr    = `${totalPL >= 0 ? '+' : ''}${CUR}${Math.abs(totalPL)}`;
  const best     = [...data].sort((a, b) => ((b.cash_out ?? 0) - b.buy_in) - ((a.cash_out ?? 0) - a.buy_in))[0];
  const worst    = [...data].sort((a, b) => ((a.cash_out ?? 0) - a.buy_in) - ((b.cash_out ?? 0) - b.buy_in))[0];
  const bestNet  = Math.round(((best.cash_out ?? 0)  - best.buy_in)  * 100) / 100;
  const worstNet = Math.round(((worst.cash_out ?? 0) - worst.buy_in) * 100) / 100;

  el.innerHTML = `
    <div class="casino-stat-grid">
      <div class="casino-stat-card ${totalPL >= 0 ? 'win' : 'loss'}">
        <div class="casino-stat-label">Total P&amp;L</div>
        <div class="casino-stat-value ${totalPL >= 0 ? 'positive' : 'negative'}">${plStr}</div>
        <div class="casino-stat-sub">${data.length} visit${data.length !== 1 ? 's' : ''} · ${winRate}% win rate</div>
      </div>
      <div class="casino-stat-row">
        <div class="casino-mini-stat">
          <span class="casino-mini-label">Best</span>
          <span class="casino-mini-val positive">+${CUR}${Math.max(0, bestNet)}</span>
          <span class="casino-mini-sub">${best.casino_name}</span>
        </div>
        <div class="casino-mini-stat">
          <span class="casino-mini-label">Worst</span>
          <span class="casino-mini-val negative">-${CUR}${Math.abs(Math.min(0, worstNet))}</span>
          <span class="casino-mini-sub">${worst.casino_name}</span>
        </div>
      </div>
    </div>`;
}

// ── Casino Visits ────────────────────────────────────────────────

async function loadCasinoVisits() {
  show('view-casino-visits');
  const listEl = document.getElementById('casino-visits-list');
  listEl.innerHTML = skeletonHTML(3);

  const { data, error } = await api('/casino/visits');
  if (error) { listEl.innerHTML = '<p class="empty-state">Error loading visits.</p>'; return; }
  if (!data?.length) { listEl.innerHTML = '<p class="empty-state">No visits logged yet.</p>'; return; }

  listEl.innerHTML = '';
  data.forEach(v => {
    const net   = v.cash_out !== null ? Math.round(((v.cash_out ?? 0) - v.buy_in) * 100) / 100 : null;
    const games = v.games ? v.games.split(',').filter(Boolean).map(g => g[0].toUpperCase() + g.slice(1)).join(', ') : '';
    const card  = document.createElement('div');
    card.className = 'session-card';
    card.innerHTML = `
      <div class="session-card-info">
        <span class="session-card-name">${v.casino_name}</span>
        <span class="session-card-meta">${formatDate(v.created_at)}${games ? ' · ' + games : ''}</span>
        <span class="session-card-meta">In ${CUR}${v.buy_in}${v.cash_out !== null ? ' → Out ' + CUR + v.cash_out : ' · Playing'}</span>
      </div>
      <div class="session-card-right">
        ${net !== null
          ? `<span class="lb-net ${net > 0 ? 'positive' : net < 0 ? 'negative' : 'zero'}">${net >= 0 ? '+' : ''}${CUR}${net}</span>`
          : `<span class="badge badge-active">active</span>`}
        <span class="card-edit-hint" title="Tap to edit"><svg class="icon"><use href="#i-pencil"/></svg></span>
        <button class="btn-delete" title="Delete visit"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>`;

    // Tap the card to edit; the ✕ deletes (with undo)
    card.addEventListener('click', e => {
      if (!e.target.closest('.btn-delete')) openCasinoVisitModal(v);
    });
    card.querySelector('.btn-delete').addEventListener('click', e => {
      e.stopPropagation();
      deleteCasinoVisit(v);
    });
    listEl.appendChild(card);
  });
}

// Delete a visit with a 5s undo window (re-creates it on undo).
async function deleteCasinoVisit(v) {
  const { error } = await api(`/casino/visits/${v.id}`, 'DELETE');
  if (error) { toast('Error deleting visit: ' + error.message, 'error'); return; }
  await loadCasinoVisits();

  toastUndo(`Deleted ${v.casino_name} visit`, async () => {
    const { error: re } = await api('/casino/visits', 'POST', {
      casino_name: v.casino_name,
      buy_in:      v.buy_in,
      cash_out:    v.cash_out,
      games:       v.games,
      notes:       v.notes,
      created_at:  v.created_at,
    });
    if (re) { toast('Could not undo', 'error'); return; }
    await loadCasinoVisits();
    toast('Visit restored', 'success');
  });
}

// ── Casino Stats ─────────────────────────────────────────────────

async function loadCasinoStats() {
  show('view-casino-stats');
  const el = document.getElementById('casino-stats-content');
  el.innerHTML = skeletonHTML(3);

  const { data: raw, error } = await api('/casino/stats');
  const data = filterByPeriod(raw || []);
  if (error || !data.length) { el.innerHTML = '<p class="empty-state">No settled visits yet.</p>'; return; }

  // Favourite games
  const gameCounts = {};
  data.forEach(v => (v.games || '').split(',').filter(Boolean).forEach(g => { gameCounts[g] = (gameCounts[g] || 0) + 1; }));
  const topGames = Object.entries(gameCounts).sort(([,a],[,b]) => b - a);

  // Monthly summary
  const months = {};
  data.forEach(v => {
    const m = v.created_at.substring(0, 7);
    if (!months[m]) months[m] = { wins: 0, total: 0, pl: 0 };
    const net = (v.cash_out ?? 0) - v.buy_in;
    months[m].total++;
    months[m].pl = Math.round((months[m].pl + net) * 100) / 100;
    if (net > 0) months[m].wins++;
  });

  // Per casino breakdown
  const venueMap = {};
  data.forEach(v => {
    const key = v.casino_name;
    if (!venueMap[key]) venueMap[key] = { name: key, visits: 0, wins: 0, pl: 0 };
    const net = (v.cash_out ?? 0) - v.buy_in;
    venueMap[key].visits++;
    venueMap[key].pl = Math.round((venueMap[key].pl + net) * 100) / 100;
    if (net > 0) venueMap[key].wins++;
  });
  const venues = Object.values(venueMap).sort((a, b) => b.pl - a.pl);

  el.innerHTML = `
    ${venues.length > 1 ? `
    <div class="lb-record-section">
      <p class="lb-record-title"><svg class="icon"><use href="#i-building"/></svg> By Casino</p>
      <p class="lb-record-desc">Your performance at each venue</p>
      ${venues.map(v => {
        const plStr = `${v.pl >= 0 ? '+' : ''}${CUR}${Math.abs(v.pl)}`;
        const wr = Math.round((v.wins / v.visits) * 100);
        return `<div class="casino-month-row">
          <span class="casino-month-name">${v.name}</span>
          <span class="casino-month-meta">${v.visits} visit${v.visits !== 1 ? 's' : ''} · ${wr}% wins</span>
          <span class="casino-month-pl ${v.pl >= 0 ? 'positive' : 'negative'}">${plStr}</span>
        </div>`;
      }).join('')}
    </div>` : ''}
    ${topGames.length ? `
    <div class="lb-record-section">
      <p class="lb-record-title"><svg class="icon"><use href="#i-dice"/></svg> Favourite Games</p>
      <p class="lb-record-desc">Most played games across all visits</p>
      ${topGames.slice(0, 5).map(([game, count]) => `
        <div class="casino-game-row">
          <span class="casino-game-name">${game[0].toUpperCase() + game.slice(1)}</span>
          <span class="casino-game-count">${count} time${count !== 1 ? 's' : ''}</span>
        </div>`).join('')}
    </div>` : ''}
    <div class="lb-record-section">
      <p class="lb-record-title"><svg class="icon"><use href="#i-calendar"/></svg> Monthly Summary</p>
      <p class="lb-record-desc">Win/loss breakdown by month</p>
      ${Object.entries(months).reverse().map(([month, s]) => {
        const plStr = `${s.pl >= 0 ? '+' : ''}${CUR}${Math.abs(s.pl)}`;
        return `<div class="casino-month-row">
          <span class="casino-month-name">${new Date(month + '-01').toLocaleDateString(undefined,{month:'short',year:'numeric'})}</span>
          <span class="casino-month-meta">${s.wins}/${s.total} wins</span>
          <span class="casino-month-pl ${s.pl >= 0 ? 'positive' : 'negative'}">${plStr}</span>
        </div>`;
      }).join('')}
    </div>`;
}

// ── Casino Visit Modal ───────────────────────────────────────────

function openCasinoVisitModal(visit = null) {
  editingVisitId = visit?.id ?? null;
  selectedGames  = new Set((visit?.games || '').split(',').filter(Boolean));

  document.getElementById('casino-visit-modal-title').textContent = visit ? 'Edit Visit' : 'Log Visit';
  document.getElementById('visit-casino-name').value  = visit?.casino_name ?? '';
  document.getElementById('visit-date').value         = visit ? visit.created_at.split('T')[0] : new Date().toISOString().split('T')[0];
  document.getElementById('visit-buy-in').value       = visit?.buy_in ?? '';
  document.getElementById('visit-cash-out').value     = visit?.cash_out ?? '';
  document.getElementById('visit-notes-input').value  = visit?.notes ?? '';
  document.getElementById('casino-visit-delete').classList.toggle('hidden', !visit);

  document.querySelectorAll('.game-chip').forEach(chip => {
    chip.classList.toggle('selected', selectedGames.has(chip.dataset.game));
  });

  document.getElementById('modal-casino-visit').classList.remove('hidden');
  setTimeout(() => document.getElementById('visit-casino-name').focus(), 50);
}

document.querySelectorAll('.game-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const g = chip.dataset.game;
    selectedGames.has(g) ? selectedGames.delete(g) : selectedGames.add(g);
    chip.classList.toggle('selected', selectedGames.has(g));
  });
});

document.getElementById('casino-visit-cancel').addEventListener('click', () => {
  document.getElementById('modal-casino-visit').classList.add('hidden');
});

document.getElementById('casino-visit-confirm').addEventListener('click', async () => {
  const name    = document.getElementById('visit-casino-name').value.trim();
  const buyIn   = parseFloat(document.getElementById('visit-buy-in').value);
  const cashOut = document.getElementById('visit-cash-out').value;
  const dateVal = document.getElementById('visit-date').value;
  const notes   = document.getElementById('visit-notes-input').value.trim();

  if (!name)         { toast('Enter a casino name.', 'error'); return; }
  if (!buyIn || buyIn <= 0) { toast('Enter a buy-in amount.', 'error'); return; }

  const games      = [...selectedGames].join(',');
  const cashOutVal = cashOut ? parseFloat(cashOut) : null;
  const created_at = dateVal ? new Date(dateVal + 'T20:00:00').toISOString() : undefined;

  document.getElementById('modal-casino-visit').classList.add('hidden');

  if (editingVisitId) {
    await api(`/casino/visits/${editingVisitId}`, 'PATCH', { casino_name: name, buy_in: buyIn, cash_out: cashOutVal, games, notes });
  } else {
    await api('/casino/visits', 'POST', { casino_name: name, buy_in: buyIn, cash_out: cashOutVal, games, notes, ...(created_at && { created_at }) });
  }

  if (document.getElementById('view-casino-visits').classList.contains('active')) loadCasinoVisits();
  else loadCasinoDashboard();
  toast(editingVisitId ? 'Visit updated.' : 'Visit logged!', 'success');
});

document.getElementById('casino-visit-delete').addEventListener('click', async () => {
  if (!editingVisitId) return;
  document.getElementById('modal-casino-visit').classList.add('hidden');
  await api(`/casino/visits/${editingVisitId}`, 'DELETE');
  loadCasinoVisits();
  toast('Visit deleted.', 'success');
});

document.getElementById('btn-new-visit').addEventListener('click',   () => openCasinoVisitModal());
document.getElementById('btn-new-visit-2').addEventListener('click', () => openCasinoVisitModal());

// ── Next Trip Scheduler ──────────────────────────────────────────

function getNextTrip() {
  try { return JSON.parse(localStorage.getItem('casino_next_trip')); } catch { return null; }
}

function renderNextTrip() {
  const trip = getNextTrip();
  const el   = document.getElementById('casino-next-trip');
  if (!trip) { el.classList.add('hidden'); return; }

  const tripDate  = new Date(trip.date);
  const today     = new Date(); today.setHours(0,0,0,0);
  const diffDays  = Math.ceil((tripDate - today) / 86400000);
  const countdown = diffDays < 0 ? 'Past' : diffDays === 0 ? 'Today! 🎉' : diffDays === 1 ? 'Tomorrow' : `in ${diffDays} days`;

  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="next-trip-card">
      <span class="next-trip-icon"><svg class="icon"><use href="#i-calendar"/></svg></span>
      <div class="next-trip-info">
        <span class="next-trip-name">${trip.name}</span>
        <span class="next-trip-date">${formatDate(trip.date + 'T00:00:00')} · ${countdown}</span>
      </div>
      <button id="btn-edit-trip" class="btn btn-ghost btn-sm">Edit</button>
    </div>`;
  document.getElementById('btn-edit-trip').addEventListener('click', openTripModal);
}

function openTripModal() {
  const trip = getNextTrip();
  document.getElementById('trip-casino-name').value = trip?.name ?? '';
  document.getElementById('trip-date').value         = trip?.date ?? new Date().toISOString().split('T')[0];
  document.getElementById('modal-schedule-trip').classList.remove('hidden');
  setTimeout(() => document.getElementById('trip-casino-name').focus(), 50);
}

document.getElementById('btn-schedule-trip').addEventListener('click', openTripModal);

document.getElementById('trip-cancel').addEventListener('click', () => {
  document.getElementById('modal-schedule-trip').classList.add('hidden');
});

document.getElementById('trip-clear').addEventListener('click', () => {
  localStorage.removeItem('casino_next_trip');
  document.getElementById('modal-schedule-trip').classList.add('hidden');
  renderNextTrip();
});

document.getElementById('trip-confirm').addEventListener('click', () => {
  const name = document.getElementById('trip-casino-name').value.trim();
  const date = document.getElementById('trip-date').value;
  if (!name || !date) { toast('Enter a casino name and date.', 'error'); return; }
  localStorage.setItem('casino_next_trip', JSON.stringify({ name, date }));
  document.getElementById('modal-schedule-trip').classList.add('hidden');
  renderNextTrip();
  toast('Trip scheduled!', 'success');
});

// ── Blinds Timer ─────────────────────────────────────────────────

function initCasinoTimer() {
  // The back button only applies when the timer is launched from a Home-game
  // session; when reached via the Casino nav tab the bottom nav is the way out.
  document.getElementById('btn-back-timer').classList.add('hidden');
  show('view-casino-timer');
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const level = blindSchedule[timerLevel];
  const next  = blindSchedule[timerLevel + 1];
  const mins  = Math.floor(timerSecondsLeft / 60);
  const secs  = timerSecondsLeft % 60;

  document.getElementById('timer-level-num').textContent     = timerLevel + 1;
  document.getElementById('timer-current-blinds').textContent = `${level.small} / ${level.big}`;
  document.getElementById('timer-next-blinds').textContent   = next ? `${next.small} / ${next.big}` : 'Final Level';
  document.getElementById('timer-toggle').innerHTML          = timerRunning ? '<svg class="icon"><use href="#i-pause"/></svg> Pause' : '<svg class="icon"><use href="#i-play"/></svg> Start';

  const el = document.getElementById('timer-countdown');
  el.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  el.className   = `timer-countdown${timerSecondsLeft <= 60 ? ' timer-warning' : ''}`;

  // Chip guides: smallest chip worth keeping + the starting-stack breakdown.
  document.getElementById('timer-smallest-chip').textContent = smallestChip(level.small).toLocaleString();
  const stackRow = document.getElementById('timer-stack-row');
  if (activeStructure) {
    document.getElementById('timer-stack-total').textContent     = activeStructure.chips.toLocaleString();
    document.getElementById('timer-stack-breakdown').textContent = formatBreakdown(activeStructure.breakdown);
    stackRow.classList.remove('hidden');
  } else {
    stackRow.classList.add('hidden');
  }
}

document.getElementById('timer-toggle').addEventListener('click', () => {
  timerRunning = !timerRunning;
  if (timerRunning) {
    timerInterval = setInterval(() => {
      timerSecondsLeft--;
      if (timerSecondsLeft <= 0) {
        if (timerLevel < blindSchedule.length - 1) {
          const prevChip = smallestChip(blindSchedule[timerLevel].small);
          timerLevel++;
          timerSecondsLeft = timerLevelDuration;
          toast(`Level ${timerLevel + 1} — ${blindSchedule[timerLevel].small}/${blindSchedule[timerLevel].big}`, 'info', 4000);
          const nowChip = smallestChip(blindSchedule[timerLevel].small);
          if (nowChip > prevChip) {
            toast(`Colour up — race off the ${prevChip.toLocaleString()} chips`, 'info', 5000);
          }
        } else {
          timerRunning = false;
          clearInterval(timerInterval);
          timerSecondsLeft = 0;
          toast('Final blind level reached!', 'info', 5000);
        }
      }
      updateTimerDisplay();
    }, 1000);
  } else {
    clearInterval(timerInterval);
  }
  updateTimerDisplay();
});

document.getElementById('timer-reset').addEventListener('click', () => {
  clearInterval(timerInterval);
  timerRunning      = false;
  timerSecondsLeft  = timerLevelDuration;
  updateTimerDisplay();
});

document.getElementById('timer-prev').addEventListener('click', () => {
  if (timerLevel > 0) {
    clearInterval(timerInterval); timerRunning = false;
    timerLevel--; timerSecondsLeft = timerLevelDuration;
    updateTimerDisplay();
  }
});

document.getElementById('timer-next-btn').addEventListener('click', () => {
  if (timerLevel < blindSchedule.length - 1) {
    clearInterval(timerInterval); timerRunning = false;
    timerLevel++; timerSecondsLeft = timerLevelDuration;
    updateTimerDisplay();
  }
});

document.getElementById('timer-duration').addEventListener('change', e => {
  timerLevelDuration = parseInt(e.target.value, 10);
  timerSecondsLeft   = timerLevelDuration;
  clearInterval(timerInterval); timerRunning = false;
  updateTimerDisplay();
});

// Home Game: launch the blinds timer from inside the active session,
// and the timer's back button returns to that session.
document.getElementById('btn-blinds-timer').addEventListener('click', () => {
  initCasinoTimer();
  document.getElementById('btn-back-timer').classList.remove('hidden');
});
document.getElementById('btn-back-timer').addEventListener('click', () => show('view-session', 'back'));

/* ═══════════════════════════════════════════════════════════════
   LOCK SCREEN
   ═══════════════════════════════════════════════════════════════ */

// Apply the configured currency symbol to static markup (input prefixes, pot placeholders).
function applyCurrency() {
  document.querySelectorAll('.input-prefix').forEach(el => { el.textContent = CUR; });
  ['results-pot', 'session-live-pot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = `${CUR}0`;
  });
}

function boot() {
  applyCurrency();
  currentMode = 'home';
  updateModeUI('home');
  initSplash(() => {});
  loadDashboard();
}

/* ── Boot ─────────────────────────────────────────────────────── */
boot();

/* ── Service Worker registration (PWA) ─────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.warn('Service worker registration failed:', err)
    );
  });
}

/* ── Android/Chrome install prompt ─────────────────────────────── */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();                 // stop Chrome's default mini-infobar
  deferredInstallPrompt = e;
  if (sessionStorage.getItem('install_dismissed') !== 'true') {
    document.getElementById('install-banner').classList.remove('hidden');
  }
});

document.getElementById('install-accept').addEventListener('click', async () => {
  document.getElementById('install-banner').classList.add('hidden');
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

document.getElementById('install-dismiss').addEventListener('click', () => {
  sessionStorage.setItem('install_dismissed', 'true');
  document.getElementById('install-banner').classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  document.getElementById('install-banner').classList.add('hidden');
  deferredInstallPrompt = null;
});
