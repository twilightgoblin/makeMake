"use strict";
// -----------------------------------------------------------------------------
// Makemake — Shared error types
// All API errors flow through AppError so the error handler can produce a
// consistent { error: { code, message } } response body.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.tooManyRequests = exports.unprocessable = exports.conflict = exports.notFound = exports.forbidden = exports.invalidPosition = exports.invalidDisplayName = exports.invalidBody = exports.AppError = void 0;
class AppError extends Error {
    constructor(statusCode, code, message) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = "AppError";
    }
}
exports.AppError = AppError;
// ---------------------------------------------------------------------------
// 400
// ---------------------------------------------------------------------------
const invalidBody = (message) => new AppError(400, "INVALID_BODY", message);
exports.invalidBody = invalidBody;
const invalidDisplayName = () => new AppError(400, "INVALID_DISPLAY_NAME", "Display name must be between 1 and 30 characters.");
exports.invalidDisplayName = invalidDisplayName;
const invalidPosition = () => new AppError(400, "INVALID_POSITION", "position must be a non-negative integer.");
exports.invalidPosition = invalidPosition;
// ---------------------------------------------------------------------------
// 403
// ---------------------------------------------------------------------------
const forbidden = (message = "You do not have permission to perform this action.") => new AppError(403, "FORBIDDEN", message);
exports.forbidden = forbidden;
// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------
const notFound = (resource) => new AppError(404, "NOT_FOUND", `${resource} not found.`);
exports.notFound = notFound;
// ---------------------------------------------------------------------------
// 409
// ---------------------------------------------------------------------------
const conflict = (code, message) => new AppError(409, code, message);
exports.conflict = conflict;
// ---------------------------------------------------------------------------
// 422
// ---------------------------------------------------------------------------
const unprocessable = (code, message) => new AppError(422, code, message);
exports.unprocessable = unprocessable;
// ---------------------------------------------------------------------------
// 429
// ---------------------------------------------------------------------------
const tooManyRequests = (message = "Too many requests.") => new AppError(429, "RATE_LIMITED", message);
exports.tooManyRequests = tooManyRequests;
//# sourceMappingURL=errors.js.map