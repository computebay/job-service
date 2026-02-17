import { getChannel, connectRabbitMQ, getExchangeName } from '@/config/rabbitmq';
import prisma from '@/config/db';
import { $Enums } from '@/generated/prisma/client';
import { logger } from '@/libs/logger';

const QUEUE_NAME = "job-service.events";

export const UpdateJobState = async () => {
    try {
        // Connect first, then get channel
        await connectRabbitMQ();
        const channel = getChannel();

        // Assert queue before binding
        await channel.assertQueue(QUEUE_NAME, {
            durable: true,
        });

        // Bind queue to exchange with routing pattern
        await channel.bindQueue(QUEUE_NAME, getExchangeName(), "job.#");

        logger.info(`Started consuming from queue: ${QUEUE_NAME}`);

        // Consume messages
        channel.consume(QUEUE_NAME, async (msg) => {
            if (!msg) return;

            try {
                const routingKey = msg.fields.routingKey;
                const data = JSON.parse(msg.content.toString()) as Record<string, unknown>;

                logger.info({ routingKey, data }, 'Received job event');

                switch (routingKey) {
                    case 'job.created':
                        // Handle job creation event
                        logger.info({ jobId: data.jobId }, 'Job created event received');
                        // Add your logic here
                        break;

                    case 'job.scheduled':
                        // Update job state to scheduled
                        if (typeof data.jobId === 'string') {
                            await prisma.job.update({
                                where: { id: data.jobId },
                                data: { 
                                    status: $Enums.JobStatus.SCHEDULED,
                                    scheduledAt: new Date()
                                }
                            });
                            logger.info({ jobId: data.jobId }, 'Job marked as scheduled');
                        }
                        break;

                    case 'job.completed':
                        // Handle job completion
                        if (typeof data.jobId === 'string') {
                            await prisma.job.update({
                                where: { id: data.jobId },
                                data: { 
                                    status: $Enums.JobStatus.COMPLETED,
                                    completedAt: new Date()
                                }
                            });
                            logger.info({ jobId: data.jobId }, 'Job marked as completed');
                        }
                        break;

                    case 'job.failed':
                        // Handle job failure
                        if (typeof data.jobId === 'string') {
                            await prisma.job.update({
                                where: { id: data.jobId },
                                data: { 
                                    status: $Enums.JobStatus.FAILED
                                }
                            });
                            logger.error({ jobId: data.jobId, error: data.error }, 'Job failed');
                        }
                        break;

                    default:
                        logger.warn({ routingKey }, 'Unknown routing key');
                }

                // Acknowledge message after successful processing
                channel.ack(msg);

            } catch (error) {
                logger.error({ error, msg: msg.content.toString() }, 'Error processing message');
                
                // Reject and requeue message on error (or use nack with requeue: false to send to DLQ)
                channel.nack(msg, false, true);
            }
        });

    } catch (error) {
        logger.error({ error }, 'Failed to start job consumer');
        throw error;
    }
};