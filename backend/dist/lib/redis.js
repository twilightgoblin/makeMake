"use strict";
// -----------------------------------------------------------------------------
// Makemake — Redis client singletons
//
// Two separate ioredis instances are required for Pub/Sub:
//   - publisher  → used to PUBLISH messages (can also run normal commands)
//   - subscriber → dedicated to SUBSCRIBE; once subscribed a connection can
//                  only run subscribe/unsubscribe/psubscribe/punsubscribe/quit.
//
// Both read REDIS_URL from the environment (default: redis://localhost:6379).
//
// Exported via getters so tests can override or the app can call
// closeRedisConnections() during graceful shutdown.
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPublisher = getPublisher;
exports.getSubscriber = getSubscriber;
exports.getKeyspaceSubscriber = getKeyspaceSubscriber;
exports.closeRedisConnections = closeRedisConnections;
const ioredis_1 = __importDefault(require("ioredis"));
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
function createClient(label) {
    const client = new ioredis_1.default(REDIS_URL, {
        // Reconnect with exponential backoff, cap at 10 s.
        retryStrategy(times) {
            const delay = Math.min(100 * 2 ** times, 10000);
            console.warn(`[redis:${label}] reconnect attempt ${times}, waiting ${delay} ms`);
            return delay;
        },
        lazyConnect: false,
        enableOfflineQueue: true,
    });
    client.on("connect", () => console.log(`[redis:${label}] connected`));
    client.on("error", (err) => console.error(`[redis:${label}] error`, err));
    return client;
}
// Singletons — created once at module load time.
let _publisher = null;
let _subscriber = null;
let _keyspaceSubscriber = null;
function getPublisher() {
    if (!_publisher)
        _publisher = createClient("pub");
    return _publisher;
}
function getSubscriber() {
    if (!_subscriber)
        _subscriber = createClient("sub");
    return _subscriber;
}
/** Dedicated connection for keyspace notifications (separate from room-events Pub/Sub). */
function getKeyspaceSubscriber() {
    if (!_keyspaceSubscriber)
        _keyspaceSubscriber = createClient("ks");
    return _keyspaceSubscriber;
}
async function closeRedisConnections() {
    await Promise.all([
        _publisher?.quit(),
        _subscriber?.quit(),
        _keyspaceSubscriber?.quit(),
    ]);
    _publisher = null;
    _subscriber = null;
    _keyspaceSubscriber = null;
}
//# sourceMappingURL=redis.js.map