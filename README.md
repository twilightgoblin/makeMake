# Makemake

A real-time collaborative music player. Create a room, invite friends with a shareable code, and listen to the same music in perfect sync — with shared playlist control and live chat.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Domain Model](#domain-model)
- [Room Lifecycle](#room-lifecycle)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Running the Load Balancer](#running-the-load-balancer)
- [Testing](#testing)
- [Production Deployment](#production-deployment)
- [Design Decisions](#design-decisions)

---

## Overview

Makemake is a real-time social music player. Users can listen solo or create a room and listen to the same music in sync with others. There is no traditional authentication in V1 — participants are temporary identities scoped to a single room session.

Key capabilities:

- Create a room and get a human-readable join code (e.g. `ABC123`)
- Host-controlled join request flow — guests request entry, the host accepts or rejects via floating notifications
- Synchronized playback state across all room participants with YouTube video player integration
- Collaborative playlist — any participant can add, remove, and reorder songs
- Live chat with message history persisted for latecomers and unread message notifications
- Real-time presence tracking via Redis TTL heartbeats
- iPod-inspired retro frontend interface with button controls and toast notifications
- Horizontal scaling with Redis Pub/Sub for cross-instance event delivery
- Automatic room expiry (configurable TTL) when all participants leave
- Graceful host transfer — if the host disconnects, an 8-second grace period fires before the next-joined participant is promoted

---

## Architecture

```
Clients ──► Nginx (port 8080)
              │
    ┌─────────┴─────────┐
    ▼                   ▼
Backend S1          Backend S2
(HTTP + WS)         (HTTP + WS)
    │                   │
    └─────┬─────────────┘
          │
    ┌─────┴──────┐
    ▼            ▼
 Redis       PostgreSQL
(Pub/Sub,   (Durable state)
 Presence,
 Rate Limit)
```

**HTTP / REST** requests are distributed across backend instances via round-robin. **WebSocket** connections are long-lived and pinned to the instance they initially connect to. Cross-instance events (chat messages, playback changes, playlist updates) are delivered via **Redis Pub/Sub** so all connected clients receive them regardless of which instance holds their socket.

PostgreSQL is the single source of truth for all durable state. Redis is ephemeral and used exclusively for Pub/Sub, presence TTLs, and rate limiting. If Redis restarts, the application degrades gracefully: durable operations continue; real-time broadcast and rate limiting are affected until Redis reconnects.

---

## Tech Stack

| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Runtime          | Node.js 20, TypeScript                          |
| Backend framework| Express 5                                       |
| ORM              | Prisma 7 (driver adapter pattern)               |
| Database         | PostgreSQL 15                                   |
| DB adapter       | `@prisma/adapter-pg` + `pg`                     |
| Real-time        | WebSocket (`ws` library)                        |
| Messaging        | Redis (ioredis) — Pub/Sub + TTL keys            |
| Load balancer    | Nginx (round-robin + passive health checks)     |
| Dev runner       | `tsx` (watch mode)                              |
| Test runner      | Vitest + Supertest                              |
| Frontend         | React 19, TypeScript, Vite 8, React Router 6, YouTube API |

---

## Project Structure

```
makemake/
├── backend/
│   ├── nginx/
│   │   └── nginx.conf          # Load balancer config (ports 3000, 3001 → 8080)
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema
│   │   ├── seed.ts             # Seed the global song library
│   │   └── migrations/         # Prisma migration history
│   ├── src/
│   │   ├── index.ts            # App entry point — HTTP server, WS, startup
│   │   ├── lib/
│   │   │   ├── prisma.ts       # Shared PrismaClient singleton (driver adapter)
│   │   │   ├── redis.ts        # Redis client singletons (pub, sub, keyspace)
│   │   │   ├── roomEvents.ts   # Redis Pub/Sub publish/subscribe helpers
│   │   │   ├── roomExpiry.ts   # INACTIVE room TTL + keyspace event handling
│   │   │   ├── hostGrace.ts    # Distributed host-transfer grace period (Redis)
│   │   │   ├── presence.ts     # Participant online/offline via Redis TTL
│   │   │   ├── rateLimit.ts    # Sliding-window rate limiting (Redis)
│   │   │   ├── wsTypes.ts      # WebSocket protocol types (both directions)
│   │   │   ├── errors.ts       # Typed AppError + HTTP error helpers
│   │   │   ├── validate.ts     # Input validation helpers
│   │   │   ├── roomCode.ts     # Human-readable room code generator
│   │   │   └── serverId.ts     # Per-instance ID (for debug tracing)
│   │   ├── middleware/
│   │   │   ├── requireParticipant.ts  # Validates X-Participant-Id header
│   │   │   ├── requireHost.ts         # Asserts caller role === HOST
│   │   │   ├── rateLimit.ts           # Express rate-limit middleware factory
│   │   │   └── errorHandler.ts        # Global Express error handler
│   │   ├── routes/
│   │   │   ├── rooms.ts          # POST /rooms
│   │   │   ├── joinRequests.ts   # POST/GET/PATCH /rooms/:id/join-requests
│   │   │   ├── roomDetail.ts     # GET /rooms/:id
│   │   │   ├── roomLifecycle.ts  # DELETE /rooms/:id, PATCH …/leave
│   │   │   ├── playlist.ts       # GET/POST/DELETE/PATCH …/playlist
│   │   │   ├── messages.ts       # GET /rooms/:id/messages
│   │   │   ├── presence.ts       # GET /rooms/:id/presence
│   │   │   └── songs.ts          # GET /songs
│   │   └── ws/
│   │       ├── server.ts              # Attaches WebSocketServer to HTTP server
│   │       ├── connectionManager.ts   # In-process socket registry
│   │       ├── rateLimit.ts           # Per-connection WS rate limiting
│   │       └── handlers/
│   │           ├── connection.ts      # WS handshake + authentication
│   │           ├── message.ts         # Incoming message dispatcher
│   │           ├── disconnect.ts      # Leave / host-transfer / room expiry
│   │           ├── playback.ts        # PLAY, PAUSE, SEEK, NEXT, PREVIOUS, SET_SONG
│   │           ├── playlist.ts        # PLAYLIST_ADD/REMOVE/REORDER over WS
│   │           └── chat.ts            # CHAT_MESSAGE broadcast
│   ├── tests/
│   │   ├── rooms.test.ts       # HTTP integration tests
│   │   └── ws.test.ts          # WebSocket integration tests
│   ├── scripts/                # Demo and load-test scripts
│   ├── prisma7.config.ts       # Prisma 7 datasource config (reads DATABASE_URL)
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── package.json
└── frontend/
    ├── src/
    │   ├── main.tsx            # React entry point
    │   ├── App.tsx             # Router: /, /solo, /room/:code
    │   ├── types.ts            # Shared API + WebSocket types
    │   ├── lib/
    │   │   ├── AudioPlayer.ts  # HTML5 audio controller class
    │   │   ├── useRoomSocket.ts# React hook — WS connection + event dispatch
    │   │   ├── api.ts          # Typed HTTP client helpers
    │   │   └── formatDuration.ts
    │   ├── components/
    │   │   ├── PlayerBar.tsx   # Transport controls + now-playing display
    │   │   └── SongLibrary.tsx # Song grid / search
    │   └── pages/
    │       ├── HomePage.tsx    # Lobby: create room or enter join code
    │       ├── SoloPage.tsx    # Single-player mode
    │       └── RoomPage.tsx    # Multi-player room (playlist, chat, presence)
    ├── vite.config.ts
    └── package.json
```

---

## Domain Model

### Song

Global seeded library. Audio files are served from a CDN; the database holds metadata and URLs only.

| Field      | Type    | Notes                          |
|------------|---------|--------------------------------|
| `id`       | cuid    |                                |
| `title`    | string  |                                |
| `artist`   | string  |                                |
| `album`    | string? | nullable                       |
| `duration` | int     | seconds                        |
| `coverUrl` | string  | CDN URL                        |
| `audioUrl` | string  | CDN URL                        |

### Room

The central entity. Holds playback state so HTTP clients can hydrate without a WebSocket handshake.

| Field           | Type       | Notes                                       |
|-----------------|------------|---------------------------------------------|
| `id`            | cuid       |                                             |
| `code`          | string     | unique human-readable join code (e.g. `ABC123`) |
| `status`        | enum       | `ACTIVE` \| `INACTIVE` \| `CLOSED`          |
| `currentSongId` | string?    | FK → Song                                   |
| `isPlaying`     | boolean    |                                             |
| `positionSecs`  | float      | last known playback position                |
| `stateUpdatedAt`| datetime?  | used for sync math on reconnect             |

### Participant

Temporary identity scoped to one room session. No account, no password.

| Field         | Type    | Notes                              |
|---------------|---------|------------------------------------|
| `id`          | cuid    |                                    |
| `displayName` | string  | chosen on entry                    |
| `role`        | enum    | `HOST` \| `MEMBER`                 |
| `roomId`      | string  | FK → Room                          |
| `joinedAt`    | datetime|                                    |
| `leftAt`      | datetime?| null = currently active           |

**Role capabilities:**

| Role   | Playback control | Chat | Playlist collaboration |
|--------|:----------------:|:----:|:---------------------:|
| HOST   | ✓                | ✓    | ✓                     |
| MEMBER | ✗                | ✓    | ✓                     |

### JoinRequest

Entering a room code does not immediately admit someone. A `JoinRequest` is created and the host must accept or reject it before a `Participant` row is created.

### PlaylistEntry

Ordered join table between Room and Song. The `(roomId, position)` pair is unique — no two entries share the same slot. The same song may appear at multiple positions.

### Message

Chat messages are persisted so latecomers see recent history. Cascade-deleted when the room is deleted.

---

## Room Lifecycle

```
         CREATE
            │
            ▼
         ACTIVE  ◄──────── participant joins (join request accepted)
            │
   ┌────────┼────────┐
   │        │        │
host    participant  host
leaves   leaves    closes
   │        │        │
   ▼        ▼        ▼
transfer  remove   CLOSED
  host  participant    │
   │                   └─ no TTL (permanent)
   ▼
ACTIVE (or INACTIVE
 if last person left)
   │
TTL expiry (Redis keyspace)
   │
CLOSED (cleanup broadcast)
```

| Event                       | Behavior                                                          |
|-----------------------------|-------------------------------------------------------------------|
| Room created                | Status = `ACTIVE`, creator gets `role = HOST`                     |
| Participant joins            | Participant row created with `leftAt = null`                      |
| Participant leaves           | `Participant.leftAt` set to now                                   |
| HOST leaves                  | Host role transferred to earliest-joined active participant       |
| Last participant leaves      | Room status = `INACTIVE`, Redis TTL armed                         |
| HOST explicitly closes room  | Room status = `CLOSED`, `ROOM_CLOSED` broadcast to all clients    |
| INACTIVE room TTL expires    | Room marked `CLOSED` in PostgreSQL, `ROOM_CLOSED` broadcast       |

---

## API Reference

All requests that operate within a room require an `X-Participant-Id` header containing a valid active participant ID for that room.

### Health

| Method | Path       | Auth | Description                    |
|--------|------------|------|--------------------------------|
| `GET`  | `/health`  | —    | Liveness check. Always `200`   |
| `GET`  | `/ready`   | —    | Readiness: confirms DB is live |

### Songs

| Method | Path     | Auth | Description                          |
|--------|----------|------|--------------------------------------|
| `GET`  | `/songs` | —    | List the global song library (paginated) |

Query parameters: `limit` (default 20, max 100), `offset` (default 0), `search`.

### Rooms

| Method   | Path       | Auth | Description                      |
|----------|------------|------|----------------------------------|
| `POST`   | `/rooms`   | —    | Create a room. Returns `{ room, participant }` |

**Body:** `{ displayName: string }`

Rate limited: 5 requests per minute per IP.

### Join Requests

| Method   | Path                                    | Auth      | Description                          |
|----------|-----------------------------------------|-----------|--------------------------------------|
| `POST`   | `/rooms/:code/join-requests`            | —         | Submit a join request                |
| `GET`    | `/rooms/:code/join-requests/:requestId` | —         | Poll join request status             |
| `PATCH`  | `/rooms/:id/join-requests/:requestId`   | HOST only | Accept or reject (`{ action: "ACCEPT" \| "REJECT" }`) |

Rate limited: 10 requests per minute per IP per room code.

When accepted, a `Participant` row is created and the joining client receives their `participant.id` in the poll response. They must store this ID and send it as `X-Participant-Id` on subsequent requests.

### Room Detail

| Method | Path           | Auth        | Description                             |
|--------|----------------|-------------|-----------------------------------------|
| `GET`  | `/rooms/:id`   | Participant | Full room snapshot including playback state, participants, and (for HOST) pending join requests |

### Room Lifecycle

| Method   | Path                                          | Auth        | Description             |
|----------|-----------------------------------------------|-------------|-------------------------|
| `DELETE` | `/rooms/:id`                                  | HOST only   | Close the room          |
| `PATCH`  | `/rooms/:id/participants/:participantId/leave` | Participant | Leave the room (self-only) |

### Playlist

| Method   | Path                                          | Auth        | Description                      |
|----------|-----------------------------------------------|-------------|----------------------------------|
| `GET`    | `/rooms/:id/playlist`                         | Participant | List all entries in order        |
| `POST`   | `/rooms/:id/playlist`                         | Participant | Add a song (`{ songId }`)        |
| `DELETE` | `/rooms/:id/playlist/:entryId`                | Participant | Remove an entry (compacts positions) |
| `PATCH`  | `/rooms/:id/playlist/:entryId/position`       | Participant | Move an entry (`{ position }`)   |

### Messages

| Method | Path                    | Auth        | Description                            |
|--------|-------------------------|-------------|----------------------------------------|
| `GET`  | `/rooms/:id/messages`   | Participant | Paginated chat history (newest first)  |

### Presence

| Method | Path                    | Auth        | Description                             |
|--------|-------------------------|-------------|-----------------------------------------|
| `GET`  | `/rooms/:id/presence`   | Participant | List currently online participants      |

---

## WebSocket Protocol

Connect to `ws://<host>/ws?participantId=<id>&roomId=<id>`.

The server validates that the participant is active and belongs to the room before completing the handshake. On successful connection, the server immediately sends a `ROOM_STATE` event with the full current snapshot.

### Envelope format

**Client → Server:**
```json
{
  "type": "PLAY",
  "requestId": "optional-correlation-id",
  "payload": { "positionSecs": 42.5 }
}
```

**Server → Client:**
```json
{
  "type": "PLAY",
  "payload": { "songId": "...", "positionSecs": 42.5, "stateUpdatedAt": "2026-09-01T12:00:00.000Z" },
  "timestamp": "2026-09-01T12:00:00.001Z"
}
```

### Client → Server events

| Event              | Role      | Payload                                  |
|--------------------|-----------|------------------------------------------|
| `PLAY`             | HOST only | `{ positionSecs: number }`               |
| `PAUSE`            | HOST only | `{ positionSecs: number }`               |
| `SEEK`             | HOST only | `{ positionSecs: number }`               |
| `NEXT`             | HOST only | `{}`                                     |
| `PREVIOUS`         | HOST only | `{}`                                     |
| `SET_SONG`         | HOST only | `{ entryId: string }`                    |
| `PLAYLIST_ADD`     | Any       | `{ songId: string }`                     |
| `PLAYLIST_REMOVE`  | Any       | `{ entryId: string }`                    |
| `PLAYLIST_REORDER` | Any       | `{ entryId: string, newPosition: number }` |
| `CHAT_MESSAGE`     | Any       | `{ content: string }`                    |

### Server → Client events

| Event                  | Description                                               |
|------------------------|-----------------------------------------------------------|
| `ROOM_STATE`           | Full snapshot sent on connection                          |
| `PLAY`                 | Playback started                                          |
| `PAUSE`                | Playback paused                                           |
| `SEEK`                 | Playback position changed                                 |
| `NEXT`                 | Moved to next track (also used for `SET_SONG`)            |
| `PREVIOUS`             | Moved to previous track                                   |
| `PLAYLIST_ADD`         | Song added to playlist                                    |
| `PLAYLIST_REMOVE`      | Song removed from playlist                                |
| `PLAYLIST_REORDER`     | Playlist entry moved                                      |
| `CHAT_MESSAGE`         | New chat message                                          |
| `USER_JOINED`          | Participant connected                                     |
| `USER_LEFT`            | Participant left                                          |
| `HOST_CHANGED`         | Host role transferred to a new participant                |
| `ROOM_CLOSED`          | Room closed (by host or TTL expiry)                       |
| `JOIN_REQUEST`         | New join request (sent to HOST only)                      |
| `JOIN_REQUEST_RESOLVED`| Join request accepted/rejected                            |
| `ERROR`                | Error response to a client event                          |

### Playback sync math

When a client connects (or reconnects), it reads the `ROOM_STATE` snapshot and computes the live position:

```
if isPlaying:
  livePosition = positionSecs + (now - stateUpdatedAt)
else:
  livePosition = positionSecs
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15
- Redis 6+

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd makemake

# Backend
cd backend
npm install

# Frontend (in a separate terminal)
cd ../frontend
npm install
```

### 2. Configure environment variables

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — see Environment Variables section below
```

### 3. Run database migrations

```bash
cd backend
npx prisma migrate dev --name init
```

### 4. Seed the song library

```bash
npm run seed
```

### 5. Start the development servers

```bash
# Backend (port 3000)
cd backend
npm run dev

# Frontend (port 5173, in a separate terminal)
cd frontend
npm run dev
```

The frontend dev server proxies API and WebSocket requests to the backend.

---

## Environment Variables

Create `backend/.env` with the following variables:

```env
# PostgreSQL connection string
DATABASE_URL="postgresql://user:password@localhost:5432/makemake"

# Redis connection URL
REDIS_URL="redis://localhost:6379"

# HTTP port (default: 3000)
PORT=3000

# Seconds before an INACTIVE room is automatically closed (default: 300)
ROOM_INACTIVE_TTL_SECS=300

# Milliseconds the host has to reconnect before a transfer fires (default: 8000)
WS_RECONNECT_GRACE_MS=8000
```

---

## Database

### Schema summary

| Table               | Description                              |
|---------------------|------------------------------------------|
| `songs`             | Global seeded music library              |
| `rooms`             | Rooms with playback state                |
| `participants`      | Temporary identities per room session    |
| `join_requests`     | Pending / resolved entry requests        |
| `playlist_entries`  | Room-owned ordered song queue            |
| `messages`          | Chat history per room                    |

### Migrations

After any schema change:

```bash
npx prisma migrate dev --name <description>
npx prisma generate
```

### Seeding

The seed script is idempotent — re-running it will not create duplicate songs.

```bash
npm run seed
```

The seed data includes 8 freely licensed tracks from Kevin MacLeod and public domain classical compositions. In production, swap `audioUrl` and `coverUrl` values for CDN paths once object storage is configured.

---

## Running the Load Balancer

To simulate a multi-instance production setup locally:

```bash
# Terminal 1 — Backend instance 1
cd backend
PORT=3000 npm run dev

# Terminal 2 — Backend instance 2
cd backend
PORT=3001 npm run dev

# Terminal 3 — Nginx load balancer
nginx -c nginx/nginx.conf -p .
```

All client traffic goes to `:8080`. Nginx distributes HTTP round-robin and pins each WebSocket connection to one instance. Cross-instance events travel through Redis Pub/Sub.

To stop Nginx:

```bash
nginx -c nginx/nginx.conf -p . -s stop
```

---

## Testing

Integration tests require a live PostgreSQL and Redis instance.

```bash
cd backend

# Run all tests once
npm test

# Watch mode
npm run test:watch
```

Tests run in isolated worker processes (one per file) to avoid port conflicts. The WebSocket grace period (`WS_RECONNECT_GRACE_MS`) is set to `0` in the test environment so host-transfer assertions are immediate.

---

## Production Deployment

### Build

```bash
# Backend
cd backend
npm run build       # tsc → dist/
npm start           # node dist/index.js

# Frontend
cd frontend
npm run build       # tsc + vite → dist/
```

### Checklist

**Infrastructure:**
- [ ] PostgreSQL 15 — configure connection pooling (PgBouncer recommended)
- [ ] Redis 6+ — enable keyspace notifications (`notify-keyspace-events KEx`) or ensure `CONFIG SET` permissions are granted so the app can enable them at startup
- [ ] Nginx (or equivalent reverse proxy) — configure SSL termination, adjust `proxy_read_timeout` for WebSocket connections
- [ ] Set up process supervision (systemd, PM2, or container orchestration)

**Environment:**
- [ ] `DATABASE_URL` — production PostgreSQL connection string
- [ ] `REDIS_URL` — production Redis connection string
- [ ] `ROOM_INACTIVE_TTL_SECS` — tune to your expected session length
- [ ] `WS_RECONNECT_GRACE_MS` — tune to expected network conditions (default 8s is reasonable)
- [ ] `NODE_ENV=production`

**Database:**
- [ ] Run `npx prisma migrate deploy` (not `migrate dev`) in production
- [ ] Run `npm run seed` to populate the song library
- [ ] Ensure database user has `SELECT`, `INSERT`, `UPDATE`, `DELETE` on all tables and `USAGE` on sequences

**Application:**
- [ ] Hook up health checks: `/health` (liveness) and `/ready` (readiness) to your load balancer or orchestrator
- [ ] The `/ready` endpoint returns `503` during startup and graceful shutdown — use this to drain traffic before rolling deploys
- [ ] SIGTERM triggers graceful shutdown: 2-second drain pause → close HTTP server → close WebSockets → disconnect Redis → disconnect PostgreSQL. Allow at least 15 seconds before force-killing the process.

**CDN / Object storage:**
- [ ] Replace seed `audioUrl` / `coverUrl` values with production CDN URLs before seeding production data
- [ ] Configure CORS on your CDN to allow the frontend origin

**Security:**
- [ ] Place the application behind a TLS-terminating reverse proxy — the app itself serves plain HTTP
- [ ] Restrict direct access to backend ports (3000, 3001) from the public internet — only Nginx should be exposed
- [ ] Review and tighten rate limits for your expected traffic profile
- [ ] Set `CORS` origins explicitly in Express if frontend and backend are on different domains

**Scaling:**
- [ ] Add backend instances by adding entries to the Nginx upstream block — no application code changes required
- [ ] PostgreSQL and Redis are shared infrastructure; they require their own capacity planning at higher scale
- [ ] Monitor Redis memory usage — evicted presence keys degrade the online indicator, but do not affect correctness

### Graceful shutdown sequence

The server listens for `SIGTERM` and `SIGINT`. On receipt:

1. Marks `/ready` as `503` immediately
2. Waits 2 seconds to allow the load balancer to stop routing new traffic
3. Closes the HTTP server (drains active connections)
4. Closes all WebSocket connections with code `1012 Service Restart`
5. Disconnects Redis
6. Disconnects PostgreSQL
7. Exits with code `0`

A 10-second hard timeout forces `process.exit(1)` if any step hangs.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Auth | None — temporary participants only | No account management complexity in V1 |
| Identity scope | Per room session (UUID + display name) | Simplest model that enables collaboration |
| Playback control | HOST only | Clear authority prevents conflicts |
| Playlist collaboration | All participants | Lower friction for discovery and queue management |
| Song source | Seeded library only | No upload infrastructure required in V1 |
| Playlist ownership | Room-owned, deleted with room | Rooms are ephemeral; no shared library state |
| Room termination | Explicit close by HOST, or inactivity TTL | Prevents orphaned rooms from accumulating |
| Host departure | Transfer to earliest-joined active participant | Predictable, deterministic |
| Pub/Sub for cross-instance broadcast | Redis | Sufficient for ephemeral events; avoids Kafka's operational complexity at this scale |
| Sticky sessions | Not used | Redis Pub/Sub makes every instance equivalent; pure round-robin is simpler and more resilient |
| Redis as primary database | Not used | PostgreSQL is the durable source of truth; Redis is volatile |
| Microservices | Not used | Room/participant/playlist domain is cohesive; a monolith is correct at V1 scale |
| Playback sync | Anchor timestamp + client-side math | Avoids high-frequency position broadcasts; scales to many clients |
| Host reconnect grace | Redis TTL key (8s default) | Cross-instance safe — any backend can cancel the grace period when the host reconnects |

---

## License

ISC
