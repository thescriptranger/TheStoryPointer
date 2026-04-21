import type {
  ClientMessage,
  ServerMessage,
  PublicSession,
  PublicParticipant,
  DeckPreset,
} from '../shared/types.js';

// ─── Config / state ────────────────────────────────────────────────────────

const code = location.pathname.replace(/^\/r\//, '').toUpperCase();
let participantId: string | null = null;
let session: PublicSession | null = null;
let ws: WebSocket | null = null;
let reconnectDelay = 500;
let reconnectTimer: number | null = null;
let manualClose = false;

const storageKey = `spp:${code}`;

interface Stored {
  participantId: string | null;
  name: string;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as Stored;
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

// ─── DOM refs ──────────────────────────────────────────────────────────────

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

// ─── Connection lifecycle ──────────────────────────────────────────────────

function setConn(state: 'connecting' | 'open' | 'closed') {
  if (!connIndicator) return;
  connIndicator.className = `conn conn--${state}`;
  const label = connIndicator.querySelector('.conn__label');
  if (label) {
    label.textContent =
      state === 'connecting'
        ? 'connecting'
        : state === 'open'
          ? 'live'
          : 'offline';
  }
}

function openSocket(name: string, existingId: string | null) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  setConn('connecting');

  sock.addEventListener('open', () => {
    reconnectDelay = 500;
    const msg: ClientMessage = {
      type: 'join',
      code,
      name,
      existingId: existingId || undefined,
    };
    sock.send(JSON.stringify(msg));
  });

  sock.addEventListener('message', (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data) as ServerMessage;
    } catch {
      return;
    }
    handleServer(msg);
  });

  sock.addEventListener('close', () => {
    setConn('closed');
    ws = null;
    if (manualClose) return;
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
    reconnectTimer = window.setTimeout(() => {
      const stored = readStored();
      if (stored) openSocket(stored.name, stored.participantId);
    }, reconnectDelay);
  });

  sock.addEventListener('error', () => {
    // close handler will schedule reconnect
  });
}

