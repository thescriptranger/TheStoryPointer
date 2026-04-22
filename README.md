# The Story Pointer

Anonymous, real-time story-point estimation for Scrum teams. No sign-up, no
tracking — start a session, share the code, point the story. Built to deploy
to Vercel in minutes.

## Features

- **Instant sessions** — create a room, share a six-character code or link.
- **Anonymous until reveal** — teammates see who has voted, not what they voted.
- **Multiple decks** — Fibonacci, Modified Fibonacci, T-shirt, Powers of 2.
- **Host controls** — reveal, reset, set story title, change deck, kick, handoff.
- **Consensus stats** — average, median, spread, and agreement indicator once
  cards are flipped.
- **Survives refresh** — reconnect to the same seat from the same browser.
- **Vercel-native** — serverless API functions plus static assets, no
  always-on server required.

## Tech

- TypeScript end-to-end.
- Vercel serverless API functions for all state-changing operations.
- Client uses short HTTP polling (2s when visible, 5s when tab is hidden).
- [Upstash Redis](https://upstash.com/) for shared session state (auto-wired
  through Vercel's Marketplace integration; falls back to in-memory locally).
- esbuild for the browser bundle — no React, no framework tax.

## Deploy to Vercel

### 1. Push this repo to GitHub (or any Git provider) and import it into Vercel.

Vercel auto-detects the build:

- Build command: `npm run build` (bundles the client JS).
- Output directory: `public`.
- Serverless functions: `api/**/*.ts` — Vercel compiles these automatically.

### 2. Add an Upstash Redis store from Vercel's Marketplace.

From your Vercel project → **Storage** → **Create Database** → pick **Upstash
for Redis** (the free tier is more than enough for a planning-poker app).
Accept the marketplace terms. Vercel automatically injects the env vars:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

(Legacy `KV_REST_API_URL` / `KV_REST_API_TOKEN` variables are also honoured if
you've added a Vercel KV store from before the marketplace switch.)

The store factory at `lib/store.ts` switches automatically: Redis when the env
vars are present, in-memory when they're not (so local development works with
no external dependencies).

### 3. Redeploy.

That's it. Visit the deployment URL, click **Start a new room**, copy the code
or invite link, send it to the team.

## Run it locally

```bash
npm install
npm run dev     # → http://localhost:3000
```

Local dev uses the in-memory store — sessions vanish when you stop the
server. To test the Redis path locally, set the env vars before running:

```bash
UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npm run dev
```

`GET /api/health` reports which store is active.

## Shape of the code

```
api/
  sessions/
    index.ts            # POST /api/sessions           — create room
    [code].ts           # GET  /api/sessions/:code     — poll state (heartbeats)
                         # POST /api/sessions/:code     — action dispatcher
  health.ts             # GET  /api/health             — {ok, store: "redis"|"memory"}
  _util.ts              # Shared req/res helpers

lib/
  types.ts              # Types + deck definitions (shared with the client bundle)
  session-logic.ts      # Pure session mutation functions (+ publicSession)
  store.ts              # SessionStore interface + factory (picks Redis or Memory)
  store-memory.ts       # In-process Map (dev + tests)
  store-redis.ts        # @upstash/redis-backed store

src/client/
  landing.ts            # Create-session / join-session form logic
  room.ts               # Polling client, render loop, interactions

public/
  index.html            # Landing page
  room.html             # Room page (served for any /r/:code via vercel.json rewrite)
  css/style.css
  js/                   # esbuild output (gitignored; produced by `npm run build`)
  icon.svg

server-local.ts         # Express shim that mounts the api/ handlers for local dev
                         #   (ignored by Vercel)
vercel.json             # buildCommand, outputDirectory, /r/:code → /room.html rewrite
```

## Protocol

### REST

- `POST /api/sessions` — `{ name }` → `{ code, participantId }` (creates room,
  caller becomes host).
- `GET  /api/sessions/:code?pid=PID` → `{ session }`. Passing a `pid`
  heartbeats the participant (keeps them marked as connected).
- `POST /api/sessions/:code` — action dispatcher. Body:
  - `{ action: "join", name, existingId? }` → `{ participantId, session }`
  - `{ action: "vote", participantId, value }` (value `""` to retract)
  - `{ action: "reveal", participantId }` — host only
  - `{ action: "reset",  participantId }` — host only
  - `{ action: "setStory", participantId, title }` — host only
  - `{ action: "setDeck",  participantId, deck }` — host only
  - `{ action: "rename", participantId, name }`
  - `{ action: "kick",   participantId, targetId }` — host only

Errors: `400` (bad request), `403` (host-only), `404` (session/participant
gone). On `404` the client clears local state and redirects to the landing.

### Polling cadence

The room client polls `/api/sessions/:code` every **2 s** when visible, **5 s**
when the tab is hidden. Each poll updates the caller's `lastSeen` timestamp;
the server treats anyone whose `lastSeen` is older than 8 s as disconnected
(grey card, still visible). If the host goes offline for ~30 s the crown
automatically passes to the next connected participant.

### Storage key layout

- `spp:session:<CODE>` → JSON blob containing the full session (participants,
  votes, deck, etc). TTL 24 h, refreshed on every save.
