export type DeckPreset = 'fibonacci' | 'modfib' | 'tshirt' | 'powers';

export const DECKS: Record<DeckPreset, { label: string; cards: string[] }> = {
  fibonacci: {
    label: 'Fibonacci',
    cards: ['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕'],
  },
  modfib: {
    label: 'Modified Fibonacci',
    cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕'],
  },
  tshirt: {
    label: 'T-shirt',
    cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'],
  },
  powers: {
    label: 'Powers of 2',
    cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', '☕'],
  },
};

/** Internal participant row (lives in storage). */
export interface Participant {
  id: string;
  name: string;
  vote: string | null;
  lastSeen: number;
}

/** Internal session row (lives in storage). */
export interface Session {
  code: string;
  hostId: string;
  storyTitle: string;
  revealed: boolean;
  deck: DeckPreset;
  participants: Participant[];
  createdAt: number;
  lastActivity: number;
}

/** Public (sanitised) shape sent to clients. */
export interface PublicParticipant {
  id: string;
  name: string;
  connected: boolean;
  hasVoted: boolean;
  vote: string | null;
  isHost: boolean;
}

export interface PublicSession {
  code: string;
  hostId: string;
  storyTitle: string;
  revealed: boolean;
  deck: DeckPreset;
  deckCards: string[];
  participants: PublicParticipant[];
}

/** POST /api/sessions/[code] body. */
export type ActionRequest =
  | { action: 'join'; name: string; existingId?: string }
  | { action: 'vote'; participantId: string; value: string }
  | { action: 'reveal'; participantId: string }
  | { action: 'reset'; participantId: string }
  | { action: 'setStory'; participantId: string; title: string }
  | { action: 'setDeck'; participantId: string; deck: DeckPreset }
  | { action: 'rename'; participantId: string; name: string }
  | { action: 'kick'; participantId: string; targetId: string };

export const CONNECTED_WINDOW_MS = 8000;
export const SESSION_TTL_SECONDS = 24 * 60 * 60;
