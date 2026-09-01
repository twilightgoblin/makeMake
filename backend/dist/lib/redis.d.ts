import Redis from "ioredis";
export declare function getPublisher(): Redis;
export declare function getSubscriber(): Redis;
/** Dedicated connection for keyspace notifications (separate from room-events Pub/Sub). */
export declare function getKeyspaceSubscriber(): Redis;
export declare function closeRedisConnections(): Promise<void>;
//# sourceMappingURL=redis.d.ts.map