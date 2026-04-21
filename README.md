# The Story Pointer

Anonymous, real-time story-point estimation for Scrum teams. No sign-up, no
database, no tracking — start a session, share the code, point the story.

## Features

- **Instant sessions** — create a room, share a six-character code.
- **Anonymous until reveal** — teammates see who has voted, not what they voted.
- **Multiple decks** — Fibonacci, Modified Fibonacci, T-shirt, Powers of 2.
- **Host controls** — reveal, reset, set story title, change deck, kick, promote.
- **Consensus stats** — average, median, spread, and agreement indicator once
  cards are flipped.
- **Survives refresh** — reconnect to the same seat from the same browser.
- **No persistence** — sessions live in memory and expire when everyone leaves.

## Tech

- TypeScript end-to-end.
- Node.js + Express for HTTP, `ws` for the WebSocket layer.
- esbuild for the browser bundle — no React, no Vue, no framework tax.
- In-memory session store; horizontal scale is out of scope for a planning tool.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

Set `PORT` to change the listen port (defaults to `3000`).

## Shape of the code

```
src/
  shared/
    types.ts         # Wire protocol + deck definitions (shared server/client)
  server/
    index.ts         # HTTP + WebSocket entry point
    session.ts       # SessionManager — in-memory room state
  client/
    landing.ts       # Create / join form logic
    room.ts          # Room UI, WebSocket client, render loop
public/
  index.html         # Landing page
  room.html          # Room page (any /r/:code)
  css/style.css
  js/                # esbuild output (gitignored)
```

## Protocol

Every WebSocket frame is JSON. Client → server:

- `{ type: 'join', code, name, existingId? }`
- `{ type: 'vote', value }`
- `{ type: 'reveal' }` (host only)
- `{ type: 'reset' }` (host only)
- `{ type: 'setStory', title }` (host only)
- `{ type: 'setDeck', deck }` (host only)
- `{ type: 'kick', targetId }` (host only)

Server → client:

- `{ type: 'joined', participantId, session }` — after a successful join.
- `{ type: 'state', session }` — broadcast whenever anything changes.
- `{ type: 'error', message }`

Creation is a REST call (`POST /api/sessions`) so the browser can redirect into
the room before the socket opens.
