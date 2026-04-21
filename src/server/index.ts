import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { SessionManager } from './session.js';
import type { ClientMessage, ServerMessage, DeckPreset } from '../shared/types.js';
import { DECKS } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../../public');

const app = express();
app.use(express.json({ limit: '8kb' }));
app.disable('x-powered-by');

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const manager = new SessionManager();

app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/r/:code', (_req, res) => {
  res.sendFile(path.join(publicDir, 'room.html'));
});

app.post('/api/sessions', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const session = manager.create(name);
  const hostId = session.participants[0].id;
  res.json({ code: session.code, participantId: hostId });
});

app.get('/api/sessions/:code', (req, res) => {
  res.json({ exists: manager.exists(req.params.code) });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const ALLOWED_DECKS: DeckPreset[] = Object.keys(DECKS) as DeckPreset[];

wss.on('connection', (ws) => {
  let participantId: string | null = null;
  let sessionCode: string | null = null;

  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch {
        // ignore
      }
    }
  }, 30_000);
  heartbeat.unref?.();

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      const text = raw.toString();
      if (text.length > 4096) throw new Error('payload too large');
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      send(ws, { type: 'error', message: 'invalid message' });
      return;
    }

    switch (msg.type) {
      case 'join': {
        if (typeof msg.code !== 'string' || typeof msg.name !== 'string') {
          send(ws, { type: 'error', message: 'invalid join' });
          return;
        }
        const result = manager.join(msg.code, msg.name, msg.existingId);
        if (!result) {
          send(ws, { type: 'error', message: 'Session not found' });
          return;
        }
        participantId = result.participantId;
        sessionCode = msg.code.toUpperCase();
        manager.attach(sessionCode, participantId, ws);
        send(ws, {
          type: 'joined',
          participantId,
          session: manager.publicState(result.session),
        });
        manager.broadcast(sessionCode);
        break;
      }
      case 'vote':
        if (sessionCode && participantId && typeof msg.value === 'string') {
          if (msg.value === '') manager.clearVote(sessionCode, participantId);
          else manager.vote(sessionCode, participantId, msg.value);
          manager.broadcast(sessionCode);
        }
        break;
      case 'reveal':
        if (sessionCode && participantId) {
          manager.reveal(sessionCode, participantId);
          manager.broadcast(sessionCode);
        }
        break;
      case 'reset':
        if (sessionCode && participantId) {
          manager.reset(sessionCode, participantId);
          manager.broadcast(sessionCode);
        }
        break;
      case 'setStory':
        if (sessionCode && participantId && typeof msg.title === 'string') {
          manager.setStory(sessionCode, participantId, msg.title);
          manager.broadcast(sessionCode);
        }
        break;
      case 'setDeck':
        if (
          sessionCode &&
          participantId &&
          typeof msg.deck === 'string' &&
          (ALLOWED_DECKS as string[]).includes(msg.deck)
        ) {
          manager.setDeck(sessionCode, participantId, msg.deck);
          manager.broadcast(sessionCode);
        }
        break;
      case 'rename':
        if (sessionCode && participantId && typeof msg.name === 'string') {
          manager.rename(sessionCode, participantId, msg.name);
          manager.broadcast(sessionCode);
        }
        break;
      case 'kick':
        if (sessionCode && participantId && typeof msg.targetId === 'string') {
          manager.kick(sessionCode, participantId, msg.targetId);
          manager.broadcast(sessionCode);
        }
        break;
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    if (sessionCode && participantId) {
      manager.disconnect(sessionCode, participantId, ws);
      manager.broadcast(sessionCode);
    }
  });

  ws.on('error', () => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`The Story Pointer → http://localhost:${PORT}`);
});
