import { Request, Response, NextFunction } from "express";
/**
 * Creates an Express middleware for rate limiting.
 *
 * @param options Options defining the limit, window, and key generator.
 */
export declare function rateLimit(options: {
    limit: number;
    windowMs: number;
    keyGenerator: (req: Request) => string;
}): (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=rateLimit.d.ts.map