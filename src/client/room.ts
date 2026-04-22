import type {
  ActionRequest,
  PublicParticipant,
  PublicSession,
  DeckPreset,
} from '../../lib/types.js';

// ─── State ────────────────────────────────────────────────────────────────

const code = location.pathname.replace(/^\/r\//, '').toUpperCase();
let participantId: string | null = null;
let session: PublicSession | null = null;
let pollTimer: number | null = null;
let pollInFlight = false;
let consecutiveErrors = 0;
let pollAbort: AbortController | null = null;

const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 5000;
const pollInterval = () => (document.hidden ? SLOW_POLL_MS : FAST_POLL_MS);

const storageKey = `spp:${code}`;

interface Stored {
  participantId: string | null;
  name: string;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function writeStored(s: Stored) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(s));
  } catch {
    // ignore
  }
}

function clearStored() {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

// ─── DOM refs ─────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

const dialog = $('name-dialog') as HTMLDialogElement | null;
const dialogForm = $('name-form') as HTMLFormElement | null;
const dialogName = $('dialog-name') as HTMLInputElement | null;
const dialogCode = $('dialog-code');
const roomCode = $('room-code');
const storyInput = $('story-input') as HTMLInputElement | null;
const storyDisplay = $('story-display');
const seatsEl = $('seats') as HTMLUListElement | null;
const tableCenter = $('table-center');
const deckEl = $('deck') as HTMLUListElement | null;
const yourCardEl = $('your-card');
const statsEl = $('stats');
const statAvg = $('stat-avg');
const statMedian = $('stat-median');
const statSpread = $('stat-spread');
const statConsensus = $('stat-consensus');
const statDist = $('stat-dist');
const copyLinkBtn = $('copy-link') as HTMLButtonElement | null;
const copyLinkBtn2 = $('copy-link-2') as HTMLButtonElement | null;
const revealBtn = $('reveal-btn') as HTMLButtonElement | null;
const resetBtn = $('reset-btn') as HTMLButtonElement | null;
const deckSelect = $('deck-select') as HTMLSelectElement | null;
const connIndicator = $('conn-indicator');
const toast = $('toast');

if (dialogCode) dialogCode.textContent = code;
if (roomCode) roomCode.textContent = code;

// ─── Transport ─────────────────────────────────────────────────────────────

function setConn(state: 'connecting' | 'open' | 'closed') {
  if (!connIndicator) return;
  connIndicator.className = `conn conn--${state}`;
  const label = connIndicator.querySelector('.conn__label');
  if (label) {
    label.textContent =
      state === 'connecting' ? 'connecting' : state === 'open' ? 'live' : 'offline';
  }
}

async function joinApi(name: string, existingId: string | null): Promise<boolean> {
  try {
    const resp = await fetch(`/api/sessions/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'join',
        name,
        existingId: existingId || undefined,
      }),
    });
    if (resp.status === 404) {
      clearStored();
      showToast('This session no longer exists.');
      setTimeout(() => (location.href = '/'), 1500);
      return false;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as {
      participantId: string;
      session: PublicSession;
    };
    participantId = data.participantId;
    writeStored({ participantId, name });
    session = data.session;
    setConn('open');
    render();
    return true;
  } catch {
    setConn('closed');
    consecutiveErrors++;
    return false;
  }
}

async function pollOnce(): Promise<void> {
  if (!participantId || pollInFlight) return;
  pollInFlight = true;
  pollAbort = new AbortController();
  try {
    const resp = await fetch(
      `/api/sessions/${code}?pid=${encodeURIComponent(participantId)}`,
      { signal: pollAbort.signal }
    );
    if (resp.status === 404) {
      clearStored();
      showToast('This session no longer exists.');
      setTimeout(() => (location.href = '/'), 1500);
      return;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { session: PublicSession; kicked?: boolean };
    if (data.kicked) {
      clearStored();
      showToast('You were removed from the room.');
      setTimeout(() => (location.href = '/'), 1200);
      return;
    }
    session = data.session;

    // If my pid disappeared (race) — treat as kicked.
    if (!session.participants.some((p) => p.id === participantId)) {
      clearStored();
      showToast('You were removed from the room.');
      setTimeout(() => (location.href = '/'), 1200);
      return;
    }

    consecutiveErrors = 0;
    setConn('open');
    render();
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    consecutiveErrors++;
    if (consecutiveErrors >= 2) setConn('closed');
  } finally {
    pollInFlight = false;
  }
}

function schedulePoll() {
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(async () => {
    await pollOnce();
    schedulePoll();
  }, pollInterval());
}

async function sendAction(msg: ActionRequest): Promise<void> {
  if (!participantId) return;
  try {
    const resp = await fetch(`/api/sessions/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!resp.ok) {
      if (resp.status === 404) {
        clearStored();
        showToast('This session no longer exists.');
        setTimeout(() => (location.href = '/'), 1500);
      } else if (resp.status === 403) {
        showToast('Only the host can do that.');
      } else {
        const body = (await resp.json().catch(() => null)) as { error?: string } | null;
        if (body?.error) showToast(body.error);
      }
      return;
    }
    const data = (await resp.json()) as { session: PublicSession };
    session = data.session;
    consecutiveErrors = 0;
    setConn('open');
    render();
  } catch {
    consecutiveErrors++;
    if (consecutiveErrors >= 2) setConn('closed');
  }
}

// ─── Toast ─────────────────────────────────────────────────────────────────

let toastTimer: number | null = null;
function showToast(msg: string) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('toast--show');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('toast--show');
  }, 2200);
}

