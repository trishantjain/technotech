require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env")
});
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn } = require("child_process");
const sharp = require("sharp");

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

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Time function
function getFormattedDateTime() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");

    return `${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${String(d.getFullYear()).slice(-2)}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

// VALIDATING IMAGE
async function validateImage(filePath) {
    try {
        await sharp(filePath).toBuffer();
        return true;
    } catch (err) {
        return false;
    }
}

// CHECKING IMAGE SIZE [50 KB MINIMUM]
async function imageSizeCheck(filePath) {
    try {
        const stat = fs.statSync(filePath);
        const fileSizeInBytes = stat.size;
        const fileSizeInKB = (fileSizeInBytes / (1024)).toFixed(2);
        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);

        return {
            fileSize: {
                bytes: fileSizeInBytes,
                kb: parseFloat(fileSizeInKB),
                mb: parseFloat(fileSizeInMB)
            }
        }
    } catch (error) {
        console.error('Error extracting image info:', error.message);
        throw error;
    }
}


// HIFOCUS CAPTURE
function captureHiFocus(ip, outputPath) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
            "-rtsp_transport", "tcp",
            // "-i", `rtsp://${ip}/media/video1`,

            // DUMMY IMAGES FOR TESTING
            "-i", `https://picsum.photos/800/600`,
            "-frames:v", "1",
            outputPath
        ]);

        ffmpeg.on("close", code => {
            if (code === 0) resolve();
            else reject(new Error("ffmpeg failed"));
        });
    });
}

