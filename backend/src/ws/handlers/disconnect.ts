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

import { prisma } from "../../lib/prisma.js";
import {
  makeServerEvent,
  type UserLeftPayload,
  type HostChangedPayload,
} from "../../lib/wsTypes.js";
import {
  removeConnection,
  updateRole,
  broadcastToRoom,
  getRoomConnections,
  setPendingTransfer,
} from "../connectionManager.js";

// Grace period before a HOST disconnect triggers a host transfer.
// Set WS_RECONNECT_GRACE_MS=0 in tests to get instant transfer (backward-compat).
// Read via a getter so tests can override process.env after module load.
function getGraceMs(): number {
  return Number(process.env["WS_RECONNECT_GRACE_MS"] ?? 8_000);
}

export async function handleDisconnect(participantId: string): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Remove from connection manager
  // -------------------------------------------------------------------------
  const record = removeConnection(participantId);
  if (!record) return; // already cleaned up (double-close guard)

  const { roomId, displayName, role } = record;

  // -------------------------------------------------------------------------
  // 2. Broadcast USER_LEFT to remaining room members (immediate — presence
  //    is accurate as of right now)
  // -------------------------------------------------------------------------
  const userLeftPayload: UserLeftPayload = { participantId, displayName };
  broadcastToRoom(roomId, makeServerEvent("USER_LEFT", userLeftPayload));

  // -------------------------------------------------------------------------
  // 3. Host transfer — deferred by GRACE_MS
  // -------------------------------------------------------------------------
  if (role !== "HOST") return;

  const timer = setTimeout(() => {
    void doHostTransfer(participantId, roomId);
  }, getGraceMs());

  setPendingTransfer(participantId, timer);
}

// ---------------------------------------------------------------------------
// Deferred host-transfer logic
// Runs only if the HOST didn't reconnect within the grace window.
// ---------------------------------------------------------------------------
async function doHostTransfer(
  departingHostId: string,
  roomId: string,
): Promise<void> {
  const remaining = getRoomConnections(roomId);

  if (remaining.length === 0) {
    // Room is empty — no one to transfer to, TTL will clean up.
    return;
  }

  const connectedIds = remaining.map((c) => c.participantId);

  const newHost = await prisma.participant.findFirst({
    where: { id: { in: connectedIds }, roomId, leftAt: null },
    orderBy: { joinedAt: "asc" },
    select: { id: true, displayName: true },
  });

  if (!newHost) return;

  // Update DB
  await prisma.participant.update({
    where: { id: newHost.id },
    data: { role: "HOST" },
  });

  // Demote old host in DB so if they reconnect later they come back as MEMBER
  await prisma.participant.update({
    where: { id: departingHostId },
    data: { role: "MEMBER" },
  });

  // Update in-memory cache
  updateRole(newHost.id, "HOST");

  const hostChangedPayload: HostChangedPayload = {
    newHostId: newHost.id,
    newHostDisplayName: newHost.displayName,
  };
  broadcastToRoom(roomId, makeServerEvent("HOST_CHANGED", hostChangedPayload));
}