// ─── Render ────────────────────────────────────────────────────────────────

function render() {
  if (!session) return;
  const me = session.participants.find((p) => p.id === participantId);
  const isHost = !!me && me.isHost;

  document.querySelectorAll<HTMLElement>('[data-host-only]').forEach((el) => {
    el.hidden = !isHost;
  });
  document.querySelectorAll<HTMLElement>('[data-guest-only]').forEach((el) => {
    el.hidden = isHost;
  });

  if (storyInput && document.activeElement !== storyInput) {
    storyInput.value = session.storyTitle || '';
  }
  if (storyDisplay) {
    storyDisplay.textContent =
      session.storyTitle || 'Waiting for the host to set a story…';
  }

  if (deckSelect && deckSelect.value !== session.deck) {
    deckSelect.value = session.deck;
  }

  renderSeats(me);
  renderCenter(me, isHost);
  renderDeck(me);
  renderStats();
}

function renderSeats(me: PublicParticipant | undefined) {
  if (!seatsEl || !session) return;
  seatsEl.textContent = '';
  for (const p of session.participants) {
    const li = document.createElement('li');
    li.className = 'seat';
    li.dataset.id = p.id;
    if (!p.connected) li.classList.add('seat--offline');
    if (p.id === participantId) li.classList.add('seat--me');

    const card = document.createElement('div');
    card.className = 'seat__card';
    if (session.revealed && p.vote !== null) card.classList.add('seat__card--revealed');
    else if (p.hasVoted) card.classList.add('seat__card--voted');
    else card.classList.add('seat__card--placeholder');

    const back = document.createElement('div');
    back.className = 'face back';
    const front = document.createElement('div');
    front.className = 'face front';
    front.textContent = p.vote ?? '';
    card.appendChild(back);
    card.appendChild(front);
    li.appendChild(card);

    const name = document.createElement('span');
    name.className = 'seat__name';
    name.textContent = p.name + (p.id === participantId ? ' (you)' : '');
    name.title = p.name;
    li.appendChild(name);

    if (p.isHost) {
      const tag = document.createElement('span');
      tag.className = 'seat__tag';
      tag.textContent = 'host';
      li.appendChild(tag);
    }

    if (me?.isHost && p.id !== participantId) {
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.className = 'seat__kick';
      kick.title = `Remove ${p.name}`;
      kick.textContent = '×';
      kick.addEventListener('click', () => {
        if (confirm(`Remove ${p.name} from the room?`)) {
          sendAction({ action: 'kick', participantId: participantId!, targetId: p.id });
        }
      });
      li.appendChild(kick);
    }
    seatsEl.appendChild(li);
  }
}

