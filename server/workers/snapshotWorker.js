require("dotenv").config();
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn } = require("child_process");


const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Time function
function getFormattedDateTime() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");

    return `${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${String(d.getFullYear()).slice(-2)}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

// HiFocus Capture
function captureHiFocus(ip, outputPath) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
            "-rtsp_transport", "tcp",
            "-i", `rtsp://${ip}/media/video1`,
            "-frames:v", "1",
            outputPath
        ]);

        ffmpeg.on("close", code => {
            if (code === 0) resolve();
            else reject(new Error("ffmpeg failed"));
        });
    });
}

// Sparsh Capture
async function captureSparsh(ip, outputPath) {
    const response = await axios({
        method: "GET",
        url: `https://${ip}/CGI/command/snap?channel=01`,
        responseType: "stream",
        timeout: 10000
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
    });
}



async function startWorker() {
    const rabbitUrl = process.env.RABBIT_URL;
    console.log(rabbitUrl);
    if (!rabbitUrl) {
        throw new Error("RABBIT_URL is not set");
    }

    const snapshotBaseDir = process.env.SNAP_DIR;
    if (!snapshotBaseDir) {
        throw new Error("SNAP_DIR is not set");
    }

    const sparshDelayMs = Number.parseInt(process.env.SPARSH_SNAPSHOT_DELAY_MS || "3000", 10);

    const connection = await amqp.connect(rabbitUrl);
    const channel = await connection.createChannel();

    await channel.assertQueue("snapshot.queue", { durable: true });
    await channel.assertQueue("snapshot.done", { durable: true });
    channel.prefetch(1);

    console.log("📸 Snapshot Worker started");

    channel.consume("snapshot.queue", async (msg) => {
        if (!msg) return;

        let data;
        try {
            data = JSON.parse(msg.content.toString());
        } catch (err) {
            console.error("Invalid snapshot message (not JSON), dropping:", err.message);
            channel.ack(msg);
            return;
        }

        const mac = data?.mac;
        const cameraType = data?.cameraType;
        const cameraIP = data?.cameraIP;

        if (!mac || !cameraType || !cameraIP) {
            console.error("Invalid snapshot message (missing mac/cameraType/cameraIP), dropping:", data);
            channel.ack(msg);
            return;
        }

        const timestamp = getFormattedDateTime();
        const snapshotFileName = `image_${timestamp}.jpg`;
        const macSuffix = String(mac).slice(8).replace(/[. ]/g, "_");
        const snapshotOutputDirMac = path.join(snapshotBaseDir, macSuffix);
        const snapshotOutputPath = path.join(snapshotOutputDirMac, snapshotFileName);

        try {
            fs.mkdirSync(snapshotOutputDirMac, { recursive: true });

            const make = String(cameraType).trim().toUpperCase();

            if (make === "H") {
                console.log("⏰ Snapshot for HiFocus Camera ⏰", mac);
                await captureHiFocus(String(cameraIP).trim(), snapshotOutputPath);
            } else {
                console.log("⏰ Snapshot for Sparsh Camera ⏰", mac);
                await sleep(Number.isFinite(sparshDelayMs) ? sparshDelayMs : 3000);
                await captureSparsh(String(cameraIP).trim(), snapshotOutputPath);
            }

            channel.sendToQueue(
                "snapshot.done",
                Buffer.from(JSON.stringify({
                    mac,
                    filename: snapshotFileName,
                    createdAt: new Date().toISOString(),
                    source: "camera"
                })),
                { persistent: true }
            );

            channel.ack(msg);
        } catch (err) {
            console.error("Snapshot worker error:", err?.message || err);
            // transient errors (camera offline etc) can be retried
            channel.nack(msg, false, true);
        }
    });
}

startWorker();
