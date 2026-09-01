"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
const redis_js_1 = require("./redis.js");
/**
 * Checks a fixed-window rate limit using Redis.
 *
 * @param key The unique key for the rate limit (e.g. "rate-limit:ip:127.0.0.1")
 * @param limit The maximum number of requests allowed in the window
 * @param windowMs The duration of the window in milliseconds
 * @returns true if the request is allowed, false if it should be rejected (rate limited)
 */
async function checkRateLimit(key, limit, windowMs) {
    const redis = (0, redis_js_1.getPublisher)();
    // We increment the counter. If it's 1, we set the TTL.
    // Using a pipeline ensures we send both commands in one batch.
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.pttl(key);
    const results = await pipeline.exec();
    if (!results) {
        throw new Error("Redis pipeline execution failed");
    }
    const [incrResult, pttlResult] = results;
    if (incrResult[0])
        throw incrResult[0];
    if (pttlResult[0])
        throw pttlResult[0];
    const count = incrResult[1];
    const ttl = pttlResult[1];
    if (count === 1 || ttl === -1) {
        // If it's a new key, or somehow missing TTL, set it.
        // Setting it outside the pipeline is a small race condition, but fine for V1.
        // Actually, setting it in pipeline is better but we don't know count before.
        await redis.pexpire(key, windowMs);
    }
    return count <= limit;
}
//# sourceMappingURL=rateLimit.js.map