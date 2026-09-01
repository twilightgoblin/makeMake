"use strict";
// -----------------------------------------------------------------------------
// Makemake — Participant resolution middleware
// Reads the X-Participant-Id header, verifies the participant:
//   1. Exists in the DB
//   2. Belongs to the room specified by :id in the route params
//   3. Is still active (leftAt === null)
// Attaches the Participant record to res.locals.participant.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireParticipant = requireParticipant;
const prisma_js_1 = require("../lib/prisma.js");
const errors_js_1 = require("../lib/errors.js");
async function requireParticipant(req, res, next) {
    const participantId = req.headers["x-participant-id"];
    if (!participantId || typeof participantId !== "string") {
        return next(new errors_js_1.AppError(401, "MISSING_PARTICIPANT_ID", "X-Participant-Id header is required."));
    }
    // Route params can use :id for room-scoped routes.
    const roomId = String(req.params["id"]);
    if (!roomId) {
        return next(new errors_js_1.AppError(500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred."));
    }
    const participant = await prisma_js_1.prisma.participant.findFirst({
        where: {
            id: participantId,
            roomId,
            leftAt: null,
        },
    });
    if (!participant) {
        return next(new errors_js_1.AppError(403, "NOT_A_PARTICIPANT", "You are not an active participant in this room."));
    }
    res.locals["participant"] = participant;
    next();
}
//# sourceMappingURL=requireParticipant.js.map