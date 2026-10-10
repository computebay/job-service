import { FastifyReply } from "fastify";
import { getRedisSubscriber, getLogChannel, getRedisPublisher } from "@/config/redis";
import { getLogger } from "@computebay/observability";
import Redis from "ioredis";

const logger = getLogger();

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
  /** Live messages arriving while the backlog replay is in flight. */
  pending: string[];
  replaying: boolean;
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

export function subscribeToJobLogs(jobId: string, reply: FastifyReply): () => void {
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
    pending: [],
    replaying: true,
  };

  if (!activeStreams.has(redisChannel)) {
    activeStreams.set(redisChannel, new Set());

    subscriber.subscribe(redisChannel).then(() => {
      logger.info({ jobId, channel: redisChannel }, "Subscribed to Redis channel");
    }).catch((err) => {
      logger.error({ error: err.message, jobId }, "Failed to subscribe to Redis channel");
    });
  }

  const connections = activeStreams.get(redisChannel)!;
  connections.add(connection);

  // Replay recent history first so late subscribers (page load, refresh,
  // reconnect) don't miss everything emitted before they connected.
  // Live messages arriving mid-replay are buffered and flushed after,
  // so nothing is lost or duplicated at the boundary.
  void (async () => {
    try {
      const pub = getRedisPublisher();
      const backlog = await pub.lrange(`${redisChannel}:backlog`, 0, -1);
      for (const message of backlog) {
        try {
          const data = JSON.parse(message) as { chunk: string; jobId: string };
          const logLine = parseChunkToLogLine(data.chunk);
          if (!logLine.msg) continue;
          connection.reply.raw.write(`data: ${JSON.stringify(logLine)}\n\n`);
        } catch {
          // Connection dead mid-replay — stop silently.
          connection.unsubscribe();
          return;
        }
      }
    } catch (err) {
      logger.error({ error: err, jobId }, "Failed to replay log backlog");
    } finally {
      connection.replaying = false;
      for (const message of connection.pending) {
        writeLiveMessage(connections, message);
      }
      connection.pending = [];
    }
  })();

  return connection.unsubscribe;
}

function writeLiveMessage(connections: Set<LogStreamConnection>, message: string): void {
  try {
    const data = JSON.parse(message) as { chunk: string; jobId: string };
    const logLine = parseChunkToLogLine(data.chunk);
    if (!logLine.msg) return;
    const sseData = `data: ${JSON.stringify(logLine)}\n\n`;

    for (const conn of [...connections]) {
      if (conn.replaying) {
        conn.pending.push(message);
        continue;
      }
      try {
        conn.reply.raw.write(sseData);
      } catch {
        conn.unsubscribe();
      }
    }
  } catch (err) {
    logger.error({ error: err }, "Failed to process Redis message");
  }
}

export function handleRedisMessage(channel: string, message: string): void {
  const connections = activeStreams.get(channel);
  if (!connections || connections.size === 0) return;
  writeLiveMessage(connections, message);
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
