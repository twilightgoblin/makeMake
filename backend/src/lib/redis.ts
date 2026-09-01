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

import Redis from "ioredis";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

function createClient(label: string): Redis {
  const client = new Redis(REDIS_URL, {
    // Reconnect with exponential backoff, cap at 10 s.
    retryStrategy(times) {
      const delay = Math.min(100 * 2 ** times, 10_000);
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
let _publisher: Redis | null = null;
let _subscriber: Redis | null = null;

export function getPublisher(): Redis {
  if (!_publisher) _publisher = createClient("pub");
  return _publisher;
}

export function getSubscriber(): Redis {
  if (!_subscriber) _subscriber = createClient("sub");
  return _subscriber;
}

export async function closeRedisConnections(): Promise<void> {
  await Promise.all([_publisher?.quit(), _subscriber?.quit()]);
  _publisher = null;
  _subscriber = null;
}
