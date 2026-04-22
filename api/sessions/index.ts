import type { IncomingMessage, ServerResponse } from 'http';
import { createSession, newCode } from '../../lib/session-logic.js';
import { getStore } from '../../lib/store.js';
import { readJsonBody, sendJson, sendError } from '../_util.js';

/** POST /api/sessions  body: { name }  → { code, participantId } */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'Method not allowed');
  }

  let body: { name?: unknown } = {};
  try {
    body = await readJsonBody(req);
  } catch {
    return sendError(res, 400, 'Invalid JSON');
  }

  const name = typeof body.name === 'string' ? body.name : '';
  const store = getStore();

  // Retry on rare code collisions.
  for (let attempt = 0; attempt < 5; attempt++) {
    const session = createSession(name, newCode());
    const ok = await store.create(session);
    if (ok) {
      return sendJson(res, 200, {
        code: session.code,
        participantId: session.participants[0].id,
      });
    }
  }
  return sendError(res, 500, 'Could not allocate session code');
}
