// -----------------------------------------------------------------------------
// Makemake — WS disconnect handler
//
// Called when a participant's socket closes (intentional or network drop).
//
// This is a connection-level event, NOT the same as the HTTP "leave room"
// endpoint. A disconnect means the socket closed; the participant row stays
// intact and leftAt is NOT set here. That separation keeps the door open for
// reconnection logic in a future phase.
//
// However, we do need to:
//   1. Remove the connection from the manager
//   2. Broadcast USER_LEFT to the room
//   3. If the disconnecting participant was the HOST, transfer host role to
//      the earliest-joined remaining *connected* participant and broadcast
//      HOST_CHANGED.
//   4. If no other connected participants remain, leave the room quietly
//      (the HTTP lifecycle handles INACTIVE status separately via TTL).
//
// NOTE: Host transfer here only updates the in-memory role cache and the DB.
//       The HTTP "leave" endpoint does the same for intentional departures.
//       Both paths call the same DB update so the DB stays consistent.
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
} from "../connectionManager.js";

export async function handleDisconnect(participantId: string): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Remove from connection manager
  // -------------------------------------------------------------------------
  const record = removeConnection(participantId);
  if (!record) return; // already cleaned up (double-close guard)

  const { roomId, displayName, role } = record;

  // -------------------------------------------------------------------------
  // 2. Broadcast USER_LEFT to remaining room members
  // -------------------------------------------------------------------------
  const userLeftPayload: UserLeftPayload = { participantId, displayName };
  broadcastToRoom(roomId, makeServerEvent("USER_LEFT", userLeftPayload));

  // -------------------------------------------------------------------------
  // 3. Host transfer (if needed)
  // -------------------------------------------------------------------------
  if (role === "HOST") {
    const remaining = getRoomConnections(roomId);

    if (remaining.length > 0) {
      // Find the earliest-joined active participant from DB among those still connected.
      const connectedIds = remaining.map((c) => c.participantId);

      const newHost = await prisma.participant.findFirst({
        where: { id: { in: connectedIds }, roomId, leftAt: null },
        orderBy: { joinedAt: "asc" },
        select: { id: true, displayName: true },
      });

      if (newHost) {
        // Update DB
        await prisma.participant.update({
          where: { id: newHost.id },
          data: { role: "HOST" },
        });

        // Demote old host in DB (they may reconnect later as MEMBER)
        await prisma.participant.update({
          where: { id: participantId },
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
    }
  }

  // -------------------------------------------------------------------------
  // 4. No-op if room is now empty — TTL cleanup handles INACTIVE status.
  // -------------------------------------------------------------------------
}
