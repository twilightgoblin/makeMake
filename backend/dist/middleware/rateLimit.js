"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimit = rateLimit;
const rateLimit_js_1 = require("../lib/rateLimit.js");
const errors_js_1 = require("../lib/errors.js");
/**
 * Creates an Express middleware for rate limiting.
 *
 * @param options Options defining the limit, window, and key generator.
 */
function rateLimit(options) {
    return async (req, res, next) => {
        try {
            const key = options.keyGenerator(req);
            const allowed = await (0, rateLimit_js_1.checkRateLimit)(key, options.limit, options.windowMs);
            if (!allowed) {
                throw (0, errors_js_1.tooManyRequests)("Too many requests, please try again later.");
            }
            next();
        }
        catch (err) {
            next(err);
        }
    };
}
//# sourceMappingURL=rateLimit.js.map