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

export type ClientMessage =
  | { type: 'join'; code: string; name: string; existingId?: string }
  | { type: 'vote'; value: string }
  | { type: 'reveal' }
  | { type: 'reset' }
  | { type: 'setStory'; title: string }
  | { type: 'setDeck'; deck: DeckPreset }
  | { type: 'kick'; targetId: string }
  | { type: 'rename'; name: string };

export type ServerMessage =
  | { type: 'joined'; participantId: string; session: PublicSession }
  | { type: 'state'; session: PublicSession }
  | { type: 'kicked' }
  | { type: 'error'; message: string };
