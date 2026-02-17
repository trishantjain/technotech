const amqp = require("amqplib");

let channel;
let connection;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectRabbit() {
    while (true) {
        try {
            connection = await amqp.connect(process.env.RABBIT_URL);

            connection.on("close", () => {
                console.error("❌ RabbitMQ connection closed. Reconnecting...");
                channel = undefined;
                setTimeout(connectRabbit, 5000);
            });

            connection.on("error", (err) => {
                console.error("RabbitMQ connection error:", err.message);
            });

            channel = await connection.createChannel();

            // Alarm Queue
            await channel.assertQueue("alarm.queue", { durable: true });

            // Snapshot job queue
            await channel.assertQueue("snapshot.queue", { durable: true });

            await channel.assertQueue("log.queue", { durable: true });

            // Snapshot completion events (worker -> API for SSE)
            await channel.assertQueue("snapshot.done", { durable: true });

            console.log("🐰 RabbitMQ connected");
            return channel;
        } catch (err) {
            console.error("RabbitMQ connection failed:", err.message);
            await sleep(5000);
        }
    }
}

async function ensureChannelReady() {
    if (channel) return channel;
    await connectRabbit();
    return channel;
}

function publish(queue, data) {
    if (!channel) {
        console.error("Channel not ready, message dropped");
        return;
    }

    channel.sendToQueue(
        queue,
        Buffer.from(JSON.stringify(data)),
        { persistent: true }
    );
}


function publishAlarm(data) {
    publish("alarm.queue", data);
}

function publishSnapshot(data) {
    publish("snapshot.queue", data);
}

function publishSnapshotDone(data) {
    publish("snapshot.done", data);
}

function publishLog(data) {
    publish("log.queue", data);
}


async function consume(queue, handler, options = {}) {
    const { prefetch = 10 } = options;
    const ch = await ensureChannelReady();

    await ch.assertQueue(queue, { durable: true });
    ch.prefetch(prefetch);

    ch.consume(queue, async (msg) => {
        if (!msg) return;

        try {
            const data = JSON.parse(msg.content.toString());
            await handler(data, msg);
            ch.ack(msg);
        } catch (err) {
            console.error(`Consumer error on ${queue}:`, err?.message || err);
            try {
                ch.nack(msg, false, true);
            } catch {
                // ignore
            }
        }
    });
}

module.exports = {
    connectRabbit, publishAlarm, publishSnapshot, publishSnapshotDone, publishLog,
    consume
};
