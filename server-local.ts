/**
 * Local dev shim. Serves /public, routes /api/* to the same handlers Vercel
 * invokes in production. Does not run on Vercel — Vercel discovers api/*.ts
 * directly and ignores this file.
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response } from 'express';

import createSession from './api/sessions/index.js';
import sessionAction from './api/sessions/[code].js';
import health from './api/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const publicDir = path.resolve(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// Pretty room URL.
app.get('/r/:code', (_req, res) => {
  res.sendFile(path.join(publicDir, 'room.html'));
});

// Adapter: Express hands params in req.params, Vercel hands them in req.query.
// We populate query so the handlers work unchanged.
function adapt(fn: (req: any, res: any) => Promise<void> | void) {
  return async (req: Request, res: Response) => {
    (req as any).query = { ...(req.query ?? {}), ...(req.params ?? {}) };
    try {
      await fn(req, res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('handler error', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal error' });
      }
    }
  };
}

app.post('/api/sessions', adapt(createSession));
app.get('/api/sessions/:code', adapt(sessionAction));
app.post('/api/sessions/:code', adapt(sessionAction));
app.get('/api/health', adapt(health));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`The Story Pointer (local) → http://localhost:${PORT}`);
});
