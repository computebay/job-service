import { getChannel, connectRabbitMQ, getExchangeName } from '@/config/rabbitmq';
import prisma from '@/config/db';
import { JobStatus } from '@prisma/client';
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

                // Extract the event type from routing key (job.scheduled.nodeId -> scheduled)
                const eventType = routingKey.split('.')[1];

                switch (eventType) {
                    case 'created':
                        // Handle job creation event
                        logger.info({ jobId: data.jobId }, 'Job created event received');
                        // Add your logic here
                        break;

                    case 'scheduled':
                        // Update job state to scheduled
                        if (typeof data.jobId === 'string') {
                            await prisma.job.update({
                                where: { id: data.jobId },
                                data: { 
                                    status: JobStatus.SCHEDULED,
                                    scheduledAt: data.scheduledAt 
                                        ? new Date(data.scheduledAt as number) 
                                        : new Date()
                                }
                            });
                            logger.info({ 
                                jobId: data.jobId, 
                                nodeId: data.nodeId 
                            }, 'Job marked as scheduled');
                        }
                        break;

                    case 'running':
                        // Handle job running state
                        if (typeof data.jobId === 'string') {
                            await prisma.job.update({
                                where: { id: data.jobId },
                                data: { 
                                    status: JobStatus.RUNNING,
                                    startedAt: new Date()
                                }
                            });
                            logger.info({ jobId: data.jobId }, 'Job started running');
                        }
                        break;

                    case 'completed':
                        // Handle job completion
                        if (typeof data.jobId === 'string') {
                            await prisma.job.update({
                                where: { id: data.jobId },
                                data: { 
                                    status: JobStatus.COMPLETED,
                                    completedAt: new Date()
                                }
                            });
                            logger.info({ jobId: data.jobId }, 'Job marked as completed');
                        }
                        break;

                    case 'failed':
                        // Handle job failure
                        if (typeof data.jobId === 'string') {
                            await prisma.job.update({
                                where: { id: data.jobId },
                                data: { 
                                    status: JobStatus.FAILED,
                                    error: data.error as string || 'Unknown error',
                                    failedAt: new Date()
                                }
                            });
                            logger.error({ jobId: data.jobId, error: data.error }, 'Job failed');
                        }
                        break;

                    case 'cancelled':
                        // Handle job cancellation
                        if (typeof data.jobId === 'string') {
                            await prisma.job.update({
                                where: { id: data.jobId },
                                data: { 
                                    status: JobStatus.CANCELLED,
                                    cancelledAt: new Date()
                                }
                            });
                            logger.info({ jobId: data.jobId }, 'Job cancelled');
                        }
                        break;

                    default:
                        logger.warn({ routingKey, eventType }, 'Unknown event type');
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