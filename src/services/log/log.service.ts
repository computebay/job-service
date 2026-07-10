import { FastifyReply } from "fastify";
import { getRedisSubscriber, getLogChannel } from "@/config/redis";
import { logger } from "@/libs/logger";
import Redis from "ioredis";

interface LogLine {
  ts: string;
  level: string;
  msg: string;
}

interface LogStreamConnection {
  jobId: string;
  reply: FastifyReply;
  redisChannel: string;
  unsubscribe: () => void;
}

const activeStreams = new Map<string, Set<LogStreamConnection>>();
let globalSubscriber: Redis | null = null;

function getGlobalSubscriber(): Redis {
  if (!globalSubscriber) {
    globalSubscriber = getRedisSubscriber();
  }
  return globalSubscriber;
}

function parseChunkToLogLine(chunk: string): LogLine {
  const lines = chunk.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) {
    return {
      ts: new Date().toISOString(),
      level: "info",
      msg: "",
    };
  }

  const firstLine = lines[0];
  const levelMatch = firstLine.match(/\b(debug|info|warn|error|trace)\b/i);
  const level = levelMatch ? levelMatch[1].toLowerCase() : "info";

  return {
    ts: new Date().toISOString(),
    level,
    msg: lines.join("\n"),
  };
}

export function subscribeToJobLogs(jobId: string, reply: FastifyReply): void {
  const redisChannel = getLogChannel(jobId);
  const subscriber = getGlobalSubscriber();

  const connection: LogStreamConnection = {
    jobId,
    reply,
    redisChannel,
    unsubscribe: () => {
      const connections = activeStreams.get(redisChannel);
      if (connections) {
        connections.delete(connection);
        if (connections.size === 0) {
          activeStreams.delete(redisChannel);
          subscriber.unsubscribe(redisChannel).catch(() => {});
        }
      }
    },
  };

  if (!activeStreams.has(redisChannel)) {
    activeStreams.set(redisChannel, new Set());

    subscriber.subscribe(redisChannel).then(() => {
      logger.info({ jobId, channel: redisChannel }, "Subscribed to Redis channel");
    }).catch((err) => {
      logger.error({ error: err.message, jobId }, "Failed to subscribe to Redis channel");
    });
  }

  activeStreams.get(redisChannel)!.add(connection);
}

export function handleRedisMessage(channel: string, message: string): void {
  const connections = activeStreams.get(channel);
  if (!connections || connections.size === 0) return;

  try {
    const data = JSON.parse(message) as { chunk: string; jobId: string };
    const logLine = parseChunkToLogLine(data.chunk);
    const sseData = `data: ${JSON.stringify(logLine)}\n\n`;

    for (const conn of connections) {
      try {
        conn.reply.raw.write(sseData);
      } catch {
        conn.unsubscribe();
      }
    }
  } catch (err) {
    logger.error({ error: err, channel }, "Failed to process Redis message");
  }
}

export function sendJobCompletion(jobId: string): void {
  const redisChannel = getLogChannel(jobId);
  const connections = activeStreams.get(redisChannel);
  if (!connections) return;

  const doneMessage = `data: ${JSON.stringify({ done: true })}\n\n`;
  for (const conn of connections) {
    try {
      conn.reply.raw.write(doneMessage);
      conn.reply.raw.end();
    } catch {
      // Connection already closed
    }
    conn.unsubscribe();
  }
  activeStreams.delete(redisChannel);
}

export function initializeLogStream(): void {
  const subscriber = getGlobalSubscriber();

  subscriber.on("message", (channel: string, message: string) => {
    handleRedisMessage(channel, message);
  });

  logger.info("Log stream initialized");
}
