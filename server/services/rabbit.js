const amqp = require("amqplib");

let channel;
let connection;
let reconnecting = false;

const consumers = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectRabbit() {
    while (true) {
        try {
            connection = await amqp.connect(process.env.RABBIT_URL);

            connection.on("close", () => {
                console.error("❌ RabbitMQ connection closed. Reconnecting...");
                // channel = undefined;
                // setTimeout(connectRabbit, 5000);

                channel = undefined;
                connection = undefined;
                scheduleReconnect();
            });

            connection.on("error", (err) => {
                console.error("RabbitMQ connection error:", err.message);
            });

            channel = await connection.createChannel();

            channel.on("error", (err) => {
                console.error("RabbitMQ channel error:", err.message);
            });

            channel.on("close", () => {
                console.error("RabbitMQ channel closed. Reconnecting...");
                channel = undefined;
                scheduleReconnect();
            });

            await assertQueues(channel);

            console.log("🐰 RabbitMQ connected");

            await restartConsumers();

            return channel;


            // Alarm Queue
            // await channel.assertQueue("alarm.queue", { durable: true });

            //! ADDED FOR DEAD LOCK QUEUE
            // await channel.assertQueue("snapshot.dead", { durable: true });

            // Snapshot job queue
            // await channel.assertQueue("snapshot.queue", { durable: true });

            //! ADDED FOR DEAD LOCK QUEUE
            // await channel.assertQueue("snapshot.queue", {
            //     durable: true,
            //     arguments: {
            //         "x-dead-letter-exchange": "",          // default exchange
            //         "x-dead-letter-routing-key": "snapshot.dead"
            //     }
            // });

            // await channel.assertQueue("log.queue", { durable: true });

            // // Snapshot completion events (worker -> API for SSE)
            // await channel.assertQueue("snapshot.done", { durable: true });

            // await channel.assertQueue("alarm.result.queue", { durable: true });

            // console.log("🐰 RabbitMQ connected");
            // return channel;
        } catch (err) {
            console.error("RabbitMQ connection failed:", err.message);
            await sleep(5000);
        }
    }
}

function scheduleReconnect() {
    if (reconnecting) return;

    reconnecting = true;

    setTimeout(async () => {
        reconnecting = false;
        await connectRabbit();
    }, 5000);
}

async function assertQueues(ch) {
    await ch.assertQueue("alarm.queue", { durable: true });
    await ch.assertQueue("snapshot.queue", { durable: true });
    await ch.assertQueue("log.queue", { durable: true });
    await ch.assertQueue("snapshot.done", { durable: true });
    await ch.assertQueue("alarm.result.queue", { durable: true });
}

async function ensureChannelReady() {
    if (channel) return channel;
    await connectRabbit();
    return channel;
}

async function restartConsumers() {
    for (const consumer of consumers) {
        await startConsumer(consumer);
    }
}


async function publish(queue, data) {
    // if (!channel) {
    //     console.error("Channel not ready, message dropped");
    //     return;
    // }

    // channel.sendToQueue(
    //     queue,
    //     Buffer.from(JSON.stringify(data)),
    //     { persistent: true }
    // );

    try {
        const ch = await ensureChannelReady();

        ch.sendToQueue(
            queue,
            Buffer.from(JSON.stringify(data)),
            { persistent: true }
        );
    } catch (err) {
        console.error(`Failed to publish to ${queue}:`, err.message);
    }

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

function publishAlarmResult(data) {
    publish("alarm.result.queue", data);
}

async function consume(queue, handler, options = {}) {
    const consumer = {
        queue,
        handler,
        options
    };

    consumers.push(consumer);

    await startConsumer(consumer);
}

async function startConsumer({ queue, handler, options }) {
    const { prefetch = 10 } = options;
    const ch = await ensureChannelReady();

    await ch.assertQueue(queue, { durable: true });
    ch.prefetch(prefetch);

    await ch.consume(queue, async (msg) => {
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
                // channel may already be closed
            }
        }
    });
}


module.exports = {
    connectRabbit, publishAlarm, publishSnapshot, publishSnapshotDone, publishLog, publishAlarmResult, consume
};
