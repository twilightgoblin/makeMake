import { Request, Response, NextFunction } from "express";
import { checkRateLimit } from "../lib/rateLimit.js";
import { tooManyRequests } from "../lib/errors.js";

/**
 * Creates an Express middleware for rate limiting.
 *
 * @param options Options defining the limit, window, and key generator.
 */
export function rateLimit(options: {
  limit: number;
  windowMs: number;
  keyGenerator: (req: Request) => string;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = options.keyGenerator(req);
      const allowed = await checkRateLimit(key, options.limit, options.windowMs);

      if (!allowed) {
        throw tooManyRequests("Too many requests, please try again later.");
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
