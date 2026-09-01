"use strict";
// -----------------------------------------------------------------------------
// Makemake — Global error handler middleware
// Must be registered LAST in Express (4-argument signature).
// Catches AppError instances and unknown errors, always responds with the
// standard shape: { error: { code, message } }
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const errors_js_1 = require("../lib/errors.js");
function errorHandler(err, _req, res, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
_next) {
    if (err instanceof errors_js_1.AppError) {
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
//# sourceMappingURL=errorHandler.js.map