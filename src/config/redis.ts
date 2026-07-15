import Redis from "ioredis";
import { config } from "./config";
import { getLogger } from "@computebay/observability";

const logger = getLogger();

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

export function getRedisPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    });

    publisher.on("error", (err) => {
      logger.error({ error: err.message }, "Redis publisher error");
    });

    publisher.on("connect", () => {
      logger.info("Redis publisher connected");
    });
  }
  return publisher;
}

export function getRedisSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    });

    subscriber.on("error", (err) => {
      logger.error({ error: err.message }, "Redis subscriber error");
    });

    subscriber.on("connect", () => {
      logger.info("Redis subscriber connected");
    });
  }
  return subscriber;
}

export function getLogChannel(jobId: string): string {
  return `job:${jobId}:logs`;
}
