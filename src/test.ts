import amqp from "amqplib";

if (!Bun.env.RABBITMQ_URL) {
  throw new Error("RABBITMQ_URL environment variable is not defined");
}
const connection = await amqp.connect(Bun.env.RABBITMQ_URL);

const channel = await connection.createChannel();

await channel.assertQueue("test2");

channel.sendToQueue("test", Buffer.from("hello world"));
