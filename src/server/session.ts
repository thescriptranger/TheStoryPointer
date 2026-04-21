import { customAlphabet } from 'nanoid';
import type { WebSocket } from 'ws';
import type { PublicSession, DeckPreset } from '../shared/types.js';
import { DECKS } from '../shared/types.js';

const codeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const idGen = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

interface Participant {
  id: string;
  name: string;
  vote: string | null;
  connected: boolean;
  ws?: WebSocket;
}

interface Session {
  code: string;
  hostId: string;
  storyTitle: string;
  revealed: boolean;
  deck: DeckPreset;
  participants: Participant[];
  createdAt: number;
  lastActivity: number;
}

const MAX_NAME_LEN = 40;
const MAX_TITLE_LEN = 200;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const HARD_ROOM_TTL_MS = 24 * 60 * 60 * 1000;

const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;
function clean(s: string, max: number) {
  return s.replace(CONTROL_CHARS_RE, '').trim().slice(0, max);
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor() {
    const t = setInterval(() => this.cleanup(), 60 * 1000);
    t.unref?.();
  }

  create(hostName: string): Session {
    let code = codeGen();
    while (this.sessions.has(code)) code = codeGen();
    const host: Participant = {
      id: idGen(),
      name: clean(hostName, MAX_NAME_LEN) || 'Host',
      vote: null,
      connected: false,
    };
    const session: Session = {
      code,
      hostId: host.id,
      storyTitle: '',
      revealed: false,
      deck: 'fibonacci',
      participants: [host],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.sessions.set(code, session);
    return session;
  }

  exists(code: string) {
    return this.sessions.has(code.toUpperCase());
  }

  get(code: string) {
    return this.sessions.get(code.toUpperCase());
  }

  join(
    code: string,
    name: string,
    existingId?: string
  ): { session: Session; participantId: string } | null {
    const session = this.sessions.get(code.toUpperCase());
    if (!session) return null;
    session.lastActivity = Date.now();
    const cleanName = clean(name, MAX_NAME_LEN) || 'Guest';

    if (existingId) {
      const existing = session.participants.find((p) => p.id === existingId);
      if (existing) {
        existing.name = cleanName;
        return { session, participantId: existing.id };
      }
    }
    const participant: Participant = {
      id: idGen(),
      name: cleanName,
      vote: null,
      connected: false,
    };
    session.participants.push(participant);
    return { session, participantId: participant.id };
  }

  attach(code: string, participantId: string, ws: WebSocket) {
    const session = this.sessions.get(code.toUpperCase());
    if (!session) return;
    const p = session.participants.find((x) => x.id === participantId);
    if (!p) return;
    if (p.ws && p.ws !== ws) {
      try {
        p.ws.close(4001, 'superseded');
      } catch {
        // ignore
      }
    }
    p.ws = ws;
    p.connected = true;
    session.lastActivity = Date.now();
  }

  vote(code: string, participantId: string, value: string) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s || s.revealed) return;
    const p = s.participants.find((x) => x.id === participantId);
    if (!p) return;
    if (!DECKS[s.deck].cards.includes(value)) return;
    p.vote = value;
    s.lastActivity = Date.now();
  }

  clearVote(code: string, participantId: string) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s || s.revealed) return;
    const p = s.participants.find((x) => x.id === participantId);
    if (!p) return;
    p.vote = null;
    s.lastActivity = Date.now();
  }

  reveal(code: string, hostId: string) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s || s.hostId !== hostId) return;
    s.revealed = true;
    s.lastActivity = Date.now();
  }

  reset(code: string, hostId: string) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s || s.hostId !== hostId) return;
    s.revealed = false;
    s.participants.forEach((p) => (p.vote = null));
    s.lastActivity = Date.now();
  }

  setStory(code: string, hostId: string, title: string) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s || s.hostId !== hostId) return;
    s.storyTitle = clean(title, MAX_TITLE_LEN);
    s.lastActivity = Date.now();
  }

  setDeck(code: string, hostId: string, deck: DeckPreset) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s || s.hostId !== hostId) return;
    if (!DECKS[deck]) return;
    s.deck = deck;
    s.revealed = false;
    s.participants.forEach((p) => (p.vote = null));
    s.lastActivity = Date.now();
  }

  rename(code: string, participantId: string, name: string) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s) return;
    const p = s.participants.find((x) => x.id === participantId);
    if (!p) return;
    p.name = clean(name, MAX_NAME_LEN) || p.name;
    s.lastActivity = Date.now();
  }

  kick(code: string, hostId: string, targetId: string) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s || s.hostId !== hostId || hostId === targetId) return;
    const idx = s.participants.findIndex((p) => p.id === targetId);
    if (idx === -1) return;
    const [kicked] = s.participants.splice(idx, 1);
    try {
      kicked.ws?.send(JSON.stringify({ type: 'kicked' }));
      kicked.ws?.close(4000, 'kicked');
    } catch {
      // ignore
    }
    s.lastActivity = Date.now();
  }

  disconnect(code: string, participantId: string, ws: WebSocket) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s) return;
    const p = s.participants.find((x) => x.id === participantId);
    if (!p || p.ws !== ws) return;
    p.connected = false;
    p.ws = undefined;
    if (s.hostId === participantId) {
      const next = s.participants.find((x) => x.connected && x.id !== participantId);
      if (next) s.hostId = next.id;
    }
    s.lastActivity = Date.now();
  }

  broadcast(code: string) {
    const s = this.sessions.get(code.toUpperCase());
    if (!s) return;
    const payload = JSON.stringify({ type: 'state', session: this.publicState(s) });
    for (const p of s.participants) {
      if (p.ws && p.ws.readyState === 1) {
        try {
          p.ws.send(payload);
        } catch {
          // ignore
        }
      }
    }
  }

  publicState(s: Session): PublicSession {
    return {
      code: s.code,
      hostId: s.hostId,
      storyTitle: s.storyTitle,
      revealed: s.revealed,
      deck: s.deck,
      deckCards: DECKS[s.deck].cards,
      participants: s.participants.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        hasVoted: p.vote !== null,
        vote: s.revealed ? p.vote : null,
        isHost: p.id === s.hostId,
      })),
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [code, s] of this.sessions) {
      const allOffline = s.participants.every((p) => !p.connected);
      const stale = allOffline && now - s.lastActivity > EMPTY_ROOM_TTL_MS;
      const ancient = now - s.createdAt > HARD_ROOM_TTL_MS;
      if (stale || ancient) {
        for (const p of s.participants) {
          try {
            p.ws?.close(4002, 'session-expired');
          } catch {
            // ignore
          }
        }
        this.sessions.delete(code);
      }
    }
  }
}
