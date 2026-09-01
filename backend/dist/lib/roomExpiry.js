"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoomInactiveTtlSecs = getRoomInactiveTtlSecs;
exports.configureRoomExpiry = configureRoomExpiry;
exports.roomExpiryKey = roomExpiryKey;
exports.setRoomExpiry = setRoomExpiry;
exports.cancelRoomExpiry = cancelRoomExpiry;
exports.getRoomExpiryTtl = getRoomExpiryTtl;
exports.subscribeRoomExpiry = subscribeRoomExpiry;
exports.rearmInactiveRooms = rearmInactiveRooms;
const redis_js_1 = require("./redis.js");
const prisma_js_1 = require("./prisma.js");
const roomEvents_js_1 = require("./roomEvents.js");
const wsTypes_js_1 = require("./wsTypes.js");
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
function getRoomInactiveTtlSecs() {
    return Number(process.env["ROOM_INACTIVE_TTL_SECS"] ?? 300);
}
/** Call once at startup for an explicit log line. Does not affect TTL reads. */
function configureRoomExpiry(ttlSecs) {
    // Propagate back to process.env so every module instance reads the same value.
    process.env["ROOM_INACTIVE_TTL_SECS"] = String(ttlSecs);
    console.log(`[room-expiry] configured ttl=${ttlSecs}s`);
}
// ---------------------------------------------------------------------------
// Key helper
// ---------------------------------------------------------------------------
function roomExpiryKey(roomId) {
    return `room:expiry:${roomId}`;
}
// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------
async function setRoomExpiry(roomId) {
    const ttl = getRoomInactiveTtlSecs();
    await (0, redis_js_1.getPublisher)().set(roomExpiryKey(roomId), roomId, "EX", ttl);
    console.log(`[room-expiry] armed  roomId=${roomId}  ttl=${ttl}s`);
}
async function cancelRoomExpiry(roomId) {
    const deleted = await (0, redis_js_1.getPublisher)().del(roomExpiryKey(roomId));
    if (deleted > 0)
        console.log(`[room-expiry] cancelled  roomId=${roomId}`);
}
async function getRoomExpiryTtl(roomId) {
    const ttl = await (0, redis_js_1.getPublisher)().ttl(roomExpiryKey(roomId));
    return ttl < 0 ? null : ttl;
}
// ---------------------------------------------------------------------------
// Expiry handler
// ---------------------------------------------------------------------------
async function handleRoomExpired(roomId) {
    console.log(`[room-expiry] expired  roomId=${roomId} — running cleanup`);
    const room = await prisma_js_1.prisma.room.findUnique({
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
    await prisma_js_1.prisma.room.update({ where: { id: roomId }, data: { status: "CLOSED" } });
    console.log(`[room-expiry] room ${roomId} marked CLOSED`);
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("ROOM_CLOSED", {}));
}
// ---------------------------------------------------------------------------
// Subscriber — dedicated ioredis connection (separate from Pub/Sub subscriber)
// ---------------------------------------------------------------------------
async function subscribeRoomExpiry() {
    try {
        await (0, redis_js_1.getPublisher)().config("SET", "notify-keyspace-events", "KEx");
        console.log("[room-expiry] keyspace notifications enabled (KEx)");
    }
    catch (err) {
        console.warn("[room-expiry] CONFIG SET failed — set notify-keyspace-events=KEx in redis.conf", err);
    }
    const sub = (0, redis_js_1.getKeyspaceSubscriber)();
    await new Promise((resolve, reject) => {
        sub.subscribe("__keyevent@0__:expired", (err) => {
            if (err) {
                console.error("[room-expiry] subscribe failed", err);
                reject(err);
            }
            else {
                console.log("[room-expiry] subscribed to __keyevent@0__:expired");
                resolve();
            }
        });
    });
    sub.on("message", (_channel, key) => {
        if (!key.startsWith("room:expiry:"))
            return;
        void handleRoomExpired(key.slice("room:expiry:".length));
    });
}
// ---------------------------------------------------------------------------
// Recovery — re-arm INACTIVE rooms that lost their expiry key during a crash
// ---------------------------------------------------------------------------
async function rearmInactiveRooms() {
    const inactiveRooms = await prisma_js_1.prisma.room.findMany({
        where: { status: "INACTIVE" },
        select: { id: true },
    });
    if (inactiveRooms.length === 0)
        return;
    console.log(`[room-expiry] recovery: found ${inactiveRooms.length} INACTIVE room(s)`);
    for (const room of inactiveRooms) {
        const ttl = await getRoomExpiryTtl(room.id);
        if (ttl === null) {
            console.log(`[room-expiry] recovery: re-arming roomId=${room.id}`);
            await setRoomExpiry(room.id);
        }
        else {
            console.log(`[room-expiry] recovery: roomId=${room.id} has ${ttl}s remaining`);
        }
    }
}
//# sourceMappingURL=roomExpiry.js.map