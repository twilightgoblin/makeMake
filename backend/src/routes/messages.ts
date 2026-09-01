// -----------------------------------------------------------------------------
// Makemake — Messages routes
//
// GET /rooms/:id/messages — fetch paginated chat history for a room.
// Requires an active participant (X-Participant-Id header).
//
// Pagination: reverse-chronological cursor via ?before=<messageId>
// Each page is returned oldest-first so the client can append to the top
// of a chat view without reversing in JS.
// -----------------------------------------------------------------------------

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireParticipant } from "../middleware/requireParticipant.js";
import { invalidBody } from "../lib/errors.js";

export const messagesRouter = Router();

// ---------------------------------------------------------------------------
// GET /rooms/:id/messages
//
// Headers: X-Participant-Id (required)
//
// Query params:
//   ?limit=<int>    — default 50, max 100
//   ?before=<id>    — cursor: return messages sent before this message id
//                     (for "load older messages" / reverse-chronological paging)
//
// Sort: sentAt DESC, id DESC within same timestamp (deterministic tiebreak)
// Returns: 200 { messages: [...], hasMore: boolean }
//   Messages are flipped to oldest-first before sending so the client receives
//   a chronologically ascending slice ready to prepend to a chat view.
// ---------------------------------------------------------------------------

messagesRouter.get("/:id/messages", requireParticipant, async (req, res) => {
  const roomId = String(req.params["id"]);

  // Parse limit
  let limit = 50;
  if (req.query["limit"] !== undefined) {
    const n = Number(req.query["limit"]);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw invalidBody('"limit" must be an integer between 1 and 100.');
    }
    limit = n;
  }

  // Parse cursor
  const beforeId =
    typeof req.query["before"] === "string" ? req.query["before"] : undefined;

  let pivot: { sentAt: Date; id: string } | undefined;
  if (beforeId) {
    const found = await prisma.message.findUnique({
      where: { id: beforeId },
      select: { id: true, sentAt: true },
    });
    if (!found) {
      throw invalidBody('"before" references a message that does not exist.');
    }
    pivot = found;
  }

  // Build the WHERE clause.
  // Primary sort is sentAt DESC, secondary sort is id DESC (cuid is
  // lexicographically monotonic, so this gives a deterministic stable order
  // even when multiple messages share the same millisecond timestamp).
  //
  // For the cursor: we want rows that come "after" the pivot in DESC order,
  // i.e. rows where sentAt < pivot.sentAt, OR (sentAt == pivot.sentAt AND id < pivot.id).
  const where = pivot
    ? {
        roomId,
        OR: [
          { sentAt: { lt: pivot.sentAt } },
          { sentAt: pivot.sentAt, id: { lt: pivot.id } },
        ],
      }
    : { roomId };

  // Fetch limit+1 so we can set hasMore without a separate count query.
  const raw = await prisma.message.findMany({
    where,
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      content: true,
      sentAt: true,
      sender: {
        select: { id: true, displayName: true },
      },
    },
  });

  const hasMore = raw.length > limit;
  const page = raw.slice(0, limit);

  // Reverse to oldest-first so the client can prepend the slice directly.
  page.reverse();

  res.json({ messages: page, hasMore });
});
