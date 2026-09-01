"use strict";
// -----------------------------------------------------------------------------
// Makemake — WS disconnect handler
//
// Called when a participant's socket closes (intentional or network drop).
//
// disconnect ≠ leave.
// A socket close does NOT set leftAt on the participant row. That separation
// means a browser refresh (disconnect → reconnect on the same participantId)
// preserves room membership and role.
//
// What we do on disconnect:
//   1. Remove the connection from the manager
//   2. Broadcast USER_LEFT immediately (so presence is accurate)
//   3. If the disconnecting participant was the HOST, start a reconnect grace
//      period (WS_RECONNECT_GRACE_MS, default 8 s). If they reconnect within
//      the window, the timer is cancelled in connection.ts and they keep HOST.
//      If the timer fires, transfer host to the earliest-joined connected
//      participant and broadcast HOST_CHANGED.
//   4. If no other connected participants remain, leave quietly — TTL handles
//      INACTIVE status.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDisconnect = handleDisconnect;
const prisma_js_1 = require("../../lib/prisma.js");
const wsTypes_js_1 = require("../../lib/wsTypes.js");
const connectionManager_js_1 = require("../connectionManager.js");
const roomEvents_js_1 = require("../../lib/roomEvents.js");
const presence_js_1 = require("../../lib/presence.js");
const hostGrace_js_1 = require("../../lib/hostGrace.js");
// Grace period before a HOST disconnect triggers a host transfer.
// Set WS_RECONNECT_GRACE_MS=0 in tests to get instant transfer (backward-compat).
// Read via a getter so tests can override process.env after module load.
function getGraceMs() {
    return Number(process.env["WS_RECONNECT_GRACE_MS"] ?? 8000);
}
async function handleDisconnect(participantId, socket) {
    // -------------------------------------------------------------------------
    // 0. Clear all per-socket intervals/timers so they don't fire on a dead socket
    // -------------------------------------------------------------------------
    if (socket) {
        const s = socket;
        if (s._heartbeat !== undefined) {
            clearInterval(s._heartbeat);
            s._heartbeat = undefined;
        }
        if (s._ping !== undefined) {
            clearInterval(s._ping);
            s._ping = undefined;
        }
        if (s._pongTimer !== undefined) {
            clearTimeout(s._pongTimer);
            s._pongTimer = undefined;
        }
    }
    // -------------------------------------------------------------------------
    // 1. Remove from connection manager
    // -------------------------------------------------------------------------
    const record = (0, connectionManager_js_1.removeConnection)(participantId);
    if (!record)
        return; // already cleaned up (double-close guard)
    const { roomId, displayName, role } = record;
    // -------------------------------------------------------------------------
    // 1b. Remove distributed presence from Redis (clean disconnect)
    // -------------------------------------------------------------------------
    await (0, presence_js_1.removePresence)(participantId, roomId);
    // -------------------------------------------------------------------------
    // 2. Broadcast USER_LEFT to remaining room members (immediate — presence
    //    is accurate as of right now)
    // -------------------------------------------------------------------------
    const userLeftPayload = { participantId, displayName };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("USER_LEFT", userLeftPayload));
    // -------------------------------------------------------------------------
    // 3. Host transfer — deferred by GRACE_MS
    //
    // Two-layer guard:
    //   a) In-process setTimeout  — drives the attempt on THIS instance
    //   b) Redis key host:grace:<id>  — cross-instance flag; if the HOST
    //      reconnects on ANY instance within the grace window, that instance
    //      deletes the key, and doHostTransfer() will abort on seeing it gone.
    // -------------------------------------------------------------------------
    if (role !== "HOST")
        return;
    // Arm the cross-instance Redis grace key BEFORE starting the timer so
    // the flag is visible to all instances immediately.
    await (0, hostGrace_js_1.armHostGrace)(participantId);
    const timer = setTimeout(() => {
        void doHostTransfer(participantId, roomId);
    }, getGraceMs());
    (0, connectionManager_js_1.setPendingTransfer)(participantId, timer);
}
// ---------------------------------------------------------------------------
// Deferred host-transfer logic
// Runs only if the HOST didn't reconnect within the grace window.
// ---------------------------------------------------------------------------
async function doHostTransfer(departingHostId, roomId) {
    // Cross-instance guard: if the HOST reconnected on ANY backend instance,
    // cancelHostGrace() will have deleted this key. A missing key means the
    // transfer must not proceed regardless of what our local timer says.
    const graceStillActive = await (0, hostGrace_js_1.isHostGraceActive)(departingHostId);
    if (!graceStillActive) {
        console.log(`[ws] host-transfer aborted: HOST ${departingHostId} reconnected (grace key gone)`);
        return;
    }
    const remaining = (0, connectionManager_js_1.getRoomConnections)(roomId);
    if (remaining.length === 0) {
        // Room is empty — no one to transfer to, TTL will clean up.
        return;
    }
    const connectedIds = remaining.map((c) => c.participantId);
    const newHost = await prisma_js_1.prisma.participant.findFirst({
        where: { id: { in: connectedIds }, roomId, leftAt: null },
        orderBy: { joinedAt: "asc" },
        select: { id: true, displayName: true },
    });
    if (!newHost)
        return;
    // Update DB
    await prisma_js_1.prisma.participant.update({
        where: { id: newHost.id },
        data: { role: "HOST" },
    });
    // Demote old host in DB so if they reconnect later they come back as MEMBER
    await prisma_js_1.prisma.participant.update({
        where: { id: departingHostId },
        data: { role: "MEMBER" },
    });
    // Update in-memory cache
    (0, connectionManager_js_1.updateRole)(newHost.id, "HOST");
    const hostChangedPayload = {
        newHostId: newHost.id,
        newHostDisplayName: newHost.displayName,
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("HOST_CHANGED", hostChangedPayload));
}
//# sourceMappingURL=disconnect.js.map