const amqp = require("amqplib");

let channel;

async function connectRabbit() {
    try {
        const connection = await amqp.connect(process.env.RABBIT_URL);
        channel = await connection.createChannel();

        await channel.assertQueue("alarm.queue", {
            durable: true
        });

        console.log("🐰 RabbitMQ connected");
    } catch (err) {
        console.error("RabbitMQ connection failed:", err.message);
    }
}

function publishAlarm(data) {
    if (!channel) {
        console.error("RabbitMQ channel not ready");
        return;
    }

    channel.sendToQueue(
        "alarm.queue",
        Buffer.from(JSON.stringify(data)),
        { persistent: true }
    );
}

module.exports = { connectRabbit, publishAlarm };
