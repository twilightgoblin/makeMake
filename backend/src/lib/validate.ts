// -----------------------------------------------------------------------------
// Makemake — Lightweight validation helpers
// No external validation library — keeps the dependency surface minimal.
// Each helper throws AppError on failure so handlers stay clean.
// -----------------------------------------------------------------------------

import { invalidDisplayName, invalidBody, invalidPosition } from "./errors.js";

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

/** Validates and trims a display name. Throws 400 on failure. */
export function validateDisplayName(raw: unknown): string {
  if (typeof raw !== "string") throw invalidDisplayName();
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 30) throw invalidDisplayName();
  return trimmed;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Asserts a field is a non-empty string. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidBody(`"${field}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

/** Asserts a field is a non-negative integer. */
export function requireNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw invalidBody(`"${field}" must be a non-negative integer.`);
  }
  return n;
}

/** Parses a playlist position, must be >= 0. */
export function parsePosition(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw invalidPosition();
  return n;
}

// ---------------------------------------------------------------------------
// Pagination query params
// ---------------------------------------------------------------------------

export interface PaginationParams {
  limit: number;
  offset: number;
}

/** Parses ?limit and ?offset from query string, with sensible defaults. */
export function parsePagination(
  query: Record<string, unknown>,
  maxLimit = 100,
  defaultLimit = 50,
): PaginationParams {
  let limit = defaultLimit;
  let offset = 0;

  if (query["limit"] !== undefined) {
    const n = Number(query["limit"]);
    if (!Number.isInteger(n) || n < 1 || n > maxLimit) {
      throw invalidBody(`"limit" must be an integer between 1 and ${maxLimit}.`);
    }
    limit = n;
  }

  if (query["offset"] !== undefined) {
    const n = Number(query["offset"]);
    if (!Number.isInteger(n) || n < 0) {
      throw invalidBody(`"offset" must be a non-negative integer.`);
    }
    offset = n;
  }

  return { limit, offset };
}