// SPARSH CAPTURE
async function captureSparsh(ip, outputPath) {
    const response = await axios({
        method: "GET",
        // url: `https://${ip}/CGI/command/snap?channel=01`,

        // DUMMY IMAGES FOR TESTING
        url: `https://picsum.photos/800/600`,
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


/**
 * Captures an image from a camera using an external executable (ReadImage.exe).
 * @param {string} ip - IP address of the camera
 * @param {string} outputPath - Path where the captured image will be saved
 * @param {number|string} cameraId - Camera ID passed to ReadImage.exe
 **
 * Workflow:
 * 1. Resolve executable path and timeout
 * 2. Prepare arguments (default or via env override)
 * 3. Spawn child process to run the executable
 * 4. Handle errors, timeout, and exit code
 * 5. Validate output file exists and is not empty
 */
// Techno Camera
async function captureTechno(ip, outputPath, cameraId = null) {
    // RESOLVING PATH FOR EXE FILE
    // const exePath = process.env.READIMAGE_EXE_PATH || path.join(__dirname, "ReadImage.exe");
    const exePath = process.env.READIMAGE_EXE_PATH || path.join(__dirname, "ReadImage_recovered_6.exe");


    // HANDLING EXE FILE READ TIMEOUT
    const timeoutMs = Number.parseInt(process.env.READIMAGE_TIMEOUT_MS || "45000", 10);

    if (!fs.existsSync(exePath)) {
        throw new Error(`ReadImage executable not found at: ${exePath}`);
    }

    /**
     * Prepare arguments for the executable
     * Default format:
     *   ReadImage.exe <cameraIp> <outputPath>
     *
     * Can be overridden using environment variable:
     *   READIMAGE_ARGS_JSON
     * Example:
     *   ["--ip","{ip}","--out","{out}"]
     */
    let args = [
        String(ip),
        String(outputPath)
    ];

    if (cameraId !== null && cameraId !== undefined) {
        args.push(String(cameraId));
    }

    if (process.env.READIMAGE_ARGS_JSON) {
        try {
            const parsed = JSON.parse(process.env.READIMAGE_ARGS_JSON);

            // Ensure it is an array
            if (!Array.isArray(parsed)) throw new Error("READIMAGE_ARGS_JSON must be a JSON array");

            // Replace placeholders with actual values
            // args = parsed.map((a) =>
            //     String(a).replaceAll("{ip}",
            //         String(ip)).replaceAll("{out}",
            //             String(outputPath)));

            args = parsed.map((a) =>
                String(a)
                    .replaceAll("{ip}", String(ip))
                    .replaceAll("{out}", String(outputPath))
                    .replaceAll("{cameraId}", String(cameraId))
            );
        } catch (e) {
            throw new Error(`Invalid READIMAGE_ARGS_JSON: ${e.message}`);
        }
    }


    await new Promise((resolve, reject) => {

        const child = spawn(exePath, args, {
            windowsHide: true,  // Hide console window on Windows
            stdio: ["ignore", "pipe", "pipe"]   // Ignore stdin, capture stdout/stder
        });

        let stderr = "";
        let stdout = "";

        child.stdout.on("data", (d) => {
            const text = d.toString();
            stdout += text;

            console.log(`[ReadImage] ${text.trim()}`);
        });

        child.stderr.on("data", (d) => {
            stderr += d.toString();
        });

        // Handle spawn errors
        child.on("error", (err) => {
            reject(err);
        });

        // Timeout handling
        const timer = setTimeout(() => {
            try { child.kill(); } catch { /* ignore */ }
            reject(new Error(`ReadImage timed out after ${timeoutMs}ms (exe=${exePath}, ip=${ip}, out=${outputPath})`));
        }, Number.isFinite(timeoutMs) ? timeoutMs : 45000);


        // Process completion handler
        child.on("close", (code) => {
            clearTimeout(timer);

            if (code === 0) {
                return resolve();
            }

            reject(
                new Error(
                    `ReadImage exited with code ${code}\n` +
                    `STDOUT:\n${stdout}\n` +
                    `STDERR:\n${stderr}`
                )
            );
        });
    });

    let actualOutputPath = outputPath;

    if (cameraId !== null && cameraId !== undefined) {
        actualOutputPath = path.join(
            path.dirname(outputPath),
            `${cameraId}_${path.basename(outputPath)}`
        );
    }

    /**
    * Validate output file
    *   - Must exist
    *   - Must not be empty
    */
    let stat;
    try {
        stat = fs.statSync(actualOutputPath);

    } catch {
        throw new Error(`ReadImage completed but output file was not created: ${actualOutputPath}`);
    }

    // Ensure file is valid
    if (!stat.isFile() || stat.size === 0) {
        throw new Error(`ReadImage output file is empty or invalid: ${actualOutputPath}`);
    }

    return actualOutputPath;

    // 🔥 VALIDATE IMAGE
    // const isValid = await validateImage(outputPath);

    // if (!isValid) {
    //     throw new Error("Corrupted image detected by sharp");
    // }

    // const fileCheck = await imageSizeCheck(outputPath);

    // if (fileCheck.fileSize.kb < 50) {
    //     throw new Error("Invalid Image | Size is less than 50kb");
    // }
}





async function startWorker() {
    let connection;

    try {
        const rabbitUrl = process.env.RABBIT_URL;
        if (!rabbitUrl) {
            throw new Error("RABBIT_URL is not set");
        }

        const snapshotBaseDir = process.env.SNAP_DIR;
        if (!snapshotBaseDir) {
            throw new Error("SNAP_DIR is not set");
        }

        const sparshDelayMs = Number.parseInt(process.env.SPARSH_SNAPSHOT_DELAY_MS || "3000", 10);

        connection = await amqp.connect(rabbitUrl);
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


        // await channel.assertQueue("snapshot.queue", {
        //     durable: true,
        //     arguments: {
        //         "x-dead-letter-exchange": "",
        //         "x-dead-letter-routing-key": "snapshot.dead"
        //     }
        // });

        await channel.assertQueue("snapshot.queue", { durable: true });
        await channel.assertQueue("snapshot.done", { durable: true });
        channel.prefetch(50);

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

            const ip = data?.ip;
            const cameraType = data?.cameraType;
            const cameraIP = data?.cameraIP;
            const cameraId = data?.cameraId;

            console.log(ip, cameraIP, cameraType, cameraId);

            if (!ip || !cameraIP) {
                console.error("Invalid snapshot message (missing ip/cameraIP), dropping:", data);
                channel.ack(msg);
                return;
            }

            // if (make === "T") {
            //     console.log(
            //         "⏰ Snapshot for Techno Camera ⏰",
            //         ip,
            //         "CameraID:",
            //         cameraId ?? "not provided"
            //     );

            //     snapshotOutputPath = await captureTechno(
            //         String(cameraIP).trim(),
            //         snapshotOutputPath,
            //         cameraId
            //     );
            // }

            // console.log("========================================");
            // console.log("🕒 SNAPSHOT TIMESTAMP DEBUG");
            // console.log("Source Type :", data.type);
            // console.log("Event Date  :", data.eventDate ?? "NOT PROVIDED");
            // console.log("Event Time  :", data.eventTime ?? "NOT PROVIDED");
            // console.log("Camera ID   :", cameraId ?? "NOT PROVIDED");
            // console.log("========================================");

            let timestamp;

            if (
                data.type === "dump" &&
                data.eventDate &&
                data.eventTime
            ) {
                const eventDate =
                    String(data.eventDate).replace(/\//g, "_");

                const eventTime =
                    String(data.eventTime).replace(/:/g, "_");

                timestamp =
                    `${eventDate}_${eventTime}`;
            } else {
                timestamp = getFormattedDateTime();
            }

            const snapshotFileName = `image_${timestamp}.jpg`;

            console.log(
                "📸 Generated Snapshot Filename:",
                snapshotFileName
            );

            // const macSuffix = String(ip).slice(8).replace(/[. ]/g, "_");
            const ipSuffix = String(ip).slice(8).replace(/[. ]/g, "_");
            const snapshotOutputDirMac = path.join(
                snapshotBaseDir,
                ipSuffix
            );
            // const snapshotOutputPath = path.join(snapshotOutputDirMac, snapshotFileName);

            const isBackupSnapshot = data.type === "dump";

            fs.mkdirSync(snapshotOutputDirMac, { recursive: true });

            const captureOutputPath = path.join(
                snapshotOutputDirMac,
                snapshotFileName
            );

            // Final directory for the image
            const snapshotDir = isBackupSnapshot
                ? path.join(snapshotOutputDirMac, "backup images")
                : snapshotOutputDirMac;

            if (isBackupSnapshot) {
                fs.mkdirSync(snapshotDir, { recursive: true });

                console.log(
                    `📦 [BACKUP] Dump snapshot directory: ${snapshotDir}`
                );
            }

            let snapshotOutputPath = isBackupSnapshot
                ? path.join(snapshotDir, snapshotFileName)
                : captureOutputPath;

            try {

                // fs.mkdirSync(snapshotOutputDirMac, { recursive: true });

                const make = String(cameraType).trim().toUpperCase();

                console.log("snapshot request came :", ip)

                let actualSnapshotPath = snapshotOutputPath;

                if (make === "H") {
                    console.log("⏰ Snapshot for Hi-Focus Camera ⏰", ip);
                    await captureHiFocus(
                        String(cameraIP).trim(),
                        snapshotOutputPath
                    );
                } else if (make === "S") {
                    console.log("⏰ Snapshot for Sparsh Camera ⏰", ip);
                    // await sleep(Number.isFinite(sparshDelayMs) ? sparshDelayMs : 3000);
                    await captureSparsh(
                        String(cameraIP).trim(),
                        snapshotOutputPath
                    );
                } else {

                    console.log("========================================");
                    console.log("🔍 SNAPSHOT DEBUG");
                    console.log("Source Type     :", data.type);
                    console.log("MAC             :", ip);
                    console.log("Is Backup       :", isBackupSnapshot);
                    console.log("Output Path     :", snapshotOutputPath);
                    console.log("Expected Exists :", fs.existsSync(path.dirname(snapshotOutputPath)));
                    console.log("========================================");

                    console.log("⏰ Snapshot for Techno Camera ⏰", ip);
                    // await sleep(Number.isFinite(sparshDelayMs) ? sparshDelayMs : 3000);
                    actualSnapshotPath = await captureTechno(
                        String(cameraIP).trim(),
                        snapshotOutputPath,
                        cameraId
                    );
                    console.log("========================================");
                    console.log("✅ READIMAGE COMPLETED");
                    console.log("Actual Output   :", actualSnapshotPath);
                    console.log("File Exists     :", fs.existsSync(actualSnapshotPath));

                    if (fs.existsSync(actualSnapshotPath)) {
                        console.log(
                            "File Size       :",
                            fs.statSync(actualSnapshotPath).size,
                            "bytes"
                        );
                    }
                    console.log("========================================");
                }

                const isValid = await validateImage(actualSnapshotPath);
                if (!isValid) {
                    throw new Error("Corrupted image detected by sharp");
                }

                // await captureTechno(String(cameraIP).trim(), snapshotOutputPath);

                console.log("sending to done queue", ip)
                channel.sendToQueue(
                    "snapshot.done",
                    Buffer.from(JSON.stringify({
                        ip,
                        filename: path.basename(actualSnapshotPath),
                        path: actualSnapshotPath,
                        createdAt: new Date().toISOString(),
                        source: data.type === "dump" ? "dump" : "camera"
                    })),
                    { persistent: true }
                );

                channel.ack(msg);
            }

            // catch (err) {
            //     console.error("Snapshot worker error:", err?.stack || err);
            //     // transient errors (camera offline etc) can be retried
            //     channel.nack(msg, false, true);    
            // }


            catch (err) {
                console.error("Snapshot worker error:", err?.stack || err);

                const retryCount = data.retryCount || 0;

                // RETRY THE JOB MAXIMUM 3 TIMES
                if (retryCount >= 3) {
                    console.error("Max retries reached → sending to DLQ");

                    channel.nack(msg, false, false); // ❗ goes to DLQ
                } else {
                    console.log(`Retrying... attempt ${retryCount + 1}`);

                    channel.sendToQueue("snapshot.queue",
                        Buffer.from(JSON.stringify({
                            ...data,
                            retryCount: retryCount + 1
                        })),
                        { persistent: true }
                    );

                    // REMOVE OLD MESSAGE
                    channel.ack(msg);
                }
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
