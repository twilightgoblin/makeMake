import "dotenv/config";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;
console.log("REDIS_URL is:", REDIS_URL);

const redis = new Redis(REDIS_URL as string);

redis.on("connect", () => {
  console.log("Connected successfully!");
  process.exit(0);
});

redis.on("error", (err) => {
  console.error("Connection error:", err);
  process.exit(1);
});
