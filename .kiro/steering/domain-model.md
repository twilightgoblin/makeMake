# Makemake — Domain Model & Room Lifecycle
## Phase 1 Design Document

---

## Overview

Makemake is a real-time social music player. Users can listen solo or create a
room and listen to the same music in sync with other people.

There is no traditional auth in V1. Participants are temporary identities scoped
to a single room session.

---

## Core Entities

### Song

The global music library. A first-class DB entity. Audio files live in object
storage (CDN). The DB holds metadata and URLs only.

```
Song
├── id          cuid
├── title
├── artist
├── album       (nullable)
├── duration    seconds (integer)
├── coverUrl    CDN URL
└── audioUrl    CDN URL
```

Songs are seeded. Participants cannot upload or link external audio in V1.

---

### Room

The central entity. A room has a unique human-readable code (e.g. `ABC123`)
that participants type to request entry.

```
Room
├── id
├── code            unique, human-readable join code
├── status          ACTIVE | INACTIVE | CLOSED
├── currentSongId   FK → Song (nullable)
├── isPlaying       boolean
├── positionSecs    float — playback position in seconds
├── stateUpdatedAt  when playback state last changed (used for sync math)
├── createdAt
└── updatedAt
```

Playback state (`currentSongId`, `isPlaying`, `positionSecs`, `stateUpdatedAt`)
is stored on the Room row so HTTP clients can hydrate state without a WebSocket
handshake. The realtime layer keeps it up to date.

---

### Participant

A temporary identity. No account, no password. Just a UUID + display name,
scoped to one room session.

```
Participant
├── id
├── displayName     chosen by the user on entry
├── role            HOST | MEMBER
├── roomId          FK → Room
├── joinedAt
└── leftAt          nullable — null means currently active
```

**Roles:**

| Role   | Capabilities |
|--------|-------------|
| HOST   | Playback control (play/pause/seek/next/prev) + all MEMBER capabilities |
| MEMBER | Listen, chat, add/reorder/remove playlist entries |

The room creator starts as HOST. If the HOST leaves, host responsibility
transfers to the earliest-joined remaining participant. The schema is designed
to support additional roles (DJ, MODERATOR) in the future without restructuring.

---

### JoinRequest

Entering a room code does not immediately admit someone. It creates a pending
JoinRequest that the HOST must accept or reject.

```
JoinRequest
├── id
├── displayName     what the requester wants to be called
├── status          PENDING | ACCEPTED | REJECTED
├── roomId          FK → Room
├── createdAt
└── resolvedAt      nullable — set when HOST acts on the request
```

Once accepted, a Participant row is created for that person.

---

### PlaylistEntry

The shared playlist is a join table between Room and Song with explicit
ordering. It is room-owned: when the room is deleted the entries cascade.

```
PlaylistEntry
├── id
├── position    integer, 0-indexed explicit ordering
├── roomId      FK → Room  (CASCADE delete)
├── songId      FK → Song
├── addedById   participantId of who added it (nullable — they may have left)
└── addedAt
```

Constraint: `(roomId, position)` is unique — no two entries share the same slot
in a room's playlist. The same song can appear multiple times at different
positions.

All participants (HOST and MEMBER) can add, remove, and reorder entries.

---

### Message

Chat messages sent inside a room. Persisted so latecomers can see recent
history. Cascade-deleted when the room is deleted.

```
Message
├── id
├── content
├── roomId      FK → Room  (CASCADE delete)
├── senderId    FK → Participant
└── sentAt
```

---

## Entity Relationships

```
Song ──────────────────────────────────────────────┐
 │                                                  │
 │ (currentSong)                                    │ (via PlaylistEntry)
 ▼                                                  │
Room ◄─────────────────── PlaylistEntry ────────────┘
 │
 ├──► Participant ──► Message
 │         │
 │     (senderId on Message)
 │
 └──► JoinRequest
```