function renderCenter(me: PublicParticipant | undefined, isHost: boolean) {
  if (!tableCenter || !session) return;
  tableCenter.textContent = '';

  const voters = session.participants.filter((p) => p.connected);
  const voted = voters.filter((p) => p.hasVoted).length;

  if (session.revealed) {
    const numericVotes = session.participants
      .map((p) => numericValue(p.vote))
      .filter((v): v is number => v !== null);

    if (numericVotes.length === 0) {
      tableCenter.appendChild(
        buildCenterPill({
          eyebrow: 'Revealed',
          big: '—',
          sub: 'No numeric votes to summarise',
          button: isHost
            ? {
                label: 'New round',
                handler: () =>
                  sendAction({ action: 'reset', participantId: participantId! }),
              }
            : null,
        })
      );
    } else {
      const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
      tableCenter.appendChild(
        buildCenterPill({
          eyebrow: 'Team average',
          big: formatNumber(avg),
          sub: consensusLabel(numericVotes),
          button: isHost
            ? {
                label: 'New round',
                handler: () =>
                  sendAction({ action: 'reset', participantId: participantId! }),
              }
            : null,
        })
      );
    }
  } else if (voters.length === 0) {
    tableCenter.appendChild(
      buildCenterPill({
        eyebrow: 'Waiting',
        title: 'Nobody here yet.',
        sub: 'Share the code in chat to get teammates in.',
        button: null,
      })
    );
  } else if (voted === voters.length) {
    tableCenter.appendChild(
      buildCenterPill({
        eyebrow: "Everyone's ready",
        title: `${voted} of ${voters.length} have voted.`,
        button: isHost
          ? {
              label: 'Reveal cards',
              handler: () =>
                sendAction({ action: 'reveal', participantId: participantId! }),
              primary: true,
            }
          : { label: 'Waiting for host to reveal…', handler: null },
      })
    );
  } else {
    tableCenter.appendChild(
      buildCenterPill({
        eyebrow: 'In progress',
        title: `${voted} of ${voters.length} have voted.`,
        sub: me?.hasVoted ? 'Your card is locked in.' : 'Pick a card below.',
        button: isHost
          ? {
              label: 'Reveal now',
              handler: () =>
                sendAction({ action: 'reveal', participantId: participantId! }),
            }
          : null,
      })
    );
  }
}

interface CenterPillConfig {
  eyebrow: string;
  title?: string;
  big?: string;
  sub?: string;
  button: { label: string; handler: (() => void) | null; primary?: boolean } | null;
}

function buildCenterPill(cfg: CenterPillConfig): HTMLElement {
  const pill = document.createElement('div');
  pill.className = 'center-pill';
  const eb = document.createElement('span');
  eb.className = 'center-pill__eyebrow';
  eb.textContent = cfg.eyebrow;
  pill.appendChild(eb);
  if (cfg.big) {
    const big = document.createElement('span');
    big.className = 'center-pill__big';
    big.textContent = cfg.big;
    pill.appendChild(big);
  }
  if (cfg.title) {
    const t = document.createElement('span');
    t.className = 'center-pill__title';
    t.textContent = cfg.title;
    pill.appendChild(t);
  }
  if (cfg.sub) {
    const s = document.createElement('span');
    s.style.color = 'var(--ink-mute)';
    s.style.fontSize = '13px';
    s.textContent = cfg.sub;
    pill.appendChild(s);
  }
  if (cfg.button) {
    const btn = document.createElement('button');
    btn.className = `btn ${cfg.button.primary ? 'btn--primary' : 'btn--ghost'}`;
    btn.style.marginTop = '8px';
    btn.type = 'button';
    btn.textContent = cfg.button.label;
    if (cfg.button.handler) {
      btn.addEventListener('click', cfg.button.handler);
    } else {
      btn.disabled = true;
    }
    pill.appendChild(btn);
  }
  return pill;
}

function renderDeck(me: PublicParticipant | undefined) {
  if (!deckEl || !session) return;
  deckEl.textContent = '';

  const myVote = me?.vote ?? null;
  for (const c of session.deckCards) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-btn';
    btn.textContent = c;
    if (myVote === c) btn.classList.add('card-btn--selected');
    if (session.revealed) btn.disabled = true;
    btn.addEventListener('click', () => {
      if (!participantId) return;
      sendAction({
        action: 'vote',
        participantId,
        value: myVote === c ? '' : c,
      });
    });
    li.appendChild(btn);
    deckEl.appendChild(li);
  }

  if (yourCardEl) {
    yourCardEl.textContent = me?.hasVoted
      ? session.revealed
        ? me.vote ?? '—'
        : '●'
      : '—';
    (yourCardEl as HTMLElement).style.color = me?.hasVoted
      ? 'var(--amber)'
      : 'var(--ink-mute)';
  }

  if (revealBtn) {
    revealBtn.disabled = session.revealed;
    revealBtn.textContent = session.revealed ? 'Revealed' : 'Reveal cards';
    revealBtn.onclick = () =>
      sendAction({ action: 'reveal', participantId: participantId! });
  }
  if (resetBtn) {
    resetBtn.textContent = 'New round';
    resetBtn.onclick = () =>
      sendAction({ action: 'reset', participantId: participantId! });
  }
}