function send(msg: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleServer(msg: ServerMessage) {
  switch (msg.type) {
    case 'joined': {
      participantId = msg.participantId;
      const stored = readStored();
      writeStored({ participantId, name: stored?.name || '' });
      session = msg.session;
      setConn('open');
      render();
      break;
    }
    case 'state':
      session = msg.session;
      render();
      break;
    case 'kicked':
      manualClose = true;
      clearStored();
      showToast('You were removed from the room.');
      setTimeout(() => (location.href = '/'), 1200);
      break;
    case 'error':
      if (msg.message === 'Session not found') {
        manualClose = true;
        clearStored();
        showToast('This session no longer exists.');
        setTimeout(() => (location.href = '/'), 1500);
      } else {
        showToast(msg.message);
      }
      break;
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

// ─── Rendering ─────────────────────────────────────────────────────────────

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

  // Story title
  if (storyInput && document.activeElement !== storyInput) {
    storyInput.value = session.storyTitle || '';
  }
  if (storyDisplay) {
    storyDisplay.textContent =
      session.storyTitle || 'Waiting for the host to set a story…';
  }

  // Deck selector
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
  const prev = new Map<string, HTMLLIElement>();
  seatsEl.querySelectorAll<HTMLLIElement>('li[data-id]').forEach((el) => {
    prev.set(el.dataset.id!, el);
  });

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

    // Host kick button (not on self)
    if (me?.isHost && p.id !== participantId) {
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.className = 'seat__kick';
      kick.title = `Remove ${p.name}`;
      kick.textContent = '×';
      kick.addEventListener('click', () => {
        if (confirm(`Remove ${p.name} from the room?`)) {
          send({ type: 'kick', targetId: p.id });
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
      tableCenter.appendChild(buildCenterPill({
        eyebrow: 'Revealed',
        big: '—',
        sub: 'No numeric votes to summarise',
        button: isHost ? { label: 'New round', handler: () => send({ type: 'reset' }) } : null,
      }));
    } else {
      const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
      tableCenter.appendChild(buildCenterPill({
        eyebrow: 'Team average',
        big: formatNumber(avg),
        sub: consensusLabel(numericVotes),
        button: isHost ? { label: 'New round', handler: () => send({ type: 'reset' }) } : null,
      }));
    }
  } else if (voters.length === 0) {
    tableCenter.appendChild(buildCenterPill({
      eyebrow: 'Waiting',
      title: 'Nobody here yet.',
      sub: 'Share the code in chat to get teammates in.',
      button: null,
    }));
  } else if (voted === voters.length) {
    tableCenter.appendChild(buildCenterPill({
      eyebrow: "Everyone's ready",
      title: `${voted} of ${voters.length} have voted.`,
      button: isHost
        ? { label: 'Reveal cards', handler: () => send({ type: 'reveal' }), primary: true }
        : { label: 'Waiting for host to reveal…', handler: null },
    }));
  } else {
    tableCenter.appendChild(buildCenterPill({
      eyebrow: 'In progress',
      title: `${voted} of ${voters.length} have voted.`,
      sub: me?.hasVoted ? 'Your card is locked in.' : 'Pick a card below.',
      button: isHost
        ? { label: 'Reveal now', handler: () => send({ type: 'reveal' }) }
        : null,
    }));
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
      if (myVote === c) {
        send({ type: 'vote', value: '' });
      } else {
        send({ type: 'vote', value: c });
      }
    });
    li.appendChild(btn);
    deckEl.appendChild(li);
  }

  if (yourCardEl) {
    yourCardEl.textContent = me?.hasVoted ? (session.revealed ? (me.vote ?? '—') : '●') : '—';
    yourCardEl.style.color = me?.hasVoted ? 'var(--amber)' : 'var(--ink-mute)';
  }

  // reveal/reset toggle labels
  if (revealBtn) {
    revealBtn.disabled = session.revealed;
    revealBtn.textContent = session.revealed ? 'Revealed' : 'Reveal cards';
    revealBtn.onclick = () => send({ type: 'reveal' });
  }
  if (resetBtn) {
    resetBtn.textContent = 'New round';
    resetBtn.onclick = () => send({ type: 'reset' });
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

  // Distribution bar chart across the deck's numeric cards
  if (statDist) {
    statDist.textContent = '';
    const counts = new Map<string, number>();
    for (const p of session.participants) {
      if (p.vote === null || p.vote === undefined) continue;
      counts.set(p.vote, (counts.get(p.vote) || 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    // Order by deck order
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
  const value = storyInput.value;
  if (storyDebounce) window.clearTimeout(storyDebounce);
  storyDebounce = window.setTimeout(() => {
    send({ type: 'setStory', title: value });
  }, 250);
});

deckSelect?.addEventListener('change', () => {
  const deck = deckSelect.value as DeckPreset;
  send({ type: 'setDeck', deck });
});

const copyLink = () => {
  const url = `${location.origin}/r/${code}`;
  navigator.clipboard
    .writeText(url)
    .then(() => showToast('Invite link copied.'))
    .catch(() => {
      // Fallback: select the code visually
      showToast(url);
    });
};

copyLinkBtn?.addEventListener('click', copyLink);
copyLinkBtn2?.addEventListener('click', copyLink);

// ─── Boot ──────────────────────────────────────────────────────────────────

function boot() {
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    location.href = '/';
    return;
  }
  const stored = readStored();
  if (stored && stored.name) {
    openSocket(stored.name, stored.participantId);
  } else if (dialog) {
    dialog.showModal();
    dialogForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (dialogName?.value || '').trim();
      if (!name) return;
      dialog.close();
      writeStored({ participantId: null, name });
      openSocket(name, null);
    });
  }
}

window.addEventListener('beforeunload', () => {
  manualClose = true;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
});

boot();