- A Room has many Participants, PlaylistEntries, JoinRequests, Messages.
- A Participant belongs to one Room.
- A PlaylistEntry belongs to one Room and references one Song.
- A Message belongs to one Room and one Participant (sender).
- A JoinRequest belongs to one Room.
- A Song can be referenced by many PlaylistEntries and many Rooms (as currentSong).

---

## Room Lifecycle

```
                      CREATE
                         │
                         ▼
                      ACTIVE  ◄────────── participant joins
                         │
             ┌───────────┼───────────┐
             │           │           │
         host         participant   host
         leaves        leaves      closes
             │           │           │
             ▼           ▼           ▼
        transfer      remove      CLOSED
          host       participant
             │
             ▼
      ACTIVE (or INACTIVE
       if no one left)
             │
         TTL expiry
             │
             ▼
          EXPIRED
       (cleanup runs)
```

### State transition rules

| Event                       | Behavior                                                      |
|-----------------------------|---------------------------------------------------------------|
| Room created                | Status = ACTIVE, creator gets role = HOST                     |
| Participant joins            | Participant row created with leftAt = null                    |
| Participant leaves           | Participant.leftAt set to now()                               |
| HOST leaves                  | Host role transferred to earliest-joined active participant   |
| Last participant leaves      | Room status = INACTIVE                                        |
| HOST explicitly closes room | Room status = CLOSED; all participants effectively disconnected|
| INACTIVE room TTL expires    | Room + playlist + messages deleted (songs are global, kept)   |

### What "closed" means

- `CLOSED` rooms do not accept new join requests.
- `INACTIVE` rooms technically could be re-entered (Phase 7 TTL will clean them
  up automatically via Redis expiry).

---

## Playback State & Sync

Stored on the Room row for HTTP hydration:

| Field           | Purpose                                                   |
|-----------------|-----------------------------------------------------------|
| `currentSongId` | Which song is loaded                                      |
| `isPlaying`     | Whether it's playing or paused                            |
| `positionSecs`  | Last known playback position                              |
| `stateUpdatedAt`| Timestamp of the last state change                        |

When a client connects via WebSocket, it reads the Room row to compute the
current live position:

```
livePosition = positionSecs + (now - stateUpdatedAt)  // if isPlaying
livePosition = positionSecs                            // if paused
```

This is the foundation for the sync math in Phase 6.

---

## Database Schema Summary

| Table             | Description                              |
|-------------------|------------------------------------------|
| `songs`           | Global seeded music library              |
| `rooms`           | Rooms with playback state                |
| `participants`    | Temporary identities per room session    |
| `join_requests`   | Pending/resolved entry requests          |
| `playlist_entries`| Room-owned ordered song queue            |
| `messages`        | Chat history per room                    |

---

## Key Design Decisions (V1)

| Decision              | Choice                                                     |
|-----------------------|------------------------------------------------------------|
| Auth                  | None — temporary participants only                         |
| Identity scope        | Per room session (UUID + display name)                     |
| Playback control      | HOST only                                                  |
| Playlist collaboration| All participants                                           |
| Song source           | Seeded library only (no uploads or external URLs)          |
| Playlist ownership    | Room-owned, deleted with room                              |
| Room termination      | Explicit close by HOST, or inactivity TTL                  |
| Host departure        | Transfer to earliest-joined active participant             |

---

## Stack

| Layer       | Technology                              |
|-------------|-----------------------------------------|
| Runtime     | Node.js 20, TypeScript                  |
| Framework   | Express                                 |
| ORM         | Prisma 7 (driver adapter pattern)       |
| Database    | PostgreSQL 15                           |
| DB adapter  | `@prisma/adapter-pg` + `pg`             |
| Dev runner  | `tsx`                                   |

### Important Prisma 7 notes

- Datasource URL lives in `prisma7.config.ts`, **not** in `schema.prisma`.
- Every entrypoint must import `dotenv/config` before instantiating PrismaClient.
- PrismaClient must be constructed with a driver adapter:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

- The shared client lives at `src/lib/prisma.ts`. Import from there everywhere.
- After any schema change: `npx prisma migrate dev --name <description>` then
  `npx prisma generate`.