function renderStats() {
  if (!statsEl || !session) return;
  if (!session.revealed) {
    statsEl.hidden = true;
    return;
  }
  const numericVotes = session.participants
    .map((p) => numericValue(p.vote))
    .filter((v): v is number => v !== null);

  if (numericVotes.length === 0) {
    statsEl.hidden = true;
    return;
  }
  statsEl.hidden = false;

  const sorted = [...numericVotes].sort((a, b) => a - b);
  const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const spread = sorted[sorted.length - 1] - sorted[0];

  if (statAvg) statAvg.textContent = formatNumber(avg);
  if (statMedian) statMedian.textContent = formatNumber(median);
  if (statSpread) statSpread.textContent = formatNumber(spread);
  if (statConsensus) {
    const c = consensusLabel(numericVotes);
    statConsensus.textContent = c;
    statConsensus.classList.toggle('stats__val--highlight', c === 'Unanimous');
  }

  if (statDist) {
    statDist.textContent = '';
    const counts = new Map<string, number>();
    for (const p of session.participants) {
      if (p.vote === null || p.vote === undefined) continue;
      counts.set(p.vote, (counts.get(p.vote) || 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    for (const card of session.deckCards) {
      const count = counts.get(card) || 0;
      if (count === 0) continue;
      const bar = document.createElement('div');
      bar.className = 'stats__bar';
      if (count === max) bar.classList.add('stats__bar--amber');
      bar.style.height = `${Math.max(20, (count / max) * 60)}px`;

      const countEl = document.createElement('span');
      countEl.className = 'stats__bar__count';
      countEl.textContent = String(count);
      bar.appendChild(countEl);

      const label = document.createElement('span');
      label.className = 'stats__bar__label';
      label.textContent = card;
      bar.appendChild(label);

      statDist.appendChild(bar);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function numericValue(v: string | null | undefined): number | null {
  if (!v) return null;
  if (v === '?' || v === '☕') return null;
  if (v === '½') return 0.5;
  if (v === 'XS') return 1;
  if (v === 'S') return 2;
  if (v === 'M') return 3;
  if (v === 'L') return 5;
  if (v === 'XL') return 8;
  if (v === 'XXL') return 13;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n - Math.round(n)) < 0.01) return String(Math.round(n));
  return n.toFixed(1);
}

function consensusLabel(numericVotes: number[]): string {
  if (numericVotes.length < 2) return '—';
  const unique = new Set(numericVotes);
  if (unique.size === 1) return 'Unanimous';
  const sorted = [...numericVotes].sort((a, b) => a - b);
  const spread = sorted[sorted.length - 1] - sorted[0];
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === 0) return spread === 0 ? 'Unanimous' : 'Split';
  const ratio = spread / Math.max(1, median);
  if (ratio <= 0.4) return 'Aligned';
  if (ratio <= 1.0) return 'Close';
  return 'Split';
}

// ─── Interactions ──────────────────────────────────────────────────────────

let storyDebounce: number | null = null;
storyInput?.addEventListener('input', () => {
  if (!participantId) return;
  const value = storyInput.value;
  if (storyDebounce) window.clearTimeout(storyDebounce);
  storyDebounce = window.setTimeout(() => {
    sendAction({ action: 'setStory', participantId: participantId!, title: value });
  }, 300);
});

deckSelect?.addEventListener('change', () => {
  if (!participantId) return;
  sendAction({
    action: 'setDeck',
    participantId,
    deck: deckSelect.value as DeckPreset,
  });
});

const copyLink = () => {
  const url = `${location.origin}/r/${code}`;
  navigator.clipboard
    .writeText(url)
    .then(() => showToast('Invite link copied.'))
    .catch(() => {
      showToast(url);
    });
};

copyLinkBtn?.addEventListener('click', copyLink);
copyLinkBtn2?.addEventListener('click', copyLink);

document.addEventListener('visibilitychange', () => {
  // Reschedule with new interval. Fire immediately on visible so state is fresh.
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  if (!document.hidden && participantId) {
    pollOnce().then(() => schedulePoll());
  } else {
    schedulePoll();
  }
});

window.addEventListener('beforeunload', () => {
  if (pollAbort) pollAbort.abort();
  if (pollTimer !== null) window.clearTimeout(pollTimer);
});

// ─── Boot ──────────────────────────────────────────────────────────────────

async function boot() {
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    location.href = '/';
    return;
  }
  setConn('connecting');
  const stored = readStored();
  if (stored && stored.name) {
    const ok = await joinApi(stored.name, stored.participantId);
    if (ok) schedulePoll();
  } else if (dialog) {
    dialog.showModal();
    dialogForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (dialogName?.value || '').trim();
      if (!name) return;
      dialog.close();
      writeStored({ participantId: null, name });
      const ok = await joinApi(name, null);
      if (ok) schedulePoll();
    });
  }
}

boot();
