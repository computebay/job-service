import { getChannel, connectRabbitMQ } from "@/config/rabbitmq";
import prisma from "@/config/db";
import { JobStatus } from "@prisma/client";
import { logger } from "@/libs/logger";

const QUEUE_NAME = "job-service.events";

// Call this when a new node comes online so we start receiving its events
export const bindNodeExchange = async (nodeId: string) => {
  const channel = getChannel();
  const exchangeName = `node.${nodeId}.events`;

  await channel.assertExchange(exchangeName, "topic", { durable: true });
  await channel.bindQueue(QUEUE_NAME, exchangeName, "#");

  logger.info({ nodeId, exchangeName }, "Bound queue to node exchange");
};

export const UpdateJobState = async (nodeIds: string[] = []) => {
  try {
    await connectRabbitMQ();
    const channel = getChannel();

    await channel.assertQueue(QUEUE_NAME, { durable: true });

    // Bind all known node exchanges at startup
    for (const nodeId of nodeIds) {
      await bindNodeExchange(nodeId);
    }

    logger.info(`Started consuming from queue: ${QUEUE_NAME}`);

    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      try {
        const data = JSON.parse(msg.content.toString()) as Record<string, unknown>;

        const eventType = data.event as string;
        const jobId = data.jobId as string;
        const nodeId = data.nodeId as string;

        logger.info({ eventType, jobId, nodeId }, "Received node event");

        if (!jobId || typeof jobId !== "string") {
          logger.warn({ data }, "Missing jobId in event payload");
          channel.ack(msg);
          return;
        }

        switch (eventType) {
          case "job.running":
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
            logger.warn({ eventType, jobId }, "Unknown event type");
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