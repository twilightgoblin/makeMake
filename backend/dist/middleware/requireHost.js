"use strict";
// -----------------------------------------------------------------------------
// Makemake — Host-only guard middleware
// Must run AFTER requireParticipant (depends on res.locals.participant).
// Rejects the request with 403 if the participant's role is not HOST.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireHost = requireHost;
const errors_js_1 = require("../lib/errors.js");
function requireHost(_req, res, next) {
    const participant = res.locals["participant"];
    if (!participant || participant.role !== "HOST") {
        return next(new errors_js_1.AppError(403, "HOST_ONLY", "Only the room host can perform this action."));
    }
    next();
}
//# sourceMappingURL=requireHost.js.map