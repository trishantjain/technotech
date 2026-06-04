require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env")
});
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");

const RECONNECT_DELAY_MS = 5000;
let restarting = false;

function scheduleRestart(reason) {
    if (restarting) return;

    restarting = true;
    console.error(`RabbitMQ worker disconnected: ${reason}. Restarting in ${RECONNECT_DELAY_MS / 1000}s...`);

    setTimeout(() => {
        restarting = false;
        startWorker().catch((err) => {
            console.error("Worker restart failed:", err.message);
            scheduleRestart(err.message);
        });
    }, RECONNECT_DELAY_MS);
}

async function startWorker() {
    let connection;

    try {
        connection = await amqp.connect(process.env.RABBIT_URL);
        const channel = await connection.createChannel();

        connection.on("error", (err) => {
            console.error("RabbitMQ connection error:", err.message);
        });

        connection.on("close", () => {
            scheduleRestart("connection closed");
        });

        channel.on("error", (err) => {
            console.error("RabbitMQ channel error:", err.message);
        });

        channel.on("close", () => {
            scheduleRestart("channel closed");
        });

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
    } catch (err) {
        console.error("Worker failed to start:", err.message);

        try {
            await connection?.close();
        } catch {
            // ignore
        }

        scheduleRestart(err.message);
    }
}

startWorker();