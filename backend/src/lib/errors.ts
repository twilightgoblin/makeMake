// -----------------------------------------------------------------------------
// Makemake — Shared error types
// All API errors flow through AppError so the error handler can produce a
// consistent { error: { code, message } } response body.
// -----------------------------------------------------------------------------

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ---------------------------------------------------------------------------
// 400
// ---------------------------------------------------------------------------

export const invalidBody = (message: string) =>
  new AppError(400, "INVALID_BODY", message);

export const invalidDisplayName = () =>
  new AppError(
    400,
    "INVALID_DISPLAY_NAME",
    "Display name must be between 1 and 30 characters.",
  );

export const invalidPosition = () =>
  new AppError(400, "INVALID_POSITION", "position must be a non-negative integer.");

// ---------------------------------------------------------------------------
// 403
// ---------------------------------------------------------------------------

export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError(403, "FORBIDDEN", message);

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

export const notFound = (resource: string) =>
  new AppError(404, "NOT_FOUND", `${resource} not found.`);

// ---------------------------------------------------------------------------
// 409
// ---------------------------------------------------------------------------

export const conflict = (code: string, message: string) =>
  new AppError(409, code, message);

// ---------------------------------------------------------------------------
// 422
// ---------------------------------------------------------------------------

export const unprocessable = (code: string, message: string) =>
  new AppError(422, code, message);
