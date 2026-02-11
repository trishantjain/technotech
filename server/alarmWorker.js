const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function startWorker() {
    const connection = await amqp.connect(process.env.RABBIT_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue("alarm.queue", { durable: true });

    console.log("🚀 Alarm Worker started");

    channel.consume("alarm.queue", async (msg) => {
        try {
            const data = JSON.parse(msg.content.toString());

            const macDir = data.mac.replace(/[:. ]/g, "_");
            const deviceAlarmDir = path.join(process.env.ALARM_LOG_DIR, macDir);
            fs.mkdirSync(deviceAlarmDir, { recursive: true });

            const now = new Date();
            const fileName = `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}_Alarm.inc`;

            let logLine = data.fanStatus.includes(2) ?
                `[${now.toLocaleString()}] | MAC: ${data.mac} | ${data.alarms} | Fans: ${data.fanStatus}` :
                `[${now.toLocaleString()}] | MAC: ${data.mac} | ${data.alarms}`;

            fs.appendFileSync(
                path.join(deviceAlarmDir, fileName),
                logLine + "\n"
            );

            channel.ack(msg);

        } catch (err) {
            console.error("Worker error:", err);
        }
    });
}

startWorker();
