require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env")
});
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");
const { parseDumpPacket } = require("./parsers/dumpPacketParser.js");

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
        await channel.assertQueue("snapshot.queue", {
            durable: true
        });

        console.log("📝 Log Worker started");

        channel.consume("log.queue", async (msg) => {
            if (!msg) return;

            try {
                // Fetching data
                const data = JSON.parse(msg.content.toString());

                let baseDir;

                if (
                    data.type === "inc" ||
                    data.type === "dump"
                ) {
                    baseDir = process.env.INC_LOG_DIR;
                } else {
                    baseDir = process.env.OUT_LOG_DIR;
                }

                if (!baseDir) {
                    console.error("Log directory not configured");
                    channel.ack(msg);
                    return;
                }

                // ----------------------------------------
                // Device directory
                // ----------------------------------------
                const macDir = String(data.ip).replace(/[:. ]/g, "_");
                const deviceDir = path.join(baseDir, macDir);

                fs.mkdirSync(deviceDir, { recursive: true });


                // ----------------------------------------
                // Log directory
                // ----------------------------------------
                let logDir = deviceDir;

                if (data.type === "dump") {
                    logDir = path.join(deviceDir, "backup alarms");

                    if (!fs.existsSync(logDir)) {
                        fs.mkdirSync(logDir, { recursive: true });

                        console.log(
                            `📁 [DUMP] Backup alarm folder created: ${logDir}`
                        );
                    }
                }

                // console.log("Dump Device Dir created")
                const now = new Date();

                let fileName;

                if (data.type === "inc") {
                    fileName =
                        `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}.inc`;
                } else if (data.type === "dump") {
                    fileName =
                        `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}.dump`;
                } else {
                    fileName =
                        `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}.out`;
                }

                const filePath = path.join(logDir, fileName);

                const fileExists = fs.existsSync(filePath);

                let logLine;

                if (data.type === "inc") {
                    logLine = `[${now.toLocaleString()}] | 
                    IP:${data.ip} | 
                    Humid=${data.humidity} | 
                    IT=${data.insideTemperature} | 
                    OT=${data.outsideTemperature} | 
                    IV=${data.inputVoltage} | 
                    OV=${data.outputVoltage} | 
                    BB=${data.batteryBackup}`;
                }

                // ==================================================
                // DUMP LOG
                // ==================================================
                else if (data.type === "dump") {
                    const parsed = parseDumpPacket(data.packet);

                    // ----------------------------------------
                    // Invalid packet
                    // ----------------------------------------
                    if (!parsed.success) {
                        console.error(
                            `🚫 [DUMP] Invalid dump packet from ${data.ip}:`,
                            parsed.error
                        );

                        logLine =
                            `[${now.toLocaleString()}] | IP:${data.ip} | ${parsed.raw}`;
                    } else {

                        // ----------------------------------------
                        // Camera request
                        // ----------------------------------------
                        if (parsed.hasCamera) {

                            console.log(
                                `📷 [DUMP] CAMR value received: ${parsed.cameraId}`
                            );

                            console.log(
                                "📤 [DUMP → SNAPSHOT] Sending:",
                                {
                                    cameraId: parsed.cameraId,
                                    eventDate: parsed.formattedDate,
                                    eventTime: parsed.eventTime,
                                    cameraIP: data.ip
                                }
                            );

                            channel.sendToQueue(
                                "snapshot.queue",
                                Buffer.from(
                                    JSON.stringify({
                                        type: "dump",
                                        ip: data.ip,
                                        cameraIP: data.ip,
                                        cameraType: "T",
                                        cameraId: parsed.cameraId,

                                        // Timestamp from the actual dump event
                                        eventDate: parsed.formattedDate,
                                        eventTime: parsed.eventTime
                                    })
                                ),
                                {
                                    persistent: true
                                }
                            );

                            console.log(
                                `📤 [DUMP] Snapshot request sent`,
                                {
                                    IP: data.ip,
                                    CameraID: parsed.cameraId,
                                    EventDate: parsed.formattedDate,
                                    EventTime: parsed.eventTime
                                }
                            );
                        }

                        // ----------------------------------------
                        // Log cleaned dump packet
                        // ----------------------------------------
                        logLine =
                            `[${now.toLocaleString()}] | IP:${data.ip} | ${parsed.parsedPacket}`;
                    }
                } else {
                    logLine = `[${now.toLocaleString()}] | IP:${data.ip} | ${data.status} | COMMAND:"${data.command}" | MESSAGE:"${data.message}"`;
                }

                fs.appendFileSync(
                    path.join(logDir, fileName),
                    logLine + "\n"
                );

                if (data.type === "dump") {
                    if (!fileExists) {
                        console.log(
                            `📄 [DUMP] Dump file created: ${filePath}`
                        );
                    } else {
                        console.log(
                            `📝 [DUMP] Dump packet appended to: ${filePath}`
                        );
                    }
                    console.log(
                        `📜 [DUMP] Packet logged for ${data.ip}`
                    );
                }

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