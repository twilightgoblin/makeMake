"use strict";
// -----------------------------------------------------------------------------
// Makemake — Lightweight validation helpers
// No external validation library — keeps the dependency surface minimal.
// Each helper throws AppError on failure so handlers stay clean.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDisplayName = validateDisplayName;
exports.requireString = requireString;
exports.requireNonNegativeInt = requireNonNegativeInt;
exports.parsePosition = parsePosition;
exports.parsePagination = parsePagination;
const errors_js_1 = require("./errors.js");
// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------
/** Validates and trims a display name. Throws 400 on failure. */
function validateDisplayName(raw) {
    if (typeof raw !== "string")
        throw (0, errors_js_1.invalidDisplayName)();
    const trimmed = raw.trim();
    if (trimmed.length < 1 || trimmed.length > 30)
        throw (0, errors_js_1.invalidDisplayName)();
    return trimmed;
}
// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
/** Asserts a field is a non-empty string. */
function requireString(value, field) {
    if (typeof value !== "string" || value.trim() === "") {
        throw (0, errors_js_1.invalidBody)(`"${field}" is required and must be a non-empty string.`);
    }
    return value.trim();
}
/** Asserts a field is a non-negative integer. */
function requireNonNegativeInt(value, field) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
        throw (0, errors_js_1.invalidBody)(`"${field}" must be a non-negative integer.`);
    }
    return n;
}
/** Parses a playlist position, must be >= 0. */
function parsePosition(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0)
        throw (0, errors_js_1.invalidPosition)();
    return n;
}
/** Parses ?limit and ?offset from query string, with sensible defaults. */
function parsePagination(query, maxLimit = 100, defaultLimit = 50) {
    let limit = defaultLimit;
    let offset = 0;
    if (query["limit"] !== undefined) {
        const n = Number(query["limit"]);
        if (!Number.isInteger(n) || n < 1 || n > maxLimit) {
            throw (0, errors_js_1.invalidBody)(`"limit" must be an integer between 1 and ${maxLimit}.`);
        }
        limit = n;
    }
    if (query["offset"] !== undefined) {
        const n = Number(query["offset"]);
        if (!Number.isInteger(n) || n < 0) {
            throw (0, errors_js_1.invalidBody)(`"offset" must be a non-negative integer.`);
        }
        offset = n;
    }
    return { limit, offset };
}
//# sourceMappingURL=validate.js.map