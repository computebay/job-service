import { connectRabbitMQ, getChannel } from "@/config/rabbitmq";
import prisma from "@/config/db";
import { JobStatus } from "@prisma/client";
import { getLogger, instrumentedHandler, instrumentedQuery } from "@computebay/observability";
import { getRedisPublisher, getLogChannel } from "@/config/redis";
import { sendJobCompletion } from "@/services/log/log.service";

const logger = getLogger();

const QUEUE_NAME = "job-service.events";
const SCHEDULER_EXCHANGE = "compute-bay.jobs";

const bindNodeExchange = async (eventsExchange: string, nodeId: string) => {
  const channel = getChannel();

  await channel.assertExchange(eventsExchange, "topic", { durable: true });
  await channel.bindQueue(QUEUE_NAME, eventsExchange, "#");

  logger.info({ nodeId, eventsExchange }, "Bound queue to node events exchange");
};

export const UpdateJobState = async () => {
  try {
    await connectRabbitMQ();
    const channel = getChannel();

    // Single queue that fans in from all exchanges
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    // Bind to scheduler exchange to receive node.registered events
    await channel.assertExchange(SCHEDULER_EXCHANGE, "topic", { durable: true });
    await channel.bindQueue(QUEUE_NAME, SCHEDULER_EXCHANGE, "node.registered");

    // Bind to shared node events exchange where workers publish job updates
    await channel.assertExchange("node.events", "topic", { durable: true });
    await channel.bindQueue(QUEUE_NAME, "node.events", "node.#");

    logger.info(`Started consuming from queue: ${QUEUE_NAME}`);

    const rawHandler = async (data: Record<string, unknown>, msg: any) => {
      const routingKey = msg.fields.routingKey;

      // Handle node registration
      if (routingKey === "node.registered") {
        const { nodeId, eventsExchange } = data as {
          nodeId: string;
          eventsExchange: string;
        };
        await bindNodeExchange(eventsExchange, nodeId);
        return;
      }

      const eventType = data.event as string;
      const jobId = data.jobId as string;
      const nodeId = data.nodeId as string;

      if (!jobId || typeof jobId !== "string") {
        logger.warn({ data }, "Missing jobId in event payload");
        return;
      }

      const job = await instrumentedQuery("SELECT", "jobs", "job-service", () =>
        prisma.job.findUnique({ where: { id: jobId } }),
      );

      if (!job) {
        logger.warn(
          { jobId, eventType, nodeId },
          "Job not found, skipping state update (stale or orphaned message)",
        );
        return;
      }

      switch (eventType) {
        case "job.running":
        case "job.started":
        case "service.started":
        case "service.running":
          await instrumentedQuery("UPDATE", "jobs", "job-service", () =>
            prisma.job.update({
              where: { id: jobId },
              data: {
                assignedNodeId: nodeId,
                status: JobStatus.RUNNING,
                startedAt: new Date(),
              },
            }),
          );
          logger.info({ jobId }, "Job started running");
          break;

        case "job.completed":
        case "service.completed":
          await instrumentedQuery("UPDATE", "jobs", "job-service", () =>
            prisma.job.update({
              where: { id: jobId },
              data: {
                status: JobStatus.COMPLETED,
                completedAt: new Date(),
                outputArtifacts: {
                  logs: data.logObjectKey ? { key: data.logObjectKey } : null,
                  stdout: (data.output as string)?.substring(0, 10000) ?? "",
                  exitCode: data.exitCode ?? 0,
                  artifacts: data.artifacts ?? [],
                },
              },
            }),
          );
          sendJobCompletion(jobId);
          logger.info({ jobId }, "Job marked as completed");
          break;

        case "job.failed":
        case "service.failed":
          await instrumentedQuery("UPDATE", "jobs", "job-service", () =>
            prisma.job.update({
              where: { id: jobId },
              data: {
                status: JobStatus.FAILED,
                error: (data.error as string) || "Unknown error",
                outputArtifacts: {
                  logs: data.logObjectKey ? { key: data.logObjectKey } : null,
                  stdout: (data.output as string)?.substring(0, 10000) ?? "",
                  exitCode: data.exitCode ?? 1,
                  artifacts: data.artifacts ?? [],
                },
                failedAt: new Date(),
              },
            }),
          );
          sendJobCompletion(jobId);
          logger.error({ jobId, error: data.error }, "Job failed");
          break;

        case "job.log.chunk":
          try {
            const redis = getRedisPublisher();
            const channel = getLogChannel(jobId);
            const payload = JSON.stringify({ chunk: data.chunk, jobId });
            await redis.publish(channel, payload);
            logger.debug({ jobId }, "Published log chunk to Redis");
          } catch (err) {
            logger.error({ error: err, jobId }, "Failed to publish log chunk to Redis");
          }
          break;

        case "job.timeout":
        case "service.timeout":
          await instrumentedQuery("UPDATE", "jobs", "job-service", () =>
            prisma.job.update({
              where: { id: jobId },
              data: {
                status: JobStatus.FAILED,
                error: "Job timed out",
                failedAt: new Date(),
              },
            }),
          );
          sendJobCompletion(jobId);
          logger.error({ jobId }, "Job timed out");
          break;

        default:
          logger.warn({ eventType, jobId, nodeId }, "Unknown event type");
      }
    };

    const handler = instrumentedHandler(rawHandler, {
      queue: QUEUE_NAME,
      service: "job-service",
    });

    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;
      try {
        await handler(msg);
        channel.ack(msg);
      } catch (error) {
        logger.error(
          { error, msg: msg.content.toString() },
          "Error processing message",
        );
        channel.nack(msg, false, true);
      }
    });
  } catch (error) {
    logger.error({ error }, "Failed to start job consumer");
    throw error;
  }
};
