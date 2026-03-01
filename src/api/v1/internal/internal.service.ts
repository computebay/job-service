import { connectRabbitMQ, getChannel } from "@/config/rabbitmq";
import prisma from "@/config/db";
import { JobStatus } from "@prisma/client";
import { logger } from "@/libs/logger";

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

    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      try {
        const routingKey = msg.fields.routingKey;
        const data = JSON.parse(msg.content.toString()) as Record<string, unknown>;

        logger.info({ routingKey, data }, "Received event");

        // Handle node registration — bind to the new node's events exchange
        if (routingKey === "node.registered") {
          const { nodeId, eventsExchange } = data as {
            nodeId: string;
            eventsExchange: string;
          };

          await bindNodeExchange(eventsExchange, nodeId);
          channel.ack(msg);
          return;
        }

        // All other messages are job state updates from node.{nodeId}.events exchanges
        const eventType = data.event as string;
        const jobId = data.jobId as string;
        const nodeId = data.nodeId as string;

        if (!jobId || typeof jobId !== "string") {
          logger.warn({ data }, "Missing jobId in event payload");
          channel.ack(msg);
          return;
        }

        const job = await prisma.job.findUnique({ where: { id: jobId } });
        if (!job) {
          logger.warn(
            { jobId, eventType, nodeId },
            "Job not found, skipping state update (stale or orphaned message)",
          );
          channel.ack(msg);
          return;
        }

        switch (eventType) {
          case "job.running":
          case "job.started":
            await prisma.job.update({
              where: { id: jobId },
              data: {
                status: JobStatus.RUNNING,
                startedAt: new Date(),
              },
            });
            logger.info({ jobId }, "Job started running");
            break;

          case "job.completed":
            await prisma.job.update({
              where: { id: jobId },
              data: {
                status: JobStatus.COMPLETED,
                completedAt: new Date(),
              },
            });
            logger.info({ jobId }, "Job marked as completed");
            break;

          case "job.failed":
            await prisma.job.update({
              where: { id: jobId },
              data: {
                status: JobStatus.FAILED,
                error: (data.error as string) || "Unknown error",
                failedAt: new Date(),
              },
            });
            logger.error({ jobId, error: data.error }, "Job failed");
            break;
          
          case "job.log.chunk":
            
            logger.info({ jobId, log: data.chunk }, "Job log chunk");
            break;
          case "job.timeout":
            await prisma.job.update({
              where: { id: jobId },
              data: {
                status: JobStatus.FAILED,
                error: "Job timed out",
                failedAt: new Date(),
              },
            });
            logger.error({ jobId }, "Job timed out");
            break;

          default:
            logger.warn({ eventType, jobId, nodeId }, "Unknown event type");
        }

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