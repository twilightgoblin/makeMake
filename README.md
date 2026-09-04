<div align="center">

# 🎵 Makemake

**Real-time collaborative music player — listen together, in sync.**

Create a room, share a code, and everyone hears the same song at the same moment.  
Built with React, Node.js, WebSockets, Redis, and the YouTube IFrame API.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://make-make-git-main-goblintwilight-gmailcoms-projects.vercel.app)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](#license)
[![Node.js 20](https://img.shields.io/badge/Node.js-20-green?logo=nodedotjs)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Vite 6](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)](https://vitejs.dev)

</div>

---

## ✨ What is Makemake?

Makemake is a **social music listening app** — like a watch party, but for music. No accounts, no downloads. Just open a room, share the 6-character code, and listen together.

- **Solo mode** — iPod-style music player for personal listening
- **Room mode** — create a room, invite friends, and stay in sync
- **Host-gated entry** — guests request to join; the host accepts or rejects in real time
- **Synchronized playback** — play, pause, seek, and skip are broadcast instantly to every listener
- **Collaborative playlist** — anyone in the room can search YouTube and add songs
- **Live chat** — message history persisted so latecomers catch up
- **Real-time presence** — see who's online, watch them join and leave
- **Retro iPod UI** — click-wheel inspired interface with a nostalgic feel

> Powered by the **YouTube IFrame Player API** — no audio files to host.

---

## 🖼️ Preview

| Solo Mode | Room Mode |
|:---------:|:---------:|
| iPod-style player | Synchronized listening with friends |

---

## 🚀 Live Demo

**[→ Try Makemake on Vercel](https://make-make-git-main-goblintwilight-gmailcoms-projects.vercel.app)**

---

## 🏗️ Architecture

```
Clients ──► Nginx (port 8080)
                │
      ┌─────────┴─────────┐
      ▼                   ▼
  Backend S1          Backend S2
  (HTTP + WS)         (HTTP + WS)
      │                   │
      └────────┬──────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
    Redis          PostgreSQL
  (Pub/Sub,       (Durable state)
   Presence,
   Rate Limit)
```

**Transport:** REST over HTTP for mutations and hydration. WebSocket (`ws[s]://host/ws`) for all real-time events — playback changes, playlist updates, chat, presence.

**Horizontal scaling:** Redis Pub/Sub delivers events across backend instances. No sticky sessions required — any instance can handle any request.

**Playback sync:** The server stores `positionSecs + stateUpdatedAt`. Clients compute `livePosition = positionSecs + (now − stateUpdatedAt)` locally. A drift-correction loop runs every 5 seconds and re-syncs if drift exceeds 0.5 seconds.

**Room expiry:** When all participants leave, a Redis TTL key is armed. On expiry, the room is marked `CLOSED` and all remaining WebSocket clients are notified.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite 6, React Router 6 |
| **Audio** | YouTube IFrame Player API (hidden, fully controlled) |
| **Backend** | Node.js 20, Express 5, TypeScript |
| **WebSocket** | `ws` library |
| **Database** | PostgreSQL 15 via Prisma 7 (driver adapter + `pg`) |
| **Cache / Messaging** | Redis (ioredis) — Pub/Sub, presence TTLs, rate limiting |
| **Validation** | Zod 4 |
| **Load balancer** | Nginx (round-robin + passive health checks) |
| **Testing** | Vitest + Supertest |
| **Deployment** | Vercel (frontend + backend as services) |

---

## 📁 Project Structure

```
makemake/
├── frontend/
│   └── src/
│       ├── App.tsx                    # Router: /, /solo, /room/:code
│       ├── types.ts                   # Shared API + WS types
│       ├── lib/
│       │   ├── AudioPlayer.ts         # AudioPlayer class (wraps YT adapter)
│       │   ├── YouTubePlayerAdapter.ts# Thin wrapper over YT.Player IFrame API
│       │   ├── useRoomSocket.ts       # WS hook — connection, reducer, all events
│       │   └── api.ts                 # Typed HTTP client + computeLivePosition()
│       ├── components/
│       │   ├── ipod/                  # iPod shell, click wheel, screen, gestures
│       │   └── room/                  # RoomPanel: chat, presence, join requests
│       └── pages/
│           ├── HomePage.tsx           # Lobby: create / join / solo
│           ├── SoloPage.tsx           # Single-player iPod
│           └── RoomPage.tsx           # Multi-player room
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma              # Database schema
│   │   └── seed.ts                    # Seed the song library
│   └── src/
│       ├── index.ts                   # Entry: HTTP server, WS, graceful shutdown
│       ├── lib/
│       │   ├── prisma.ts              # PrismaClient singleton
│       │   ├── redis.ts               # ioredis singletons (pub, sub, keyspace)
│       │   ├── roomEvents.ts          # Redis Pub/Sub helpers
│       │   ├── roomExpiry.ts          # INACTIVE room TTL via Redis keyspace events
│       │   ├── hostGrace.ts           # 8s host-transfer grace period (Redis TTL)
│       │   ├── presence.ts            # Online/offline via Redis TTL heartbeats
│       │   ├── rateLimit.ts           # Sliding-window rate limiting
│       │   ├── wsTypes.ts             # Full WS protocol types (both directions)
│       │   └── YouTubeService.ts      # YouTube Data API v3 (search + import)
│       ├── routes/
│       │   ├── rooms.ts               # POST /rooms
│       │   ├── joinRequests.ts        # Join request CRUD
│       │   ├── roomDetail.ts          # GET /rooms/:id
│       │   ├── roomLifecycle.ts       # DELETE, leave
│       │   ├── playlist.ts            # Playlist CRUD
│       │   ├── messages.ts            # Chat history
│       │   ├── presence.ts            # Online participants
│       │   └── songs.ts               # Song library + YouTube search/import
│       └── ws/
│           ├── server.ts              # WebSocketServer attachment
│           ├── connectionManager.ts   # In-process socket registry
│           └── handlers/              # connection, message, disconnect, playback, playlist, chat
│
├── vercel.json                        # Multi-service Vercel deployment config
└── package.json                       # Monorepo workspace root
```

---

## 🗄️ Data Model

```
Song ──< PlaylistEntry >── Room ──< Participant
                            │
                            ├──< JoinRequest
                            └──< Message
```

| Model | Description |
|---|---|
| `Song` | YouTube-backed track (provider, externalId, title, artist, duration, coverUrl) |
| `Room` | Central entity — owns playback state, code, status, playlist |
| `Participant` | Ephemeral identity per room session (HOST or MEMBER) |
| `JoinRequest` | Pending/accepted/rejected entry request |
| `PlaylistEntry` | Ordered Room ↔ Song join table |
| `Message` | Persisted chat message |

**No authentication.** Participants are temporary — a UUID + display name scoped to one room session. Identity is stored in `sessionStorage`.

---

## 🌐 API Reference

All routes operating within a room require `X-Participant-Id: <participantId>` header.

### Songs

| Method | Path | Description |
|---|---|---|
| `GET` | `/songs` | List song library (`?search`, `?limit`, `?offset`) |
| `GET` | `/songs/search` | YouTube search proxy (`?q`, `?limit`, `?pageToken`) |
| `POST` | `/songs/import` | Import a YouTube video `{ provider, externalId }` |

### Rooms

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/rooms` | — | Create room + become HOST `{ displayName }` |
| `GET` | `/rooms/:id` | Participant | Full room snapshot |
| `DELETE` | `/rooms/:id` | HOST | Close room |
| `PATCH` | `/rooms/:id/participants/:pid/leave` | Participant | Leave room |

### Join Requests

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/rooms/:code/join-requests` | — | Submit a join request |
| `GET` | `/rooms/:code/join-requests/:id` | — | Poll request status |
| `PATCH` | `/rooms/:id/join-requests/:id` | HOST | Accept or reject `{ action: "ACCEPT" \| "REJECT" }` |

### Playlist

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/rooms/:id/playlist` | Participant | Get ordered playlist |
| `POST` | `/rooms/:id/playlist` | Participant | Add song `{ songId }` |
| `DELETE` | `/rooms/:id/playlist/:entryId` | Participant | Remove entry |
| `PATCH` | `/rooms/:id/playlist/:entryId/position` | Participant | Move entry `{ position }` |

### Chat & Presence

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/rooms/:id/messages` | Participant | Chat history |
| `GET` | `/rooms/:id/presence` | Participant | Online participants |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness — confirms DB is reachable |

---

## 🔌 WebSocket Protocol

Connect: `ws[s]://<host>/ws?participantId=<id>&roomId=<id>`

On successful handshake, the server sends `ROOM_STATE` (full snapshot). All subsequent messages are deltas.

**Envelope — Client → Server:**
```json
{ "type": "PLAY", "requestId": "optional", "payload": { "positionSecs": 42.5 } }
```

**Envelope — Server → Client:**
```json
{ "type": "PLAY", "payload": { "songId": "...", "positionSecs": 42.5, "stateUpdatedAt": "..." }, "timestamp": "..." }
```

### Client → Server events

| Event | Role | Payload |
|---|---|---|
| `PLAY` | HOST | `{ positionSecs }` |
| `PAUSE` | HOST | `{ positionSecs }` |
| `SEEK` | HOST | `{ positionSecs }` |
| `NEXT` | HOST | `{}` |
| `PREVIOUS` | HOST | `{}` |
| `SET_SONG` | HOST | `{ entryId, play? }` |
| `PLAYLIST_ADD` | Any | `{ songId }` |
| `PLAYLIST_REMOVE` | Any | `{ entryId }` |
| `PLAYLIST_REORDER` | Any | `{ entryId, newPosition }` |
| `CHAT_MESSAGE` | Any | `{ content }` |

### Server → Client events

| Event | Description |
|---|---|
| `ROOM_STATE` | Full snapshot on connect |
| `PLAY` / `PAUSE` / `SEEK` | Playback control with anchor timestamp |
| `NEXT` / `PREVIOUS` | Track change with full playback state |
| `PLAYLIST_ADD` / `REMOVE` / `REORDER` | Playlist mutations |
| `CHAT_MESSAGE` | New message |
| `USER_JOINED` / `USER_LEFT` | Presence events |
| `HOST_CHANGED` | Host transfer |
| `ROOM_CLOSED` | Room closed (explicit or TTL) |
| `JOIN_REQUEST` | New entry request (HOST only) |
| `JOIN_REQUEST_RESOLVED` | Accept/reject result |
| `ERROR` | Error with code |

---

## ⚙️ Getting Started (Local Development)

### Prerequisites

- Node.js 20+
- PostgreSQL 15
- Redis 6+
- A [YouTube Data API v3 key](https://console.cloud.google.com/)

### 1. Clone and install

```bash
git clone https://github.com/twilightgoblin/makeMake.git
cd makemake
npm install          # installs all workspaces (frontend + backend)
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/makemake"
REDIS_URL="redis://localhost:6379"
YOUTUBE_API_KEY="your-youtube-data-api-v3-key"
PORT=3000
ROOM_INACTIVE_TTL_SECS=300
WS_RECONNECT_GRACE_MS=8000
```

### 3. Set up the database

```bash
cd backend
npx prisma migrate dev --name init
npm run seed         # idempotent — safe to re-run
```

### 4. Start dev servers

```bash
# Terminal 1 — Backend (port 3000)
cd backend && npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend && npm run dev
```

The Vite dev server proxies `/songs`, `/rooms`, and `/ws` to the backend automatically.

Open [http://localhost:5173](http://localhost:5173).

---

## 🧪 Testing

Integration tests require a live PostgreSQL and Redis instance (uses your `.env`).

```bash
cd backend
npm test             # run once
npm run test:watch   # watch mode
```

Tests run in isolated worker processes to avoid port conflicts. `WS_RECONNECT_GRACE_MS` is set to `0` in the test environment so host-transfer assertions resolve immediately.

---

## 🚢 Production Deployment

### Vercel (current setup)

The repo root `vercel.json` deploys both services in one push:

```json
{
  "services": {
    "frontend": { "root": "frontend/", "framework": "vite" },
    "backend":  { "root": "backend/", "framework": "express", "buildCommand": "npx prisma generate" }
  }
}
```

Traffic is routed: `/songs/*`, `/rooms/*`, `/ws`, `/health`, `/ready` → backend. Everything else → frontend SPA.

Set these environment variables in your Vercel project settings:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. Neon) |
| `REDIS_URL` | Redis connection URL (e.g. Upstash — use `rediss://`) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `ROOM_INACTIVE_TTL_SECS` | Optional, default `300` |

Then:

```bash
npx prisma migrate deploy   # run against production DB before first deploy
```

### Self-hosted

```bash
# Build
cd backend  && npm run build   # → dist/
cd frontend && npm run build   # → dist/

# Run
cd backend
node dist/index.js             # listens on $PORT
```

**Production checklist:**

- [ ] Run `npx prisma migrate deploy` (not `migrate dev`) against production DB
- [ ] Enable Redis keyspace notifications: `CONFIG SET notify-keyspace-events KEx`
- [ ] Configure Nginx with `proxy_http_version 1.1`, `Upgrade`, `Connection` headers for WebSocket proxying
- [ ] Set `proxy_read_timeout` ≥ 1h for long-lived WS connections
- [ ] Wire `/health` (liveness) and `/ready` (readiness — returns `503` on startup/shutdown) to your load balancer
- [ ] Allow 15+ seconds before force-killing on deploy — graceful shutdown takes up to 10s
- [ ] Set `NODE_ENV=production`

### Multi-instance (Nginx load balancer)

```bash
# Terminal 1 & 2 — two backend instances
PORT=3000 npm run dev
PORT=3001 npm run dev

# Terminal 3 — Nginx on :8080, round-robins to :3000 and :3001
nginx -c backend/nginx/nginx.conf -p .
```

No sticky sessions needed — Redis Pub/Sub keeps all instances in sync.

---

## 🔑 Environment Variables

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_URL` | ✅ | — | Redis connection URL |
| `YOUTUBE_API_KEY` | ✅ | — | YouTube Data API v3 key |
| `PORT` | — | `3000` | HTTP server port |
| `ROOM_INACTIVE_TTL_SECS` | — | `300` | Seconds until inactive room auto-closes |
| `WS_RECONNECT_GRACE_MS` | — | `8000` | Host reconnect window before transfer |
| `NODE_ENV` | — | — | Set to `production` in prod |

---

## 🧩 Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Auth | None — ephemeral participants | No account overhead in V1 |
| Playback control | HOST only | Single authority prevents conflicts |
| Playlist | All participants | Lower friction for collaborative queues |
| Sync strategy | Anchor timestamp + client math | No high-frequency position broadcasts |
| Cross-instance events | Redis Pub/Sub | Lightweight; no Kafka complexity at this scale |
| Sticky sessions | Not used | Redis makes every instance equivalent |
| Durable storage | PostgreSQL (not Redis) | Redis is volatile; Postgres is source of truth |
| Host departure | Transfer after 8s grace | Distributed-safe via Redis TTL key |
| Room cleanup | TTL-based auto-expiry | Prevents orphaned rooms from accumulating |
| Audio source | YouTube IFrame API | No audio hosting infrastructure required |
| Architecture | Monolith | Room/participant/playlist is a cohesive domain at V1 scale |

---

## 📜 License

ISC © 2026 Ayush
