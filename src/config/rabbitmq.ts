import amqp, { Channel, ChannelModel } from "amqplib";
import { getLogger } from "@computebay/observability";

const logger = getLogger();

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

const EXCHANGE_NAME = "compute-bay.jobs";
const EXCHANGE_TYPE = "topic";

export async function connectRabbitMQ() {
  if (connection) return;

  const url = Bun.env.RABBITMQ_URL;
  if (!url) {
    throw new Error("RABBITMQ_URL not defined");
  }

  connection = await amqp.connect(url);

  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
    durable: true,
  });

  logger.info("RabbitMQ connected");
}

export function getChannel(): Channel {
  if (!channel) {
    throw new Error("RabbitMQ channel not initialized");
  }
  return channel;
}

export function getExchangeName() {
  return EXCHANGE_NAME;
}
