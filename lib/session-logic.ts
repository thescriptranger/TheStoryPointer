import { customAlphabet } from 'nanoid';
import {
  DECKS,
  type DeckPreset,
  type Participant,
  type PublicSession,
  type Session,
  CONNECTED_WINDOW_MS,
} from './types.js';

const codeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const idGen = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

const MAX_NAME_LEN = 40;
const MAX_TITLE_LEN = 200;
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;

function clean(s: string, max: number): string {
  return s.replace(CONTROL_CHARS_RE, '').trim().slice(0, max);
}

export function newCode(): string {
  return codeGen();
}

export function newId(): string {
  return idGen();
}

export function createSession(hostName: string, code = newCode()): Session {
  const now = Date.now();
  const host: Participant = {
    id: idGen(),
    name: clean(hostName, MAX_NAME_LEN) || 'Host',
    vote: null,
    lastSeen: now,
  };
  return {
    code,
    hostId: host.id,
    storyTitle: '',
    revealed: false,
    deck: 'fibonacci',
    participants: [host],
    createdAt: now,
    lastActivity: now,
  };
}

export function joinSession(
  session: Session,
  name: string,
  existingId: string | undefined
): { participantId: string } {
  const now = Date.now();
  session.lastActivity = now;
  const cleanName = clean(name, MAX_NAME_LEN) || 'Guest';

  if (existingId) {
    const existing = session.participants.find((p) => p.id === existingId);
    if (existing) {
      existing.name = cleanName;
      existing.lastSeen = now;
      return { participantId: existing.id };
    }
  }

  const participant: Participant = {
    id: idGen(),
    name: cleanName,
    vote: null,
    lastSeen: now,
  };
  session.participants.push(participant);
  return { participantId: participant.id };
}

export function touch(session: Session, participantId: string): boolean {
  const p = session.participants.find((x) => x.id === participantId);
  if (!p) return false;
  p.lastSeen = Date.now();
  session.lastActivity = p.lastSeen;
  return true;
}

export function vote(session: Session, participantId: string, value: string): boolean {
  if (session.revealed) return false;
  const p = session.participants.find((x) => x.id === participantId);
  if (!p) return false;
  if (!DECKS[session.deck].cards.includes(value)) return false;
  p.vote = value;
  p.lastSeen = Date.now();
  session.lastActivity = p.lastSeen;
  return true;
}

export function clearVote(session: Session, participantId: string): boolean {
  if (session.revealed) return false;
  const p = session.participants.find((x) => x.id === participantId);
  if (!p) return false;
  p.vote = null;
  p.lastSeen = Date.now();
  session.lastActivity = p.lastSeen;
  return true;
}

export function reveal(session: Session, hostId: string): boolean {
  if (session.hostId !== hostId) return false;
  session.revealed = true;
  session.lastActivity = Date.now();
  return true;
}

export function reset(session: Session, hostId: string): boolean {
  if (session.hostId !== hostId) return false;
  session.revealed = false;
  for (const p of session.participants) p.vote = null;
  session.lastActivity = Date.now();
  return true;
}

export function setStory(session: Session, hostId: string, title: string): boolean {
  if (session.hostId !== hostId) return false;
  session.storyTitle = clean(title, MAX_TITLE_LEN);
  session.lastActivity = Date.now();
  return true;
}

export function setDeck(session: Session, hostId: string, deck: DeckPreset): boolean {
  if (session.hostId !== hostId) return false;
  if (!DECKS[deck]) return false;
  session.deck = deck;
  session.revealed = false;
  for (const p of session.participants) p.vote = null;
  session.lastActivity = Date.now();
  return true;
}

export function rename(session: Session, participantId: string, name: string): boolean {
  const p = session.participants.find((x) => x.id === participantId);
  if (!p) return false;
  p.name = clean(name, MAX_NAME_LEN) || p.name;
  p.lastSeen = Date.now();
  session.lastActivity = p.lastSeen;
  return true;
}

export function kick(session: Session, hostId: string, targetId: string): boolean {
  if (session.hostId !== hostId || hostId === targetId) return false;
  const idx = session.participants.findIndex((p) => p.id === targetId);
  if (idx === -1) return false;
  session.participants.splice(idx, 1);
  session.lastActivity = Date.now();
  return true;
}

/** If the host has been offline long enough, hand the crown to anyone still connected. */
export function maybePromoteHost(session: Session, now: number): void {
  const host = session.participants.find((p) => p.id === session.hostId);
  if (!host) {
    const alive = session.participants.find((p) => now - p.lastSeen < CONNECTED_WINDOW_MS);
    if (alive) session.hostId = alive.id;
    return;
  }
  if (now - host.lastSeen >= CONNECTED_WINDOW_MS * 4) {
    const alive = session.participants.find(
      (p) => p.id !== host.id && now - p.lastSeen < CONNECTED_WINDOW_MS
    );
    if (alive) session.hostId = alive.id;
  }
}

export function publicSession(session: Session, now = Date.now()): PublicSession {
  maybePromoteHost(session, now);
  return {
    code: session.code,
    hostId: session.hostId,
    storyTitle: session.storyTitle,
    revealed: session.revealed,
    deck: session.deck,
    deckCards: DECKS[session.deck].cards,
    participants: session.participants.map((p) => ({
      id: p.id,
      name: p.name,
      connected: now - p.lastSeen < CONNECTED_WINDOW_MS,
      hasVoted: p.vote !== null,
      vote: session.revealed ? p.vote : null,
      isHost: p.id === session.hostId,
    })),
  };
}
