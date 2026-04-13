require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env")
});
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


// HiFocus Capture
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

// Sparsh Capture
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
 *
 * @param {string} ip - IP address of the camera
 * @param {string} outputPath - Path where the captured image will be saved
 *
 * Workflow:
 * 1. Resolve executable path and timeout
 * 2. Prepare arguments (default or via env override)
 * 3. Spawn child process to run the executable
 * 4. Handle errors, timeout, and exit code
 * 5. Validate output file exists and is not empty
 */
// Techno Camera
async function captureTechno(ip, outputPath) {
    // Resolve path to ReadImage executable (from env or default location)
    const exePath = process.env.READIMAGE_EXE_PATH || path.join(__dirname, "ReadImage.exe");

    // Resolve path to ReadImage executable (from env or default location)
    const timeoutMs = Number.parseInt(process.env.READIMAGE_TIMEOUT_MS || "20000", 10);

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
    let args = [String(ip), String(outputPath)];
    if (process.env.READIMAGE_ARGS_JSON) {
        try {
            const parsed = JSON.parse(process.env.READIMAGE_ARGS_JSON);

            // Ensure it is an array
            if (!Array.isArray(parsed)) throw new Error("READIMAGE_ARGS_JSON must be a JSON array");

            // Replace placeholders with actual values
            args = parsed.map((a) =>
                String(a).replaceAll("{ip}",
                    String(ip)).replaceAll("{out}",
                        String(outputPath)));
        } catch (e) {
            throw new Error(`Invalid READIMAGE_ARGS_JSON: ${e.message}`);
        }
    }

    /**
     * Execute the external process using child_process.spawn
     * - Captures stderr for debugging
     * - Handles timeout
     * - Resolves on success (exit code 0)
     * - Rejects on failure
     */
    await new Promise((resolve, reject) => {

        const child = spawn(exePath, args, {
            windowsHide: true,  // Hide console window on Windows
            stdio: ["ignore", "pipe", "pipe"]   // Ignore stdin, capture stdout/stder
        });

        let stderr = "";
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
            reject(new Error(`ReadImage timed out after ${timeoutMs}ms`));
        }, Number.isFinite(timeoutMs) ? timeoutMs : 20000);


        // Process completion handler
        child.on("close", (code) => {
            clearTimeout(timer);

            // Success
            if (code === 0) return resolve();

            // Failure with exit code and optional stderr
            reject(new Error(`ReadImage exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
        });
    });

     /**
     * Validate output file
     * - Must exist
     * - Must not be empty
     */
    let stat;
    try {
        stat = fs.statSync(outputPath);
    } catch {
        throw new Error(`ReadImage completed but output file was not created: ${outputPath}`);
    }

    // Ensure file is valid
    if (!stat.isFile() || stat.size === 0) {
        throw new Error(`ReadImage output file is empty or invalid: ${outputPath}`);
    }

    // 🔥 VALIDATE IMAGE
    const isValid = await validateImage(outputPath);

    if (!isValid) {
        throw new Error("Corrupted image detected by sharp");
    }

    const fileCheck = await imageSizeCheck(outputPath);

    if (fileCheck.fileSize.kb < 50) {
        throw new Error("Invalid Image | Size is less than 50kb");
    }
}




async function startWorker() {
    const rabbitUrl = process.env.RABBIT_URL;
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

        const mac = data?.mac;
        const cameraType = data?.cameraType;
        const cameraIP = data?.cameraIP;

        console.log(mac, cameraIP, cameraType);

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

            console.log("snapshot request came :", mac)

            if (make === "T") {
                console.log("⏰ Snapshot for Techno Camera ⏰", mac);
                await captureTechno(String(cameraIP).trim(), snapshotOutputPath);
            } else if (make === "S") {
                console.log("⏰ Snapshot for Sparsh Camera ⏰", mac);
                // await sleep(Number.isFinite(sparshDelayMs) ? sparshDelayMs : 3000);
                await captureSparsh(String(cameraIP).trim(), snapshotOutputPath);
            } else {
                console.log("⏰ Snapshot for Hifocus Camera ⏰", mac);
                // await sleep(Number.isFinite(sparshDelayMs) ? sparshDelayMs : 3000);
                await captureHiFocus(String(cameraIP).trim(), snapshotOutputPath);
            }

            const isValid = await validateImage(snapshotOutputPath);
            if (!isValid) {
                throw new Error("Corrupted image detected by sharp");
            }

            // await captureTechno(String(cameraIP).trim(), snapshotOutputPath);


            console.log("sending to done queue", mac)
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

}

startWorker();
