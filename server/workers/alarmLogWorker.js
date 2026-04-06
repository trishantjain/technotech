require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env")
});
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");

async function startWorker() {
    const connection = await amqp.connect(process.env.RABBIT_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue("alarm.result.queue", { durable: true });

    console.log("🚀 Alarm Worker started");

    channel.consume("alarm.result.queue", async (msg) => {
        if (!msg) return;

        try {
            const data = JSON.parse(msg.content.toString());

            const { mac, alarms, fanStatus } = data;
            const baseDir = process.env.ALARM_LOG_DIR;

            if (!mac || !baseDir) {
                console.error("Invalid alarm message:", data);
                channel.ack(msg);
                return;
            }

            const macDir = mac.replace(/[:. ]/g, "_");
            const deviceAlarmDir = path.join(baseDir, macDir);
            fs.mkdirSync(deviceAlarmDir, { recursive: true });

            const now = new Date();
            const fileName = `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}_Alarm.inc`;

            let logLine;

            if (Array.isArray(fanStatus) && fanStatus.includes(2)) {
                logLine =
                    `[${now.toLocaleString()}] | MAC: ${mac} | ${alarms} | Fans: ${fanStatus}`;
            } else {
                logLine =
                    `[${now.toLocaleString()}] | MAC: ${mac} | ${alarms}`;
            }

            fs.appendFileSync(
                path.join(deviceAlarmDir, fileName),
                logLine + "\n"
            );

            channel.ack(msg);

        } catch (err) {
            console.error("Worker error:", err);
            channel.nack(msg, false, true); // requeue message
        }
    });
}

startWorker();
