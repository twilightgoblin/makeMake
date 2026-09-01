"use strict";
// -----------------------------------------------------------------------------
// Makemake — Server identity
//
// A stable identifier for this process instance. Used by the presence layer
// so each PresenceRecord knows which server owns that WebSocket connection.
//
// Resolution order:
//   1. SERVER_ID env var  (set this in production / docker-compose)
//   2. Fallback: "server-<PORT>"  (useful for local multi-instance demos)
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_ID = void 0;
exports.SERVER_ID = process.env["SERVER_ID"] ?? `server-${process.env["PORT"] ?? "3000"}`;
//# sourceMappingURL=serverId.js.map