// -----------------------------------------------------------------------------
// Makemake — Host-only guard middleware
// Must run AFTER requireParticipant (depends on res.locals.participant).
// Rejects the request with 403 if the participant's role is not HOST.
// -----------------------------------------------------------------------------

import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";
import type { Participant } from "@prisma/client";

export function requireHost(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const participant = res.locals["participant"] as Participant | undefined;

  if (!participant || participant.role !== "HOST") {
    return next(
      new AppError(403, "HOST_ONLY", "Only the room host can perform this action."),
    );
  }

  next();
}
