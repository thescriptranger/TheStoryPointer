import type { IncomingMessage, ServerResponse } from 'http';
import { getStore } from '../lib/store.js';
import { sendJson } from './_util.js';

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  sendJson(res, 200, { ok: true, store: getStore().kind });
}
