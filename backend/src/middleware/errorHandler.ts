// -----------------------------------------------------------------------------
// Makemake — Global error handler middleware
// Must be registered LAST in Express (4-argument signature).
// Catches AppError instances and unknown errors, always responds with the
// standard shape: { error: { code, message } }
// -----------------------------------------------------------------------------

import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Unknown / unexpected errors — log the details, hide them from the client.
  console.error("[unhandled error]", err);

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
}
