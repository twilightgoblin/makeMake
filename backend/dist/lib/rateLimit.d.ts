/**
 * Checks a fixed-window rate limit using Redis.
 *
 * @param key The unique key for the rate limit (e.g. "rate-limit:ip:127.0.0.1")
 * @param limit The maximum number of requests allowed in the window
 * @param windowMs The duration of the window in milliseconds
 * @returns true if the request is allowed, false if it should be rejected (rate limited)
 */
export declare function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean>;
//# sourceMappingURL=rateLimit.d.ts.map