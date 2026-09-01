// -----------------------------------------------------------------------------
// Makemake — Room expiry via Redis TTL
//
// Key schema:   room:expiry:<roomId>  →  value: roomId, TTL = ROOM_INACTIVE_TTL_SECS
//
// Lifecycle:
//   Room → INACTIVE  →  setRoomExpiry()
//   Room re-activated →  cancelRoomExpiry()
//   TTL expires       →  handleRoomExpired() → mark CLOSED in PG + broadcast
//
// TTL is read at call-time (not module-load) so env overrides work in tests.
// -----------------------------------------------------------------------------

import { getPublisher, getKeyspaceSubscriber } from "./redis.js";
import { prisma } from "./prisma.js";
import { publishRoomEvent } from "./roomEvents.js";
import { makeServerEvent } from "./wsTypes.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * TTL in seconds for INACTIVE rooms.
 * Always read from process.env at call time — never cached as a module
 * constant — so the value is consistent regardless of CJS module caching.
 *
 * configureRoomExpiry() is kept for explicit startup logging only;
 * setRoomExpiry() reads directly from process.env.
 */
export function getRoomInactiveTtlSecs(): number {
  return Number(process.env["ROOM_INACTIVE_TTL_SECS"] ?? 300);
}

/** Call once at startup for an explicit log line. Does not affect TTL reads. */
export function configureRoomExpiry(ttlSecs: number): void {
  // Propagate back to process.env so every module instance reads the same value.
  process.env["ROOM_INACTIVE_TTL_SECS"] = String(ttlSecs);
  console.log(`[room-expiry] configured ttl=${ttlSecs}s`);
}

// ---------------------------------------------------------------------------
// Key helper
// ---------------------------------------------------------------------------

export function roomExpiryKey(roomId: string): string {
  return `room:expiry:${roomId}`;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export async function setRoomExpiry(roomId: string): Promise<void> {
  const ttl = getRoomInactiveTtlSecs();
  await getPublisher().set(roomExpiryKey(roomId), roomId, "EX", ttl);
  console.log(`[room-expiry] armed  roomId=${roomId}  ttl=${ttl}s`);
}

export async function cancelRoomExpiry(roomId: string): Promise<void> {
  const deleted = await getPublisher().del(roomExpiryKey(roomId));
  if (deleted > 0) console.log(`[room-expiry] cancelled  roomId=${roomId}`);
}

export async function getRoomExpiryTtl(roomId: string): Promise<number | null> {
  const ttl = await getPublisher().ttl(roomExpiryKey(roomId));
  return ttl < 0 ? null : ttl;
}

// ---------------------------------------------------------------------------
// Expiry handler
// ---------------------------------------------------------------------------

async function handleRoomExpired(roomId: string): Promise<void> {
  console.log(`[room-expiry] expired  roomId=${roomId} — running cleanup`);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { status: true },
  });

  if (!room) {
    console.log(`[room-expiry] room ${roomId} not found — skipping`);
    return;
  }

  if (room.status !== "INACTIVE") {
    console.log(`[room-expiry] room ${roomId} is ${room.status} — skipping`);
    return;
  }

  await prisma.room.update({ where: { id: roomId }, data: { status: "CLOSED" } });
  console.log(`[room-expiry] room ${roomId} marked CLOSED`);

  await publishRoomEvent(roomId, makeServerEvent("ROOM_CLOSED", {}));
}

// ---------------------------------------------------------------------------
// Subscriber — dedicated ioredis connection (separate from Pub/Sub subscriber)
// ---------------------------------------------------------------------------

export async function subscribeRoomExpiry(): Promise<void> {
  try {
    await getPublisher().config("SET", "notify-keyspace-events", "KEx");
    console.log("[room-expiry] keyspace notifications enabled (KEx)");
  } catch (err) {
    console.warn(
      "[room-expiry] CONFIG SET failed — set notify-keyspace-events=KEx in redis.conf",
      err,
    );
  }

  const sub = getKeyspaceSubscriber();

  await new Promise<void>((resolve, reject) => {
    sub.subscribe("__keyevent@0__:expired", (err) => {
      if (err) {
        console.error("[room-expiry] subscribe failed", err);
        reject(err);
      } else {
        console.log("[room-expiry] subscribed to __keyevent@0__:expired");
        resolve();
      }
    });
  });

  sub.on("message", (_channel: string, key: string) => {
    if (!key.startsWith("room:expiry:")) return;
    void handleRoomExpired(key.slice("room:expiry:".length));
  });
}

// ---------------------------------------------------------------------------
// Recovery — re-arm INACTIVE rooms that lost their expiry key during a crash
// ---------------------------------------------------------------------------

export async function rearmInactiveRooms(): Promise<void> {
  const inactiveRooms = await prisma.room.findMany({
    where: { status: "INACTIVE" },
    select: { id: true },
  });

  if (inactiveRooms.length === 0) return;

  console.log(
    `[room-expiry] recovery: found ${inactiveRooms.length} INACTIVE room(s)`,
  );

  for (const room of inactiveRooms) {
    const ttl = await getRoomExpiryTtl(room.id);
    if (ttl === null) {
      console.log(`[room-expiry] recovery: re-arming roomId=${room.id}`);
      await setRoomExpiry(room.id);
    } else {
      console.log(`[room-expiry] recovery: roomId=${room.id} has ${ttl}s remaining`);
    }
  }
}
