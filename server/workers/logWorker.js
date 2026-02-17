require("dotenv").config();
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");

async function startWorker() {
    const connection = await amqp.connect(process.env.RABBIT_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue("log.queue", { durable: true });

    console.log("📝 Log Worker started");

    channel.consume("log.queue", async (msg) => {
        if (!msg) return;

        try {
            // Fetching data
            const data = JSON.parse(msg.content.toString());

            const baseDir =
                data.type === "inc"
                    ? process.env.INC_LOG_DIR
                    : process.env.OUT_LOG_DIR;

            if (!baseDir) {
                console.error("Log directory not configured");
                channel.ack(msg);
                return;
            }

            const macDir = String(data.mac).replace(/[:. ]/g, "_");
            const deviceDir = path.join(baseDir, macDir);

            fs.mkdirSync(deviceDir, { recursive: true });

            const now = new Date();
            const fileName =
                data.type === "inc"
                    ? `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}.inc`
                    : `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}.out`;

            let logLine;

            if (data.type === "inc") {
                logLine = `[${now.toLocaleString()}] | MAC:${data.mac} | Humid=${data.humidity} | IT=${data.insideTemperature} | OT=${data.outsideTemperature} | IV=${data.inputVoltage} | OV=${data.outputVoltage} | BB=${data.batteryBackup}`;
            } else {
                logLine = `[${now.toLocaleString()}] | MAC:${data.mac} | ${data.status} | COMMAND:"${data.command}" | MESSAGE:"${data.message}"`;
            }

            fs.appendFileSync(path.join(deviceDir, fileName), logLine + "\n");

            channel.ack(msg);
        } catch (err) {
            console.error("Log worker error:", err);
            channel.nack(msg, false, true);
        }
    });
}

startWorker();