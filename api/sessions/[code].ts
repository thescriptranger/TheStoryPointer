import type { IncomingMessage, ServerResponse } from 'http';
import {
  clearVote,
  joinSession,
  kick,
  publicSession,
  rename,
  reset,
  reveal,
  setDeck,
  setStory,
  touch,
  vote,
} from '../../lib/session-logic.js';
import { getStore } from '../../lib/store.js';
import type { ActionRequest, DeckPreset } from '../../lib/types.js';
import { DECKS } from '../../lib/types.js';
import { readJsonBody, sendJson, sendError, getCode, getQueryParam } from '../_util.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const code = getCode(req);
  if (!code || !/^[A-Z0-9]{6}$/.test(code)) {
    return sendError(res, 400, 'Invalid session code');
  }

  const store = getStore();

  if (req.method === 'GET') {
    const session = await store.get(code);
    if (!session) return sendError(res, 404, 'Session not found');

    // Opportunistic heartbeat: if a pid is attached, update its lastSeen.
    const pid = getQueryParam(req, 'pid');
    if (pid) {
      const touched = touch(session, pid);
      if (touched) {
        await store.save(session);
      } else {
        // The caller thinks they're in this session but aren't. Signal so they can clean up.
        return sendJson(res, 200, { session: publicSession(session), kicked: true });
      }
    }
    return sendJson(res, 200, { session: publicSession(session) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendError(res, 405, 'Method not allowed');
  }

  let body: ActionRequest;
  try {
    body = (await readJsonBody(req)) as ActionRequest;
  } catch {
    return sendError(res, 400, 'Invalid JSON');
  }

  if (!body || typeof (body as { action?: unknown }).action !== 'string') {
    return sendError(res, 400, 'Missing action');
  }

  const session = await store.get(code);
  if (!session) return sendError(res, 404, 'Session not found');

  switch (body.action) {
    case 'join': {
      if (typeof body.name !== 'string') return sendError(res, 400, 'Missing name');
      const { participantId } = joinSession(
        session,
        body.name,
        typeof body.existingId === 'string' ? body.existingId : undefined
      );
      await store.save(session);
      return sendJson(res, 200, { participantId, session: publicSession(session) });
    }

    case 'vote': {
      if (typeof body.participantId !== 'string' || typeof body.value !== 'string') {
        return sendError(res, 400, 'Missing fields');
      }
      if (!session.participants.some((p) => p.id === body.participantId)) {
        return sendError(res, 404, 'Participant not in session');
      }
      if (body.value === '') clearVote(session, body.participantId);
      else if (!vote(session, body.participantId, body.value)) {
        return sendError(res, 400, 'Invalid vote');
      }
      await store.save(session);
      return sendJson(res, 200, { session: publicSession(session) });
    }

    case 'reveal': {
      if (!reveal(session, body.participantId)) return sendError(res, 403, 'Host only');
      await store.save(session);
      return sendJson(res, 200, { session: publicSession(session) });
    }

    case 'reset': {
      if (!reset(session, body.participantId)) return sendError(res, 403, 'Host only');
      await store.save(session);
      return sendJson(res, 200, { session: publicSession(session) });
    }

    case 'setStory': {
      if (typeof body.title !== 'string') return sendError(res, 400, 'Missing title');
      if (!setStory(session, body.participantId, body.title)) {
        return sendError(res, 403, 'Host only');
      }
      await store.save(session);
      return sendJson(res, 200, { session: publicSession(session) });
    }

    case 'setDeck': {
      if (!body.deck || !DECKS[body.deck as DeckPreset]) {
        return sendError(res, 400, 'Unknown deck');
      }
      if (!setDeck(session, body.participantId, body.deck as DeckPreset)) {
        return sendError(res, 403, 'Host only');
      }
      await store.save(session);
      return sendJson(res, 200, { session: publicSession(session) });
    }

    case 'rename': {
      if (typeof body.name !== 'string') return sendError(res, 400, 'Missing name');
      if (!rename(session, body.participantId, body.name)) {
        return sendError(res, 404, 'Participant not in session');
      }
      await store.save(session);
      return sendJson(res, 200, { session: publicSession(session) });
    }

    case 'kick': {
      if (typeof body.targetId !== 'string') return sendError(res, 400, 'Missing targetId');
      if (!kick(session, body.participantId, body.targetId)) {
        return sendError(res, 403, 'Host only');
      }
      await store.save(session);
      return sendJson(res, 200, { session: publicSession(session) });
    }

    default:
      return sendError(res, 400, 'Unknown action');
  }
}
