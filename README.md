# Makemake

Makemake is a real-time collaborative music player. Create a room, share a six-character code, and every participant hears the same track at the same moment — with shared playlist control and live chat.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://make-make-git-main-goblintwilight-gmailcoms-projects.vercel.app)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](#license)
[![Node.js 20](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)

**Live:** https://make-make-git-main-goblintwilight-gmailcoms-projects.vercel.app

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Room Lifecycle](#room-lifecycle)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Deployment](#deployment)
- [Design Decisions](#design-decisions)
- [License](#license)

---

## Overview

Makemake has two modes:

**Solo** — An iPod-style interface for personal listening. Search YouTube, build a queue, and use the click-wheel controls to navigate.

**Room** — Create a named room and share the join code. Guests request entry; the host accepts or rejects from a floating notification panel. Once inside, all participants hear the same audio in sync. The host controls playback; everyone collaborates on the playlist.

Core capabilities:

- Synchronized playback using an anchor-timestamp model — no high-frequency position broadcasts
- Collaborative playlist: any participant can search YouTube and add, remove, or reorder tracks
- Host-gated join flow with real-time request notifications
- Persistent chat with history delivered to latecomers
- Real-time presence tracking via Redis TTL heartbeats
- Automatic host transfer (8-second grace period) when the host disconnects
- Automatic room expiry when all participants leave
- Horizontal scaling with no sticky sessions — Redis Pub/Sub synchronises all backend instances
- Graceful shutdown: HTTP drain, WebSocket close (1012), Redis and PostgreSQL disconnect

Audio is powered entirely by the YouTube IFrame Player API. No audio files are hosted.

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
      └────────┬──────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
    Redis           PostgreSQL
  (Pub/Sub,        (Durable state)
   Presence,
   Rate limit)
```

**HTTP / REST** handles all stateful mutations and initial hydration. Every request scoped to a room requires an `X-Participant-Id` header — no cookies, no JWTs.

**WebSocket** at `ws[s]://host/ws?participantId=<id>&roomId=<id>` carries all real-time events. On connection the server sends a full `ROOM_STATE` snapshot; subsequent messages are deltas.

**Redis Pub/Sub** bridges instances. When the host on S1 sends `PLAY`, S1 publishes to a per-room Redis channel. S2 receives it and forwards to its local sockets. No client is aware of which instance it is connected to.

**Playback sync** uses an anchor model: the server persists `positionSecs` and `stateUpdatedAt` on every playback event. Clients compute `livePosition = positionSecs + (now − stateUpdatedAt)` when playing. A drift-correction loop in `RoomPage` runs every five seconds and calls `player.syncTo()` if drift exceeds 0.5 seconds.

**Room expiry**: when the last participant leaves, the backend arms a Redis TTL key. On expiry, a keyspace notification triggers the backend to mark the room `CLOSED` in PostgreSQL and broadcast `ROOM_CLOSED` to any remaining WebSocket clients.

---

## Tech Stack

| Layer             | Technology                                              |
|-------------------|---------------------------------------------------------|
| Frontend          | React 19, TypeScript, Vite 6, React Router 6            |
| Audio             | YouTube IFrame Player API (hidden, fully programmatic)  |
| Backend           | Node.js 20, Express 5, TypeScript                       |
| WebSocket         | `ws` v8                                                 |
| Database          | PostgreSQL 15, Prisma 7 (driver adapter + `pg`)         |
| Cache / Messaging | Redis via ioredis — Pub/Sub, presence TTLs, rate limit  |
| Validation        | Zod 4                                                   |
| Load balancer     | Nginx — round-robin, passive health checks              |
| Testing           | Vitest, Supertest                                       |
| Deployment        | Vercel (frontend + backend as co-located services)      |

---

## Project Structure

```
makemake/
├── frontend/
│   └── src/
│       ├── App.tsx                      # Router: /, /solo, /room/:code
│       ├── types.ts                     # Shared API and WebSocket types
│       ├── lib/
│       │   ├── AudioPlayer.ts           # AudioPlayer class (wraps YouTubePlayerAdapter)
│       │   ├── YouTubePlayerAdapter.ts  # Thin wrapper over YT.Player IFrame API
│       │   ├── useRoomSocket.ts         # WebSocket hook: connection, reducer, all events
│       │   ├── api.ts                   # Typed HTTP client + computeLivePosition()
│       │   └── formatDuration.ts        # Display formatting utility
│       ├── components/
│       │   ├── ipod/                    # IPod shell, ClickWheel, IPodScreen, gestures
│       │   └── room/                    # RoomPanel: chat, presence, join requests
│       └── pages/
│           ├── HomePage.tsx             # Lobby: create, join, or go solo
│           ├── SoloPage.tsx             # Single-player iPod mode
│           └── RoomPage.tsx             # Multi-player room: audio, WS, playlist, chat
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma                # Database schema
│   │   ├── seed.ts                      # Song library seed (idempotent)
│   │   └── migrations/                  # Prisma migration history
│   └── src/
│       ├── index.ts                     # HTTP server, WS attachment, graceful shutdown
│       ├── lib/
│       │   ├── prisma.ts                # PrismaClient singleton
│       │   ├── redis.ts                 # ioredis client singletons (pub, sub, keyspace)
│       │   ├── roomEvents.ts            # Redis Pub/Sub publish/subscribe helpers
│       │   ├── roomExpiry.ts            # INACTIVE room TTL via Redis keyspace events
│       │   ├── hostGrace.ts             # Distributed host-transfer grace period
│       │   ├── presence.ts              # Online/offline via Redis TTL heartbeats
│       │   ├── rateLimit.ts             # Sliding-window rate limiting
│       │   ├── wsTypes.ts               # Full WebSocket protocol types (both directions)
│       │   ├── errors.ts                # Typed AppError and HTTP error helpers
│       │   ├── validate.ts              # Input validation helpers
│       │   ├── roomCode.ts              # Human-readable room code generator
│       │   ├── serverId.ts              # Per-instance ID for distributed tracing
│       │   └── YouTubeService.ts        # YouTube Data API v3: search and import
│       ├── middleware/
│       │   ├── requireParticipant.ts    # Validates X-Participant-Id header
│       │   ├── requireHost.ts           # Asserts caller role is HOST
│       │   ├── rateLimit.ts             # Express rate-limit middleware factory
│       │   └── errorHandler.ts          # Global Express error handler
│       ├── routes/
│       │   ├── rooms.ts                 # POST /rooms
│       │   ├── joinRequests.ts          # Join request CRUD
│       │   ├── roomDetail.ts            # GET /rooms/:id
│       │   ├── roomLifecycle.ts         # DELETE /rooms/:id, leave
│       │   ├── playlist.ts              # Playlist CRUD
│       │   ├── messages.ts              # Chat history
│       │   ├── presence.ts              # Online participants
│       │   └── songs.ts                 # Song library, YouTube search and import
│       └── ws/
│           ├── server.ts                # WebSocketServer attached to HTTP server
│           ├── connectionManager.ts     # In-process socket registry (roomId → Set<WS>)
│           ├── rateLimit.ts             # Per-connection WebSocket rate limiting
│           └── handlers/
│               ├── connection.ts        # Handshake and authentication
│               ├── message.ts           # Incoming message dispatcher
│               ├── disconnect.ts        # Leave, host transfer, room expiry
│               ├── playback.ts          # PLAY, PAUSE, SEEK, NEXT, PREVIOUS, SET_SONG
│               ├── playlist.ts          # PLAYLIST_ADD, REMOVE, REORDER
│               └── chat.ts              # CHAT_MESSAGE broadcast
│
├── vercel.json                          # Multi-service Vercel deployment config
└── package.json                         # Monorepo workspace root
```

---

## Data Model

```
Song ──< PlaylistEntry >── Room ──< Participant
                            │
                            ├──< JoinRequest
                            └──< Message
```

| Model          | Description                                                                 |
|----------------|-----------------------------------------------------------------------------|
| `Song`         | YouTube-backed track: provider, externalId, title, artist, duration, coverUrl |
| `Room`         | Central entity. Owns playback state, join code, status, and all relations.  |
| `Participant`  | Ephemeral identity scoped to one room session. Role: HOST or MEMBER.        |
| `JoinRequest`  | Entry request with status: PENDING, ACCEPTED, or REJECTED.                 |
| `PlaylistEntry`| Ordered Room-Song join table. Position is explicit; same song may repeat.   |
| `Message`      | Persisted chat message. Cascade-deleted with the room.                      |

No authentication is required. Participants are temporary identities — a UUID and display name stored in `sessionStorage`. The `X-Participant-Id` header carries this identity on every authenticated request.

---

## Room Lifecycle

```
CREATE
  |
  v
ACTIVE  <────────── participant joins (join request accepted)
  |
  |── host leaves ──► host transfer (8s grace) ──► ACTIVE
  |── all leave   ──► INACTIVE ──► TTL expiry ──► CLOSED
  |── host closes ──► CLOSED
```

| Event                          | Behavior                                                               |
|--------------------------------|------------------------------------------------------------------------|
| Room created                   | Status `ACTIVE`. Creator is HOST.                                      |
| Participant joins               | Participant row created with `leftAt = null`.                          |
| Participant leaves              | `Participant.leftAt` set to now.                                       |
| HOST leaves                     | 8-second Redis TTL key armed. On expiry, earliest-joined active member promoted. If host reconnects within grace period, transfer is cancelled. |
| Last participant leaves         | Status `INACTIVE`. Redis TTL key armed (`ROOM_INACTIVE_TTL_SECS`).    |
| HOST closes room explicitly     | Status `CLOSED`. `ROOM_CLOSED` broadcast immediately.                  |
| INACTIVE TTL expires            | Status `CLOSED` in PostgreSQL. `ROOM_CLOSED` broadcast.                |

---

## API Reference

All routes operating within a room require the header:

```
X-Participant-Id: <participantId>
```

### Health

| Method | Path      | Description                                     |
|--------|-----------|-------------------------------------------------|
| GET    | `/health` | Liveness check. Always returns 200.             |
| GET    | `/ready`  | Readiness check. Returns 503 during startup and graceful shutdown. Confirms DB connectivity. |

### Songs

| Method | Path             | Auth | Description                                        |
|--------|------------------|------|----------------------------------------------------|
| GET    | `/songs`         | —    | List the song library. Query: `?search`, `?limit`, `?offset`. |
| GET    | `/songs/search`  | —    | YouTube search proxy. Query: `?q`, `?limit`, `?pageToken`. |
| POST   | `/songs/import`  | —    | Import a YouTube video. Body: `{ provider, externalId }`. |

### Rooms

| Method | Path                                          | Auth        | Description                                         |
|--------|-----------------------------------------------|-------------|-----------------------------------------------------|
| POST   | `/rooms`                                      | —           | Create a room. Body: `{ displayName }`. Returns `{ room, participant }`. Rate-limited: 5/min per IP. |
| GET    | `/rooms/:id`                                  | Participant | Full room snapshot including playback state, participants, and (HOST only) pending join requests. |
| DELETE | `/rooms/:id`                                  | HOST        | Close the room immediately.                         |
| PATCH  | `/rooms/:id/participants/:pid/leave`           | Participant | Leave the room. Self-only.                          |

### Join Requests

| Method | Path                                        | Auth        | Description                                         |
|--------|---------------------------------------------|-------------|-----------------------------------------------------|
| POST   | `/rooms/:code/join-requests`                | —           | Submit a join request. Body: `{ displayName }`.     |
| GET    | `/rooms/:code/join-requests/:requestId`     | —           | Poll join request status.                           |
| PATCH  | `/rooms/:id/join-requests/:requestId`       | HOST        | Resolve request. Body: `{ action: "ACCEPT" | "REJECT" }`. On acceptance, a Participant row is created. |

### Playlist

| Method | Path                                          | Auth        | Description                             |
|--------|-----------------------------------------------|-------------|-----------------------------------------|
| GET    | `/rooms/:id/playlist`                         | Participant | Get the ordered playlist.               |
| POST   | `/rooms/:id/playlist`                         | Participant | Add a song. Body: `{ songId }`.         |
| DELETE | `/rooms/:id/playlist/:entryId`                | Participant | Remove an entry. Positions compacted.   |
| PATCH  | `/rooms/:id/playlist/:entryId/position`       | Participant | Move an entry. Body: `{ position }`.    |

### Messages

| Method | Path                   | Auth        | Description                            |
|--------|------------------------|-------------|----------------------------------------|
| GET    | `/rooms/:id/messages`  | Participant | Paginated chat history, newest first.  |

### Presence

| Method | Path                   | Auth        | Description                            |
|--------|------------------------|-------------|----------------------------------------|
| GET    | `/rooms/:id/presence`  | Participant | Currently online participants.         |

---

## WebSocket Protocol

Connect to `ws[s]://<host>/ws?participantId=<id>&roomId=<id>`.

The server validates that the participant is active and belongs to the room before completing the handshake. On success, `ROOM_STATE` is sent immediately as a full snapshot. All subsequent messages are deltas.

**Client to Server envelope:**

```json
{
  "type": "PLAY",
  "requestId": "optional-correlation-id",
  "payload": { "positionSecs": 42.5 }
}
```

**Server to Client envelope:**

```json
{
  "type": "PLAY",
  "payload": { "songId": "...", "positionSecs": 42.5, "stateUpdatedAt": "2026-09-04T12:00:00.000Z" },
  "timestamp": "2026-09-04T12:00:00.001Z"
}
```

### Client to Server Events

| Event              | Role      | Payload                                      |
|--------------------|-----------|----------------------------------------------|
| `PLAY`             | HOST      | `{ positionSecs: number }`                   |
| `PAUSE`            | HOST      | `{ positionSecs: number }`                   |
| `SEEK`             | HOST      | `{ positionSecs: number }`                   |
| `NEXT`             | HOST      | `{}`                                         |
| `PREVIOUS`         | HOST      | `{}`                                         |
| `SET_SONG`         | HOST      | `{ entryId: string, play?: boolean }`        |
| `PLAYLIST_ADD`     | Any       | `{ songId: string }`                         |
| `PLAYLIST_REMOVE`  | Any       | `{ entryId: string }`                        |
| `PLAYLIST_REORDER` | Any       | `{ entryId: string, newPosition: number }`   |
| `CHAT_MESSAGE`     | Any       | `{ content: string }`                        |

### Server to Client Events

| Event                    | Description                                                  |
|--------------------------|--------------------------------------------------------------|
| `ROOM_STATE`             | Full room snapshot sent on connection.                       |
| `PLAY`                   | Playback started. Includes anchor timestamp.                 |
| `PAUSE`                  | Playback paused. Includes anchor timestamp.                  |
| `SEEK`                   | Position changed. Includes anchor timestamp.                 |
| `NEXT`                   | Advanced to next track. Includes full playback state.        |
| `PREVIOUS`               | Moved to previous track. Includes full playback state.       |
| `PLAYLIST_ADD`           | Song added. Includes full entry object.                      |
| `PLAYLIST_REMOVE`        | Entry removed. Includes updated position list.               |
| `PLAYLIST_REORDER`       | Entry moved. Includes updated position list.                 |
| `CHAT_MESSAGE`           | New chat message with sender info.                           |
| `USER_JOINED`            | Participant connected.                                       |
| `USER_LEFT`              | Participant disconnected.                                    |
| `HOST_CHANGED`           | Host role transferred to a new participant.                  |
| `ROOM_CLOSED`            | Room closed by host action or TTL expiry.                    |
| `JOIN_REQUEST`           | New entry request. Sent to HOST only.                        |
| `JOIN_REQUEST_RESOLVED`  | Entry request accepted or rejected.                          |
| `ERROR`                  | Error response to a client event, with error code.           |

### Error Codes

`INVALID_EVENT` `INVALID_PAYLOAD` `MISSING_PARTICIPANT` `PARTICIPANT_NOT_ACTIVE` `HOST_ONLY` `ROOM_CLOSED` `ROOM_NOT_FOUND` `SONG_NOT_FOUND` `PLAYLIST_ENTRY_NOT_FOUND` `SEEK_OUT_OF_RANGE` `RATE_LIMITED` `INTERNAL_ERROR`

---

## Getting Started

### Prerequisites

- Node.js 20 or later
- PostgreSQL 15
- Redis 6 or later
- A YouTube Data API v3 key ([Google Cloud Console](https://console.cloud.google.com/))

### Install

```bash
git clone https://github.com/twilightgoblin/makeMake.git
cd makemake
npm install
```

This installs dependencies for both workspaces (`frontend` and `backend`).

### Configure environment

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

### Set up the database

```bash
cd backend
npx prisma migrate dev --name init
npm run seed
```

The seed script is idempotent and safe to re-run.

### Run the development servers

```bash
# Terminal 1 — Backend on port 3000
cd backend && npm run dev

# Terminal 2 — Frontend on port 5173
cd frontend && npm run dev
```

The Vite dev server proxies `/songs`, `/rooms`, and `/ws` to the backend. Open `http://localhost:5173`.

---

## Environment Variables

| Variable                 | Required | Default | Description                                                    |
|--------------------------|:--------:|---------|----------------------------------------------------------------|
| `DATABASE_URL`           | Yes      | —       | PostgreSQL connection string.                                  |
| `REDIS_URL`              | Yes      | —       | Redis connection URL. Use `rediss://` for TLS (e.g. Upstash).  |
| `YOUTUBE_API_KEY`        | Yes      | —       | YouTube Data API v3 key.                                       |
| `PORT`                   | No       | `3000`  | HTTP server port.                                              |
| `ROOM_INACTIVE_TTL_SECS` | No       | `300`   | Seconds before an inactive room is automatically closed.       |
| `WS_RECONNECT_GRACE_MS`  | No       | `8000`  | Milliseconds a disconnected host has before transfer fires.    |
| `NODE_ENV`               | No       | —       | Set to `production` in production environments.                |

---

## Testing

Integration tests require live PostgreSQL and Redis instances. The test suite uses the same `.env` file as development.

```bash
cd backend
npm test              # single run
npm run test:watch    # watch mode
```

Tests run in isolated Vitest worker processes to avoid port conflicts. `WS_RECONNECT_GRACE_MS` is forced to `0` in the test environment so host-transfer assertions do not require waiting.

---

## Deployment

### Vercel

The `vercel.json` at the repository root configures a multi-service deployment. Both frontend and backend are deployed from a single `git push`.

```json
{
  "services": {
    "frontend": { "root": "frontend/", "framework": "vite" },
    "backend":  { "root": "backend/", "framework": "express", "buildCommand": "npx prisma generate" }
  },
  "rewrites": [
    { "source": "/ws",        "destination": { "service": "backend" } },
    { "source": "/health",    "destination": { "service": "backend" } },
    { "source": "/ready",     "destination": { "service": "backend" } },
    { "source": "/songs(.*)", "destination": { "service": "backend" } },
    { "source": "/rooms(.*)", "destination": { "service": "backend" } },
    { "source": "/(.*)",      "destination": { "service": "frontend" } }
  ]
}
```

Set `DATABASE_URL`, `REDIS_URL`, and `YOUTUBE_API_KEY` in the Vercel project environment settings, then run the database migration once before the first deploy:

```bash
npx prisma migrate deploy
```

### Self-hosted

```bash
# Build
cd backend  && npm run build    # compiles to dist/
cd frontend && npm run build    # compiles to dist/

# Run backend
cd backend
node dist/index.js
```

Serve the frontend `dist/` directory from a CDN or static file server. Configure your reverse proxy to route `/songs/*`, `/rooms/*`, `/ws`, `/health`, and `/ready` to the backend, and all other paths to the frontend SPA `index.html`.

**Production checklist:**

- [ ] Run `npx prisma migrate deploy` against the production database (never `migrate dev`)
- [ ] Enable Redis keyspace notifications: `CONFIG SET notify-keyspace-events KEx`
- [ ] Nginx: set `proxy_http_version 1.1` and pass `Upgrade` and `Connection` headers for WebSocket support
- [ ] Nginx: set `proxy_read_timeout` to at least one hour for long-lived WebSocket connections
- [ ] Wire `/health` (liveness) and `/ready` (readiness) to your load balancer or orchestrator health checks
- [ ] Allow at least 15 seconds before force-killing the process on deploy — graceful shutdown drains HTTP, closes WebSocket connections (code 1012), disconnects Redis, and disconnects PostgreSQL, with a 10-second hard timeout
- [ ] Restrict direct access to backend ports (3000, 3001) from the public internet; expose only through the reverse proxy
- [ ] Set `NODE_ENV=production`

### Multi-instance with Nginx

```bash
# Two backend instances
PORT=3000 npm run dev    # Terminal 1
PORT=3001 npm run dev    # Terminal 2

# Nginx load balancer on port 8080
nginx -c backend/nginx/nginx.conf -p .
```

Nginx round-robins HTTP requests and pins each WebSocket connection to one instance. Redis Pub/Sub keeps all instances in sync — no sticky sessions required.

---

## Design Decisions

| Decision                   | Choice                              | Rationale                                                                 |
|----------------------------|-------------------------------------|---------------------------------------------------------------------------|
| Authentication             | None — ephemeral participants       | Eliminates account management overhead in V1.                             |
| Playback authority         | HOST only                           | Single authority prevents conflicting commands.                           |
| Playlist collaboration     | All participants                    | Lower friction for discovery and queue management.                        |
| Playback sync              | Anchor timestamp, client-side math  | Avoids high-frequency position broadcasts; scales to any number of listeners. |
| Cross-instance delivery    | Redis Pub/Sub                       | Sufficient for ephemeral events; avoids Kafka's operational complexity.   |
| Sticky sessions            | Not used                            | Redis equivalence means any instance can serve any request.               |
| Durable storage            | PostgreSQL, not Redis               | Redis is volatile; PostgreSQL is the source of truth.                     |
| Host departure handling    | Redis TTL key, 8-second grace       | Distributed-safe: any instance can cancel the transfer key.               |
| Room cleanup               | TTL-based auto-expiry               | Prevents orphaned rooms from accumulating without manual intervention.    |
| Audio source               | YouTube IFrame API                  | No audio hosting or CDN infrastructure required.                          |
| Architecture               | Monolith                            | Room, participant, and playlist are a cohesive domain at V1 scale.        |

---

## License

ISC
