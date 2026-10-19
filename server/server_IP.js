const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "/.env"),
});
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Device = require("./models/Device");
const net = require("net");
const mongoose = require("mongoose");
const express = require("express");
const bodyParser = require("body-parser");
const SensorReading = require("./models/SensorReading");
const thresholds = require("./thresholds");
const fs = require("fs");
const axios = require("axios");
const { spawn } = require("child_process");
const readline = require("readline");
const {
  connectRabbit,
  publishAlarm,
  publishSnapshot,
  consume,
  publishLog,
  publishAlarmResult,
} = require("./services/rabbit");
const parseQueryDate = require("./alarm/dateParser.js");
const parseIstLogTimestamp = require("./alarm/timestampParser.js");
const parseAlarmLine = require("./alarm/alarmParser.js");
const getAlarmFiles = require("./alarm/fileScanner.js");
const alarmHistoryCache = require("./cache/alarmHistoryCache.js");
const { startStatusMonitor } = require("./workers/statusMonitor.js");
const {
  initializeDeviceStatusCache,
  updateDeviceStatusCache,
  registerDeviceInStatusCache,
} = require("./services/deviceStatusCache");

const { startPingRecordService } = require("./services/pingRecordService");

const logger = require("./logger/logger.js");

const nmsRoutes = require("./routes/nms");

const app = express();
const connectedDevices = new Map();
app.use(bodyParser.json());
const cors = require("cors");
const { authMiddleware } = require("./middleware/middleware");
app.use(cors());

// NMS ROUTE
app.use("/api/nms", nmsRoutes);

const deviceCache = new Map();

// ===================== SSE: Snapshot Notifications =====================
const snapshotSseClients = new Set();

function writeSseEvent(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastSnapshotCaptured(payload) {
  for (const client of snapshotSseClients) {
    try {
      if (client?.ip && client.ip !== String(payload.ip || "")) {
        continue;
      }
      writeSseEvent(client.res, "snapshot", payload);
    } catch (e) {
      snapshotSseClients.delete(client);
      try {
        client?.res?.end();
      } catch {
        // ignore
      }
    }
  }
}

// Client subscribes to receive "snapshot" events
app.get("/api/events/snapshots", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // CORS middleware should handle headers, but SSE benefits from explicit keep-alive
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const ip = req.query.ip ? String(req.query.ip) : "";
  const client = { res, ip };
  snapshotSseClients.add(client);

  // initial event so UI can confirm connection
  writeSseEvent(res, "ready", { ok: true, type: "snapshots", ip });

  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // ignore
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    snapshotSseClients.delete(client);
  });
});

const logStreams = {};

// 🔌 DB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    logger.info("MongoDB connected");

    try {
      // LOAD THE EXISTING CAMERA/DEVICE METADATA CACHE.
      await loadDeviceCache();

      // INITIALIZE IP -> MongoDB DEVICE ID + CURRENT STATUS
      await initializeDeviceStatusCache();

      // START MONITORING AND PERIODIC PING-RECORD CREATION
      startStatusMonitor();
      startPingRecordService();

      logger.info("Device status cache and ping-record service started");
    } catch (err) {
      console.error("Failed to initialize device services:", err);

      logger.error(
        {
          error: err.message,
          stack: err.stack,
        },
        "Failed to initialize device services",
      );
    }
  })

  .catch((err) => {
    console.error("MongoDB connection error:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "MongoDB connection error",
    );
  });

(async () => {
  await connectRabbit();

  // Worker publishes completion events to this queue.
  // We translate those to SSE for the UI.
  await consume(
    "snapshot.done",
    async (payload) => {
      broadcastSnapshotCaptured(payload);
    },
    { prefetch: 50 },
  );
})();

// startStatusMonitor();

app.get("/test-alarm", (req, res) => {
  publishAlarm({
    ip: "TEST_DEVICE",
    alarms: ["Test Alarm Triggered"],
    timestamp: new Date(),
  });

  res.send("Test alarm published");
});

async function loadDeviceCache() {
  try {
    const devices = await Device.find({}, { ip: 1, ipCamera: 1 }).lean();

    devices.forEach((d) => {
      deviceCache.set(d.ip, {
        cameraType: d.ipCamera?.type || null,
        cameraIP: d.ipCamera?.ip || null,
      });
    });

    logger.info(`📦 Device cache loaded: ${deviceCache.size} devices`);
  } catch (err) {
    console.error("Device not loaded:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "Device not loaded",
    );
  }
}

// loadDeviceCache();

// ===================== HTTP API Endpoints (unchanged) =====================
/* When a GET request is made to "/ping", it will attempt to ping the MongoDB database using Mongoose. 
   If the ping is successful, it will respond with "pong". If the ping fails, it will log an error message and
   respond with "MongoDB unreachable" along with a status code of 500. 
*/
app.get("/api/ping", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.send("pong");
  } catch (e) {
    console.error("Ping DB check failed:", e);

    logger.error(
      {
        error: e.message,
        stack: e.stack,
      },
      "Ping DB check failed",
    );

    res.status(500).send("MongoDB unreachable");
  }
});

// ✅ Login route (admin hardcoded via .env)
/* It is checking if the provided username and password in the request body match the admin username and password stored in the
   environment variables. If the credentials match, it generates a JSON Web Token (JWT) with the
   username "admin" and role "admin" and sends it back in the response along with the role "admin". 
*/
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Admin login
    if (
      username === process.env.ADMIN_USERNAME &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const token = jwt.sign(
        { username: "admin", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "2h" },
      );
      return res.json({ role: "admin", token });
    }

    // User login from DB
    const user = await User.findOne({ username: username });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" },
    );

    res.json({ role: user.role, token }); // ✅ return role and token
  } catch (err) {
    console.error("Failed to fetch users:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "Failed to fetch users:",
    );

    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// *====================  USER API  ========================
// ✅ Register new user
app.post("/api/register-user", async (req, res) => {
  const { username, password, role } = req.body;

  if (!["admin", "block", "gp", "user", "field-worker"].includes(role)) {
    return res.status(401).json({ error: "Invalid role" });
  }

  try {
    // Hashing Password with 10 SaltRound
    const hashedPassword = await bcrypt.hash(password, 10); // ✅ hash password

    // Creating new User Object
    const user = new User({
      username: username.toLowerCase(),
      password: hashedPassword,
      role,
    });

    // Saving User in DB
    await user.save();
    res.status(200).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("User registration failed:", error);

    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      "User registration failed",
    );

    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ API to get the list of users
app.get("/api/users", async (req, res) => {
  try {
    // Finding list of users
    const users = await User.find();
    res.json(users);
  } catch (err) {
    console.error("Failed to fetch users:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "Failed to fetch users",
    );
  }
});

// ✅ Edit User
app.put("/api/user/:id", async (req, res) => {
  try {
    const { username, password, role, adminPassword } = req.body;
    if (adminPassword !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    // Finding User from DB with ID came from frontend
    const user = await User.findById(req.params.id);

    // Setting new Details of User in "UpdateField"
    const updateFields = {};
    updateFields.username = username;
    updateFields.role = role;

    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10); // Hashing new Password
      updateFields.password = hashedPassword;
    }

    // Updating User Details
    const updatedDevice = await User.findOneAndUpdate(
      user,
      { $set: updateFields },
      { new: true },
    );

    if (!updatedDevice)
      return res.status(404).json({ error: "User not found" });
    res.json(updatedDevice);
  } catch (error) {
    console.error("Error updating device:", error);

    logger.error(
      {
        error: error.message,
        stack: error.stack,
        ip: req.params.ip,
      },
      "Error updating device",
    );

    res.status(500).json({ error: "Server error while updating device" });
  }
});

// ✅ Delete User
app.delete("/api/user/:username", async (req, res) => {
  try {
    const { adminPassword } = req.body;

    // Comparing Admin Password
    if (adminPassword !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    // Deleting User by Username
    const result = await User.deleteOne({ username: req.params.username });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);

    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      "Error deleting user",
    );

    res.status(500).json({
      error: "Server error while deleting user",
    });
  }
});
// *====================  USER API  ========================

// *====================  DEVICE API  ======================
// ✅ Register new device
app.post("/api/register-device", authMiddleware, async (req, res) => {
  const { ip, deviceName, location, address, latitude, longitude, ipCamera } =
    req.body;

  try {
    // const normalizedMac = ip.toLowerCase(); // Converting to LowerCase()
    let parsedCamera = ipCamera;

    // UNAUTHORIZED ERROR MESSAGE
    if (req.user.role !== "admin" && req.user.role !== "field-worker") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // IP ALREADY EXISTS MESSAGE
    const existingMac = await Device.findOne({ ip });
    if (existingMac) {
      return res.status(409).json({ error: "Device IP already exists" });
    }

    // console.log("Parsed Camera: ", parsedCamera);
    const device = new Device({
      // ip: normalizedr,
      ip,
      deviceName,
      location,
      address,
      latitude,
      longitude,
      status: req.user.role === "admin" ? "approved" : "pending",
      createdBy: req.user.username,
    });

    await device.save();

    // ADDING NEW DEVICE TO PING-RECORD
    registerDeviceInStatusCache(device);

    deviceCache.set(ip, {
      cameraType: parsedCamera?.type || null,
      cameraIP: parsedCamera?.ip || null,
    });

    res.json({ message: "Device registered successfully" });
  } catch (err) {
    console.error("Device registration failed:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        ip: req.body?.ip,
      },
      "Device registration failed",
    );

    res.status(500).json({ error: err });
  }
});

// ✅ Get registered device metadata
app.get("/api/devices-info", async (req, res) => {
  try {
    console.time("deviceInfo");

    const devices = await Device.find({ status: "approved" }).sort({
      locationId: -1,
    }); // includes ipCamera
    /* NEW ADDED */
    const normalizedDevices = devices.map((device) => ({
      ...device._doc,
      // ip: device.ip.toLowerCase() //! Converting to LowerCase()
      ip: device.ip,
    }));
    console.timeEnd("deviceInfo");
    res.json(normalizedDevices);
  } catch (err) {
    console.error("Error fetching devices info:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "Error fetching devices info",
    );

    res.status(500).json({ error: "Error fetching devices" });
  }
});

// ✅ ADMIN DEVICE
app.get("/api/admin/devices", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const devices = await Device.find().sort({ createdAt: -1 });
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// ✅ Get connected IPs
app.get("/api/devices", (req, res) => {
  try {
    res.json(Array.from(connectedDevices.keys()).map((ip) => ip)); //! Converting to LowerCase()
  } catch (err) {
    console.error("Error fetching devices info:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "Error fetching devices info",
    );

    res.status(500).json({ error: "Error fetching devices" });
  }
});

// ✅ Update device by IP
app.put("/api/device/:ip", async (req, res) => {
  try {
    /* NEW ADDED*/
    const ip = req.params.ip; //! Converting to LowerCase()
    const { password, ...updateFields } = req.body;

    if (updateFields.locationId && updateFields.locationId.length > 17)
      return res
        .status(400)
        .json({ error: "Location ID must be 17 characters or fewer" });

    if (password !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    if (updateFields.ipCamera && typeof updateFields.ipCamera === "string") {
      const [camType, camIP] = updateFields.ipCamera.split(",");
      updateFields.ipCamera = {
        type: camType,
        ip: camIP,
      };
    }

    const updatedDevice = await Device.findOneAndUpdate(
      { ip },
      { $set: updateFields },
      { new: true },
    );
    if (!updatedDevice)
      return res.status(404).json({ error: "Device not found" });
    res.json(updatedDevice);
  } catch (error) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
        ip: req.params.ip,
      },
      "Error updating device",
    );
    res.status(500).json({ error: "Server error while updating device" });
  }
});

//! Have to check this API
// ✅ Deleting device by IP
app.post("/api/device/delete/:ip", async (req, res) => {
  const { password } = req.body;

  // Converting MAC to LowerCase()
  const ip = req.params.ip;

  if (password !== process.env.ADMIN_PASSWORD)
    return res
      .status(403)
      .json({ error: "Unauthorized: Invalid admin password" });
  try {
    const result = await Device.deleteOne({ ip: ip });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "Device not found" });
    res.json({ message: "Device deleted successfully" });
  } catch (err) {
    console.error("Error deleting device:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        ip: req.params.ip,
      },
      "Error deleting device",
    );

    res.status(500).json({ error: "Error deleting device" });
  }
});

// ✅ Get only registered MACs
app.get("/api/all-devices", async (req, res) => {
  try {
    console.time("all-devices");
    const devices = await Device.find({}, "ip");

    console.timeEnd("all-devices");

    res.json(devices.map((d) => d.ip)); //! Converting to LowerCase()
  } catch (error) {
    console.error("Error fetching registered devices:", error);

    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      "Error fetching registered devices",
    );

    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// ✅ Get latest reading by MAC
app.get("/api/device/:ip", async (req, res) => {
  try {
    const ip = req.params.ip;
    const device = await Device.findOne({ ip });

    if (!device || device.status !== "approved") {
      return res.status(403).json({ error: "Device not approved" });
    }

    // const normalizedMac = req.params.ip.toLowerCase(); //! Converting to LowerCase()
    const latest = await SensorReading.findOne({ ip }).sort({
      timestamp: -1,
    });
    if (!latest) return res.status(404).json({ message: "No data found" });
    res.json(latest);
  } catch (err) {
    console.error("Error fetching device data:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        ip: req.params.ip,
      },
      "Error fetching device data",
    );

    res.status(500).json({ error: "Failed to fetch reading" });
  }
});

// ✅ APPROVING DEVICE
app.put("/api/device/approve/:ip", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    console.log("Checking admin login");

    const ip = req.params.ip;

    const device = await Device.findOne({ ip });
    if (!device) return res.status(404).json({ error: "Device not found" });

    console.log("Checking device");

    if (device.status === "approved") {
      return res.status(400).json({ error: "Already approved" });
    }

    if (!device.createdBy) {
      device.createdBy = req.user.username;
    }

    console.log("Checking device current status");

    device.status = "approved";
    device.approvedAt = new Date();
    device.approvedBy = req.user.username;

    console.log("Saving device");
    console.log(device);
    await device.save();
    logger.info("Device saved", device);

    res.json(device);
  } catch (err) {
    console.error("Device approval failed:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        ip: req.params.ip,
      },
      "Device approval failed",
    );

    res.status(500).json({ error: "Approve failed" });
  }
});

// ✅ REJECT DEVICE
app.put("/api/device/reject/:ip", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const ip = req.params.ip;

    const device = await Device.findOne({ ip });
    if (!device) return res.status(404).json({ error: "Device not found" });

    if (!device.createdBy) {
      device.createdBy = req.user.username;
    }

    device.status = "rejected";
    device.approvedAt = new Date();
    device.approvedBy = req.user.username;

    await device.save();

    res.json(device);
  } catch (err) {
    console.error("Failed to fetch alarm summary:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "Failed to fetch alarm summary",
    );

    res.status(500).json({
      error: "Failed to fetch alarm summary",
    });
  }
});

// ✅ ALARMS SUMMARY
app.get("/api/alarms/current/summary", async (req, res) => {
  try {
    const devices = await Device.find(
      {},
      {
        currentAlarms: 1,
      },
    ).lean();

    let critical = 0;
    let major = 0;
    let minor = 0;

    for (const device of devices) {
      critical += device.currentAlarms?.critical?.length || 0;
      major += device.currentAlarms?.major?.length || 0;
      minor += device.currentAlarms?.minor?.length || 0;
    }

    res.json({
      critical,
      major,
      minor,
    });
  } catch (err) {
    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "Failed to fetch alarm summary",
    );
    res.status(500).json({
      error: "Failed to fetch alarm summary",
    });
  }
});

app.get("/api/alarms/current", async (req, res) => {
  const severity = req.query.severity;

  const allowedSeverities = ["critical", "major", "minor"];

  if (!allowedSeverities.includes(severity)) {
    return res.status(400).json({
      error: "Invalid severity. Use critical, major or minor",
    });
  }

  try {
    const devices = await Device.find().lean();

    const result = [];

    for (const device of devices) {
      const alarms = device.currentAlarms?.[severity] || [];

      alarms.forEach((alarm) => {
        result.push({
          ip: device.ip,
          deviceName: device.deviceName,
          location: device.location,
          alarm,
        });
      });
    }

    res.json(result);
  } catch (err) {
    console.error("Failed to fetch current alarms:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        severity,
      },
      "Failed to fetch current alarms",
    );

    res.status(500).json({
      error: "Failed",
    });
  }
});

app.get("/api/device/:ip/alarms", async (req, res) => {
  const ip = req.params.ip;

  const device = await Device.findOne(
    { ip },
    {
      currentAlarms: 1,
    },
  );

  if (!device)
    return res.status(404).json({
      error: "Device not found",
    });

  res.json(device.currentAlarms);
});
// *====================  DEVICE API  ======================

// *==================== SNAPSHOTS API =====================
// ✅ Serve snapshot images
app.get("/api/snapshots/:imageName", (req, res) => {
  try {
    const imageName = req.params.imageName;
    const rawIP = req.query.ip;

    if (!rawIP) {
      return res.status(400).json({
        error: "IP address is required",
      });
    }

    if (!imageName) {
      return res.status(400).json({
        error: "Image name is required",
      });
    }

    const ipSuffix = rawIP.slice(8).replace(/[. ]/g, "_"); // Gets characters 9-16 (0-indexed)

    /**
     * Constructs the full file path for a snapshot image by joining the snapshot output directory,
     * IP address suffix, and image name.
     */
    const imagePath = path.join(`${snapshotOutputDir}/${ipSuffix}`, imageName);

    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "Image not found" });
    }

    // Send the image file
    res.sendFile(imagePath);
  } catch (dirErr) {
    console.error("Snapshots directory error:", dirErr);

    logger.error(
      {
        error: dirErr.message,
        stack: dirErr.stack,
        ip: req.query.ip,
      },
      "Snapshots directory not found or could not be read",
    );

    return res.status(500).json({
      error: "Failed to read snapshot",
    });
  }
});

// ✅ Get list of last 15 snapshots
app.get("/api/snapshots", (req, res) => {
  try {
    console.log("Into snapshot API");
    const rawIP = req.query.ip;

    console.log("MAC: ", rawIP);

    // Validate IP address exists
    if (!rawIP) {
      return res.status(400).json({ error: "IP address is required" });
    }

    // Extract the last part of IP
    const ipSuffix = rawIP.slice(8).replace(/[. ]/g, "_"); // Gets characters 9-16 (0-indexed)
    // console.log("MAC ADDRESS: ", macSuffix);

    const snapshotsDir = `${snapshotOutputDir}/${ipSuffix}`;
    console.log(snapshotsDir);
    let files = [];
    try {
      files = fs
        .readdirSync(snapshotsDir)
        .filter((file) => /\.(jpg|jpeg|png|gif)$/i.test(file))
        // Sorting images in descending order based on timestamp in filename
        .sort((a, b) => {
          // Extract YYMMDDHHMMSS format for comparison
          const getKey = (filename) => {
            const match = filename.match(
              /_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})\./,
            );
            return match
              ? match[3] + match[2] + match[1] + match[4] + match[5] + match[6]
              : "0";
          };
          return getKey(b).localeCompare(getKey(a));
        })
        .slice(0, 15); // Get last 15 images
      console.log("snapshots: ", files);
    } catch (dirErr) {
      logger.error(
        {
          error: dirErr.message,
          stack: dirErr.stack,
          ip: req.query.ip,
        },
        "Snapshots directory not found or could not be read",
      );
      // Return empty array if directory not found
      files = [];
    }
    res.json(files);
  } catch (err) {
    console.error("Error reading snapshots:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        ip: req.query.ip,
      },
      "Error reading snapshots",
    );

    res.status(500).json({ error: "Failed to read snapshots" });
  }
});
// *==================== SNAPSHOTS API =====================

// ✅ Command endpoint
app.post("/command", (req, res) => {
  try {
    const { ip, command } = req.body;
    // console
    // const normalizedIP = ip.toLowerCase(); //! Converting to LowerCase()
    const deviceSocket = connectedDevices.get(ip);

    if (!deviceSocket || deviceSocket.destroyed) {
      connectedDevices.delete(ip);
      return res.status(404).json({ message: `Device ${ip} not connected` });
    }

    const buffer = Buffer.from(command, "utf-8");
    deviceSocket.write(buffer, (err) => {
      if (err) {
        console.error(`Failed to send command to ${ip}:`, err);

        logger.error(
          {
            error: err.message,
            stack: err.stack,
            ip: ip,
            command,
          },
          "Failed to send command to device",
        );

        return res
          .status(500)
          .json({ message: `Error sending command to ${ip}` });
      }
      console.log("Command sent");
      logger.info(`Sent command "${command}" to ${ip}`);
      res.json({ message: `${command} sent to ${ip}` });
    });
  } catch (error) {
    console.error("Failed to write command to the device:", error);

    logger.error(
      {
        error: error.message,
        stack: error.stack,
        ip: req.body?.ip,
        command: req.body?.command,
      },
      "Failed to write command to the device",
    );

    res.status(500).json({ error: "Failed to write command to the device" });
  }
});

// ✅ Get last 100 readings
app.get("/api/readings", async (req, res) => {
  try {
    const readings = await SensorReading.find()
      .sort({ timestamp: -1 })
      .limit(600);
    res.json(readings);
  } catch (error) {
    console.error("Error fetching readings:", error);

    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      "Error fetching readings",
    );

    res.status(500).json({ error: "Failed to fetch readings" });
  }
});

// ✅ Get logs saved in PC
app.post("/api/log-command", (req, res) => {
  try {
    const { date, ip, command, status, message } = req.body;

    // console.log(date, ip, command, status, message);

    const now = new Date();
    const fileName = `${now.getDate()}_${
      now.getMonth() + 1
    }_${now.getHours()}.out`;
    // const outLogDir = "C:/CommandLogs/out";

    // if (!fs.existsSync(outLogDir)) {
    //   fs.mkdirSync(outLogDir, { recursive: true });
    // }

    const macDir = ip.replace(/[:. ]/g, "_");
    const deviceCmdDir = path.join(logDir, macDir);

    fs.mkdirSync(deviceCmdDir, { recursive: true });

    const filePath = path.join(deviceCmdDir, fileName);

    const timestamp = now.toLocaleString();
    const logEntry = `[${timestamp}] | IP:${ip} | ${status}  | COMMAND:"${command}" | MESSAGE:"${message}"`;

    // ✅ Send response immediately, log in background

    // File writing happens after response
    // fs.appendFile(filePath, logEntry, (err) => {
    //   if (err) {
    //     console.error("Failed to save log:", err);
    //   } else {
    //     if (eMS_LOGS) console.log(`✅ Log saved: ${filePath}`);
    //   }
    // });

    // ===================== Logging Command | OLD =====================
    //   writeLog(
    //   `${filePath}`,
    //   logEntry
    // );
    // ===================== Logging Command | RABBITMQ =====================

    publishLog({
      type: "out",
      ip,
      command,
      status,
      message,
      timestamp: new Date().toISOString(),
    });

    res.json({ message: "Log received" });
  } catch (error) {
    console.error("Error while logging command:", error);

    logger.error(
      {
        error: error.message,
        stack: error.stack,
        ip,
        command,
      },
      "Error while logging command",
    );

    res.status(500).json({ error: "Failed to log" });
  }
});

//! ✅ Fetch logs from PC - CHECK THIS WHETHER IN USE OR NOT
// app.get("/api/device-logs", (req, res) => {
//   try {
//     const { ip, type = "inc", hours = 1 } = req.query;

//     if (!ip) return res.status(400).json({ error: "MAC required" });

//     const macDir = ip.replace(/[:. ]/g, "_");

//     let baseDir;
//     if (type === "inc") baseDir = IncLogDir;
//     else if (type === "out") baseDir = outLogDir;
//     else if (type === "alarm") baseDir = alarmLogDir;
//     else return res.status(400).json({ error: "Invalid log type" });

//     const deviceDir = path.join(baseDir, macDir);

//     if (!fs.existsSync(deviceDir)) {
//       return res.json({ logs: [] });
//     }

//     const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
//     const logs = [];

//     const files = fs.readdirSync(deviceDir)
//       .filter(f => f.endsWith(type === "out" ? ".out" : ".inc"))
//       .sort()
//       .reverse(); // latest first

//     for (const file of files) {
//       const filePath = path.join(deviceDir, file);
//       const content = fs.readFileSync(filePath, "utf-8");

//       content.split("\n").forEach(line => {
//         const match = line.match(/^\[(.*?)\]/);
//         if (!match) return;

//         const logTime = new Date(match[1]).getTime();
//         if (logTime >= cutoffTime) logs.push(line);
//       });
//     }

//     res.json({ logs: logs.reverse() });
//   } catch (err) {
//     console.error("Error fetching device logs:", err?.stack);
//   }

// });

// OLD LOG FILE PARSING
// function parseOldAlarm(payload, timestamp) {
//   const entries = [];

//   const tokens = String(payload)
//     .split(",")
//     .map(t => t.trim())
//     .filter(Boolean);

//   for (const token of tokens) {

//     const idx = token.indexOf(":");

//     if (idx === -1) {

//       entries.push({
//         timestamp: timestamp.toISOString(),
//         alarm: token,
//         event: "ACTIVE"
//       });

//       continue;
//     }

//     const alarm = token.slice(0, idx).trim();
//     const value = token.slice(idx + 1).trim();

//     entries.push({
//       timestamp: timestamp.toISOString(),
//       alarm,
//       event: value
//     });

//   }

//   return entries;
// }

// NEW LOG FILE PARSING
// function parseNewAlarm(line, timestamp) {

//   const alarmMatch = line.match(
//     /\|\s*ALARM:\s*(.*?)\s*\|\s*EVENT:\s*(.*?)\s*$/
//   );

//   if (!alarmMatch)
//     return [];

//   return [{
//     timestamp: timestamp.toISOString(),
//     alarm: alarmMatch[1].trim(),
//     event: alarmMatch[2].trim()
//   }];
// }

// function parseAlarmLine(line, payload, timestamp) {
//   if (
//     line.includes("ALARM:") &&
//     line.includes("EVENT:")
//   ) {

//     return parseNewAlarm(
//       line,
//       timestamp
//     );

//   }

//   return parseOldAlarm(
//     payload,
//     timestamp
//   );
// }

/*
 * ALARM HISTORY API
 *
 * Request Query Parameters:
 * - ip    : Device IP address
 * - from  : Start date and time for alarm history
 * - to    : End date and time for alarm history
 * - page  : Page number for pagination (default: 1)
 * - limit : Number of entries per page (default: 100)
 *
 * Returns:
 * - ip         : Requested device IP address
 * - from       : Requested start date and time
 * - to         : Requested end date and time
 * - entries    : Alarm history entries within the selected date range
 * - total      : Total number of matching alarm entries
 * - page       : Current page number
 * - limit      : Number of entries per page
 * - totalPages : Total number of available pages
 */
app.get("/api/alarm-history", async (req, res) => {
  try {
    console.log("Calling Alarm History API");
    const { ip, from, to, page = 1, limit = 100 } = req.query;

    const pageNo = Number(page);
    const pageLimit = Number(limit);

    if (!ip || !from || !to) {
      return res.status(400).json({ error: "Missing ip, from or to" });
    }

    const fromDate = parseQueryDate(from);
    const toDate = parseQueryDate(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    if (toDate.getTime() < fromDate.getTime()) {
      return res
        .status(400)
        .json({ error: "Invalid date range: 'to' must be >= 'from'" });
    }

    const macFolder = ip.replace(/[:. ]/g, "_");
    const baseDir = `C:/CommandLogs/alarm/${macFolder}`;

    const cacheKey = `${ip}|${from}|${to}`;

    console.log("Base Dir: ", baseDir);

    if (!fs.existsSync(baseDir)) {
      console.log("Sending empty");
      return res.json({ ip, from, to, entries: [] });
    }
    let cache = alarmHistoryCache.get(cacheKey);

    if (cache) {
      console.log("✅ Returning alarm history from cache");

      const start = (pageNo - 1) * pageLimit;

      return res.json({
        entries: cache.entries.slice(start, start + pageLimit),
        total: cache.total,
        page: pageNo,
        limit: pageLimit,
        totalPages: Math.ceil(cache.total / pageLimit),
      });
    }

    // 🟢 Generate all hour blocks between from and to
    const filesToScan = getAlarmFiles(baseDir, fromDate, toDate);

    console.log("Files to scan:", filesToScan);

    const alarmMap = new Map();
    // const entries = [];

    if (filesToScan.length === 0) {
      return res.json({ ip, from, to, entries: [] });
    }

    // 🟢 Stream each file
    for (const filePath of filesToScan) {
      console.log("file loop");
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        const text = String(line || "").trim();
        if (!text) continue;

        let timestamp = null;

        const pipeParts = text.split("|").map((part) => part.trim());

        /*
         * =====================================================
         * NEW FIXED-COLUMN FORMAT
         * =====================================================
         *
         * log_timestamp | alert_id | device_ip | severity |
         * alarm | alarm_value | start_time | end_time | status
         */

        if (pipeParts.length === 9) {
          timestamp = new Date(pipeParts[0]);

          if (isNaN(timestamp.getTime())) {
            continue;
          }
        } else {
          /*
           * =====================================================
           * OLD LOG FORMAT
           * =====================================================
           *
           * [24/2/2026, 3:00:20 pm] | ...
           */
          const tsMatch = text.match(/^\s*\[([^\]]+)\]/);

          if (!tsMatch) continue;

          timestamp = parseIstLogTimestamp(tsMatch[1]);

          if (!timestamp) continue;
        }

        if (timestamp < fromDate || timestamp > toDate) {
          continue;
        }

        let payload = null;

        if (!text.includes("ALARM:")) {
          const pipeParts = text
            .split("|")
            .map((p) => p.trim())
            .filter(Boolean);

          if (pipeParts.length < 3) continue;

          payload = pipeParts.slice(2).join(" | ");
        }

        const parsedEntries = parseAlarmLine(text, payload, timestamp);

        if (!Array.isArray(parsedEntries)) {
          continue;
        }

        for (const alarmEntry of parsedEntries) {
          /*
           * Old alarm formats may not have alert_id.
           *
           * Keep them separately so existing historical
           * logs continue working.
           */
          if (!alarmEntry.alert_id) {
            const fallbackKey = `${alarmEntry.device_ip || ip}_${alarmEntry.timestamp || timestamp.toISOString()}_${alarmEntry.alarm || ""}_${alarmMap.size}`;

            alarmMap.set(fallbackKey, alarmEntry);

            continue;
          }

          const existingAlarm = alarmMap.get(alarmEntry.alert_id);

          /*
           * First occurrence of this alarm lifecycle.
           */

          if (!existingAlarm) {
            alarmMap.set(alarmEntry.alert_id, alarmEntry);

            continue;
          }

          /*
           * Same alarm_id.
           *
           * Keep the latest information.
           */

          existingAlarm.log_timestamp = alarmEntry.log_timestamp;

          existingAlarm.alarm_value = alarmEntry.alarm_value;

          existingAlarm.severity = alarmEntry.severity;

          /*
           * If alarm has been cleared,
           * update its final state.
           */

          if (String(alarmEntry.status).toLowerCase() === "cleared") {
            existingAlarm.status = alarmEntry.status;

            existingAlarm.end_time = alarmEntry.end_time;
          }

          alarmMap.set(alarmEntry.alert_id, existingAlarm);
        }
      }
    }
    console.log("Logs send successfully to UI");

    const entries = Array.from(alarmMap.values());

    entries.sort((a, b) => {
      const timeA = new Date(
        a.start_time || a.log_timestamp || a.timestamp,
      ).getTime();

      const timeB = new Date(
        b.start_time || b.log_timestamp || b.timestamp,
      ).getTime();

      return timeB - timeA;
    });

    const start = (pageNo - 1) * pageLimit;

    const pageEntries = entries.slice(start, start + pageLimit);

    res.json({
      ip,
      from,
      to,
      entries: pageEntries,
      total: entries.length,
      page: pageNo,
      limit: pageLimit,
      totalPages: Math.ceil(entries.length / pageLimit),
    });

    alarmHistoryCache.set(cacheKey, entries, baseDir);
  } catch (error) {
    console.error("Error in /api/alarm-history:", error);

    logger.error(
      {
        error: error.message,
        stack: error.stack,
        ip: req.query.ip,
        from: req.query.from,
        to: req.query.to,
      },
      "Error in /api/alarm-history",
    );

    res.status(500).json({
      ok: false,
      error: "Failed to fetch alarm history",
      message: "Error in fetching alarm logs",
    });
  }
});

/*
 * HISTORICAL DATA API
 *
 * Request Query Parameters:
 * - ip       : Device IP address
 * - datetime : Selected date and time
 *
 * Returns:
 * - readings       : All sensor readings for the selected date
 * - atSelectedTime : Latest sensor reading at or before the selected datetime
 */
app.get("/api/historical-data", async (req, res) => {
  const { ip, datetime } = req.query;
  console.log("IP: ", ip, " | Date ", datetime);

  if (!ip || !datetime)
    return res.status(400).json({ error: "Missing ip or datetime" });

  // const normalizedMac = ip.toLowerCase(); //! Converting to LowerCase()
  const datetimeObj = new Date(datetime);

  if (isNaN(datetimeObj.getTime()))
    return res.status(400).json({ error: "Invalid datetime format" });

  const selectedDate = new Date(datetimeObj);
  selectedDate.setHours(0, 0, 0, 0);
  const nextDate = new Date(selectedDate);
  nextDate.setDate(nextDate.getDate() + 1);

  console.log("Date passing to DB: ", selectedDate, nextDate);

  try {
    const readings = await SensorReading.find({
      ip: ip,
      timestamp: { $gte: selectedDate, $lt: nextDate },
    }).sort({ timestamp: 1 });
    const atSelectedTime = await SensorReading.findOne({
      ip: ip,
      timestamp: { $lte: datetimeObj },
    }).sort({ timestamp: -1 });
    res.json({ readings, atSelectedTime });
  } catch (err) {
    console.error("Historical data error:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        ip: req.query.ip,
        datetime: req.query.datetime,
      },
      "Historical data error",
    );

    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

app.post("/api/cloud-readings", async (req, res) => {
  try {
    await SensorReading.create(req.body);
    res.json({
      success: true,
    });
  } catch (err) {
    console.error("Cloud reading upload failed:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "Cloud reading upload failed",
    );

    res.status(500).json({
      success: false,
    });
  }
});

// ✅ Debug routes
// app.use('/debug', require('./auth/debug'));

// 📡 TCP Server
const BULK_SAVE_LIMIT = 1000;
let readingBuffer = [];
let alreadyReplied = 0;

const eMS_LOGS = process.env.eMS_LOGS === "true";
// console.log(`[BOOT] eMS_LOGS is`, eMS_LOGS);

const INC_LOGS_CMD = process.env.INC_LOGS_CMD === "true";
const OUT_LOGS_CMD = process.env.OUT_LOGS_CMD === "true";
const ALARM_LOGS_CMD = process.env.ALARM_LOGS_CMD === "true";
const SNAP_CMD = process.env.SNAP_CMD === "true";

const IncLogDir = process.env.INC_LOG_DIR;
const outLogDir = process.env.OUT_LOG_DIR;
const alarmLogDir = process.env.ALARM_LOG_DIR;
const snapshotOutputDir = process.env.SNAP_DIR;

const logDir = outLogDir;

function dirCheck(dir, enabled) {
  if (!enabled) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create directory ${dir}:`, err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        directory: dir,
      },
      "Failed to create directory",
    );
  }
}

dirCheck(IncLogDir, INC_LOGS_CMD);
dirCheck(outLogDir, OUT_LOGS_CMD);
dirCheck(alarmLogDir, ALARM_LOGS_CMD);
dirCheck(snapshotOutputDir, SNAP_CMD);

// Function to get formatted Date and Time
/*
  Pass any string to function to get Date & Time in below format: 
  20_01_26_12_45_52
 
  Without passing any argument will get below Data & Time format: 
  20/01/26 12:45:52
*/
function getFormattedDateTime(outType = "string") {
  // Pass any string to function if you want output in second way
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dd = pad(today.getDate());
  const mm = pad(today.getMonth() + 1);
  const yy = String(today.getFullYear()).slice(-2);
  const HH = pad(today.getHours());
  const MM = pad(today.getMinutes());
  const SS = pad(today.getSeconds());

  if (outType === "string") {
    return `${dd}/${mm}/${yy} ${HH}:${MM}:${SS}`;
  } else {
    return `${dd}_${mm}_${yy}_${HH}_${MM}_${SS}`;
  }
}

function sendX(socket) {
  const msg = `%X000${getFormattedDateTime()}$`;
  logger.info(`⬅️ Sending back: ${msg}`);
  const ok = socket.write(msg);
  if (!ok) {
    console.warn("⚠️ Backpressure: socket buffer is full, write queued");
  }
}

// *=================================== CLEANING CODE ===================================
// Function to delete DB Records
async function DBCleanup() {
  try {
    const MAX_DOCS = parseInt(process.env.MAX_SENSOR_DOCS || "50000", 10);
    // const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '15', 10);

    // Getting 'SensorReading' count
    const sensorRecordsCount = await SensorReading.countDocuments();
    if (sensorRecordsCount === 0) {
      console.log("No Sensor Data found", "CLEANUP");
      return;
    }

    if (sensorRecordsCount > MAX_DOCS) {
      // Getting the boundary Document of SensorReading to delete all documents before from that bounday date
      const boundaryDoc = await SensorReading.findOne({}, { timestamp: 1 })
        .sort({ timestamp: -1 }) // Latest Doc first
        .skip(MAX_DOCS - 1);

      if (!boundaryDoc || !boundaryDoc.timestamp) {
        console.error("Unable to determine boundary timestamp for capping");

        logger.error(
          {
            stage: "CLEANUP",
          },
          "Unable to determine boundary timestamp for capping",
        );

        return;
      }

      // Deleting Documents
      const capRes = await SensorReading.deleteMany({
        timestamp: { $lt: boundaryDoc.timestamp },
      });
      if (eMS_LOGS)
        console.log(
          `Count capping: deleted ${capRes.deletedCount} docs older than ${boundaryDoc.timestamp.toISOString()}`,
          "CLEANUP",
        );
    }
  } catch (err) {
    console.error("Error in DB cleanup:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        stage: "CLEANUP",
      },
      "Error in DB cleanup",
    );
  }
}

// Cleaning up DB hourly
function hourlyDBCleanup() {
  let isCleaning = false;

  const runCleanup = async () => {
    if (isCleaning) {
      if (eMS_LOGS)
        logger.info("Cleanup already running, skipping this tick", "CLEANUP");
      return;
    }
    isCleaning = true;
    try {
      await DBCleanup();
    } catch (e) {
      // getData already logs errors
    } finally {
      isCleaning = false;
    }
  };

  // Run immediately, then hourly
  runCleanup();
  setInterval(runCleanup, 60 * 60 * 1000);
}

hourlyDBCleanup();

// Function to delete log files older than 30 days
function deleteLogFiles() {
  // const IncLogDir = "C:/CommandLogs/inc";

  const daysThreshold = 30;
  const thresholdTime = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;

  if (!IncLogDir) {
    return;
  }

  fs.readdir(IncLogDir, (err, macDirs) => {
    if (err) {
      if (err.code === "ENOENT") return;

      console.error("Error reading log directory:", err);

      logger.error(
        {
          error: err.message,
          stack: err.stack,
          directory: IncLogDir,
        },
        "Error reading log directory",
      );

      return;
    }

    macDirs.forEach((macDir) => {
      const fullDir = path.join(IncLogDir, macDir);

      if (!fs.statSync(fullDir).isDirectory()) return;

      fs.stat(fullDir, (err, stats) => {
        if (err || !stats?.isDirectory()) return;

        fs.readdir(fullDir, (err, files) => {
          if (err) {
            return;
          }

          files.forEach((file) => {
            if (!file.endsWith(".inc")) return;

            const filePath = path.join(fullDir, file);
            fs.stat(filePath, (err, stats) => {
              if (err || !stats) return;

              if (stats.mtimeMs < thresholdTime) {
                fs.unlink(filePath, (err) => {
                  if (err) {
                    logger.error(
                      {
                        error: err.message,
                        filePath,
                      },
                      "Failed to delete old log file",
                    );
                  }
                });
              }
            });
          });
        });
      });
    });
  });
}

function logCleanupScheduler() {
  // Run immediately, then every 24 hours
  deleteLogFiles();
  setInterval(deleteLogFiles, 24 * 60 * 60 * 1000);
}
logCleanupScheduler();
// *=================================== CLEANING CODE ===================================

function getLogStream(filePath) {
  if (!logStreams[filePath]) {
    // make sure directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    logStreams[filePath] = fs.createWriteStream(filePath, {
      flags: "a", // append mode
    });

    logStreams[filePath].on("error", (err) => {
      console.error("Log stream error:", err);

      logger.error(
        {
          error: err.message,
          stack: err.stack,
          filePath,
        },
        "Log stream error",
      );
    });
  }

  return logStreams[filePath];
}

function writeLog(filePath, data) {
  const stream = getLogStream(filePath);
  stream.write(data + "\n");
}

const tempCalibrationTable = [
  { min: 0, max: 10, factor: 0 },
  { min: 11, max: 20, factor: 0 },
  { min: 21, max: 30, factor: 0 },
  { min: 31, max: 40, factor: 0.05 },
  { min: 41, max: 50, factor: 0.07 },
  { min: 51, max: 60, factor: 0.09 },
  { min: 61, max: 70, factor: 0.1 },
];

function calibrateTemperature(temp) {
  if (typeof temp !== "number") return temp;

  const range = tempCalibrationTable.find(
    (r) => temp >= r.min && temp <= r.max,
  );

  if (!range) return temp;

  return temp * (1 + range.factor);
}

// SEND DATA TO AWS
async function sendToCloud(reading) {
  try {
    await axios.post(
      "http://98.88.250.83/api/cloud-readings",
      reading.toObject(),
    );
  } catch (err) {
    console.log("Cloud not reachable");
  }
}

// async function updateDeviceStatus(ip) {
//   try {
//     const now = new Date();

//     // const device = await Device.findOne({ ip });

//     // if (!device) return;

//     // DeviceStatus was DOWN -> make it UP
//     //! HERE WE CAN MARK DEVICE PING AS SUCCESS
//     const result = await Device.updateOne(
//       {
//         ip,
//         deviceStatus: { $ne: "UP" },
//       },
//       {
//         $set: {
//           deviceStatus: "UP",
//           lastPacketTime: now,
//           lastStatusChangeTimeTicks: Date.now(),
//         },
//       },
//     );

//     // Already UP -> only refresh heartbeat
//     if (result.modifiedCount === 0) {
//       await Device.updateOne(
//         { ip },
//         {
//           $set: {
//             lastPacketTime: now,
//           },
//         },
//       );
//     }
//   } catch (err) {
//     console.error(`Failed to update device status for ${ip}:`, err);

//     logger.error(
//       {
//         error: err.message,
//         stack: err.stack,
//         ip,
//       },
//       "Failed to update device status",
//     );
//   }
// }

async function updateDeviceStatus(ip) {
  try {
    const now = new Date();

    // Update status and change timestamp only when transitioning to UP.
    const transitionResult = await Device.updateOne(
      { ip, deviceStatus: { $ne: "UP" } },
      {
        $set: {
          deviceStatus: "UP",
          lastPacketTime: now,
          lastStatusChangeTimeTicks: Date.now(),
        },
      },
    );

    if (transitionResult.matchedCount === 0) {
      // Device may already be UP, or it may not exist.
      const heartbeatResult = await Device.updateOne(
        { ip },
        { $set: { lastPacketTime: now } },
      );

      if (heartbeatResult.matchedCount === 0) {
        console.warn(`[DeviceStatus] No registered device found for IP ${ip}`);
        return;
      }
    }

    updateDeviceStatusCache(ip, "UP");
  } catch (err) {
    console.error(`[DeviceStatus] Failed to update ${ip}:`, err);
  }
}

setInterval(async () => {
  if (readingBuffer.length === 0) return;

  const toSave = readingBuffer.splice(0, BULK_SAVE_LIMIT);

  try {
    await SensorReading.insertMany(toSave, { ordered: false });

    const uniqueMacs = [...new Set(toSave.map((r) => r.ip))];

    await Promise.all(uniqueMacs.map((ip) => updateDeviceStatus(ip)));
  } catch (err) {
    console.error("Periodic bulk save error:", err);

    logger.error(
      {
        error: err.message,
        stack: err.stack,
        operation: "periodic bulk save",
      },
      "Periodic bulk save error",
    );
  }
}, 2000);

const server = net.createServer((socket) => {
  // let buffer = Buffer.alloc(0);
  socket.buffer = Buffer.alloc(0);
  let packetCount = 0;

  const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;
  const connStart = Date.now();
  if (eMS_LOGS) {
    console.log(
      `[LOG] New TCP Connection from ${clientInfo} at ${new Date(connStart).toISOString()}`,
    );
  }
  console.log(
    `[LOG] New TCP Connection from ${clientInfo} at ${new Date(connStart).toISOString()}`,
  );
  logger.info(`New TCP Connection from`, clientInfo);

  socket.on("data", async (data) => {
    const dataStart = Date.now();
    // buffer = Buffer.concat([buffer, data]);
    socket.buffer = Buffer.concat([socket.buffer, data]);

    if (eMS_LOGS) {
      console.log("========================================");
      console.log("RAW TCP CHUNK");
      console.log("Length:", data.length);
      console.log("ASCII:", JSON.stringify(data.toString("ascii")));
      console.log(
        "EVENT COUNT:",
        (data.toString("ascii").match(/#EVENT/g) || []).length,
      );
      console.log("========================================");
    }

    const PACKET_LEN = 58;

    try {
      // debug.bufferStats.discardedBytes.totalBytes += data.length;

      // console.log(`Raw data received ${data.toString('hex')} with length (${data.length} bytes) from`, clientInfo);
      // if (eMS_LOGS) {
      console.log(
        `Raw data received ${packetCount} with length ${data.length} from`,
        clientInfo,
      );
      // }
      // packetCount++;

      // console.log("Raw data received")
      // console.log(`Raw data hex preview:`, data.toString('hex').substring(0, 100) + '...');

      // buffer = Buffer.concat([buffer, data]);
      // console.log(`Total buffer size: ${buffer.length} bytes`);

      // let ip = null;

      while (socket.buffer.length > 0) {
        packetCount++;

        // Handle protocol preamble once after device restart
        if (!socket.preambleHandled && socket.buffer.length >= 4) {
          const preamble = socket.buffer.slice(0, 4).toString("ascii");

          if (preamble === "tcp2") {
            socket.buffer = socket.buffer.slice(4);
            socket.preambleHandled = true;
          }
        }
        // ============================================================
        // CHECK FOR PAST ALARM / DUMP PACKET
        // Total = 90 bytes
        // ============================================================
        const hupsMarker = Buffer.from("#H");

        if (socket.buffer.indexOf(hupsMarker) === 0) {
          const hupsEnd = socket.buffer.indexOf(0x24); // '$'

          if (hupsEnd === -1) {
            break;
          }

          const hupsPacket = socket.buffer
            .slice(0, hupsEnd + 1)
            .toString("ascii");

          socket.buffer = socket.buffer.slice(hupsEnd + 1);
          console.log("HUPS PACKET RECEIVED:", hupsPacket);
          continue;
        }

        if (socket.buffer.length >= 14) {
          // ============================================================
          // CHECK FOR PAST ALARM / DUMP MESSAGE
          // ============================================================

          const eventMarker = Buffer.from("#EVENT");

          const eventStart = socket.buffer.indexOf(eventMarker);

          if (eventStart !== -1) {
            // Find end of this dump message
            const eventEnd = socket.buffer.indexOf(
              Buffer.from("\r\n"),
              eventStart,
            );

            // Complete dump has not arrived yet
            if (eventEnd === -1) {
              break;
            }

            // Extract only:
            // #EVENT........................\r\n
            const dumpPacket = socket.buffer.slice(eventStart, eventEnd + 2);

            // Remove everything through this dump packet
            socket.buffer = socket.buffer.slice(eventEnd + 2);

            const dumpMessage = dumpPacket.toString("ascii").trim();

            console.log("========================================");
            console.log("📜 PAST ALARM DUMP RECEIVED");
            console.log("Length:", dumpPacket.length);
            console.log(dumpMessage);
            console.log("========================================");

            console.log("HUPS PKT: ", hupsMarker);

            // Send to existing Log Worker
            publishLog({
              type: "dump",
              ip: socket.remoteAddress,
              packet: dumpMessage,
              timestamp: new Date().toISOString(),
            });

            console.log("📤 Dump packet sent to log.queue");

            continue;
          }
        }
        // ============================================================
        // EXISTING LIVE PACKET CODE
        // ============================================================

        // Wait for full live packet
        if (socket.buffer.length < 58) {
          break;
        }

        const header = socket.buffer.slice(0, 8).toString("ascii");

        if (!/^[0-9a-fA-F]{8}$/.test(header)) {
          // corrupted / misaligned packet → resync
          socket.buffer = socket.buffer.slice(1);
          continue;
        }

        const ipHexAscii = socket.buffer.slice(0, 8).toString("ascii");

        // Convert hex pairs → decimal
        const ip = ipHexAscii
          .match(/.{2}/g)
          .map((h) => parseInt(h, 16))
          .join(".");

        // Reject obvious garbage IPs
        if (!ip.startsWith("192.168.")) {
          console.warn("🚫 Dropping invalid IP:", ip);
          socket.buffer = socket.buffer.slice(1);
          continue;
        }

        // Extract live packet
        const packet = socket.buffer.slice(0, 58);
        socket.buffer = socket.buffer.slice(58);

        // Your existing live packet processing continues here...
        // while (socket.buffer.length >= 58) {
        //   packetCount++;

        //   // Handle protocol preamble once after device restart
        //   if (!socket.preambleHandled && socket.buffer.length >= 4) {
        //     const preamble = socket.buffer.slice(0, 4).toString('ascii');

        //     if (preamble === 'tcp2') {
        //       socket.buffer = socket.buffer.slice(4);
        //       socket.preambleHandled = true;
        //     }
        //   }

        //   const header = socket.buffer.slice(0, 8).toString('ascii');

        //   if (!/^[0-9a-fA-F]{8}$/.test(header)) {
        //     // corrupted / misaligned packet → resync like MAC server
        //     socket.buffer = socket.buffer.slice(1);
        //     continue;
        //   }

        //   const ipHexAscii = socket.buffer.slice(0, 8).toString('ascii');

        //   // Convert hex pairs → decimal
        //   const ip = ipHexAscii
        //     .match(/.{2}/g)
        //     .map(h => parseInt(h, 16))
        //     .join('.');

        //   // Reject obvious garbage IPs
        //   if (!ip.startsWith('192.168.')) {
        //     console.warn('🚫 Dropping invalid IP:', ip);
        //     socket.buffer = socket.buffer.slice(1);
        //     continue;
        //   }

        //   // console.log("EXTRACTED IP: ", ip);

        //   // wait for full packet
        //   if (socket.buffer.length < 58) break;

        //   const packet = socket.buffer.slice(0, 58);
        //   socket.buffer = socket.buffer.slice(58);

        // const ip = `${packet[0]}.${packet[1]}.${packet[2]}.${packet[3]}`;

        // console.log("Extracted IP: ", extractedIP);
        // const ip = ip; //! Converting to LowerCase()
        const humidity = +packet.readFloatLE(17).toFixed(2);
        const insideTemperature = +packet.readFloatLE(21).toFixed(2);
        const outside = +packet.readFloatLE(25).toFixed(2); // "+" converts string to number as toFixed return string

        const outsideTemperature = calibrateTemperature(outside);

        const lockStatus = packet[29] === 1 ? "OPEN" : "CLOSED";
        const doorStatus = packet[30] === 1 ? "OPEN" : "CLOSED";
        const waterLogging = !!packet[31]; // "!!" -> converts true/false to 1/0
        const waterLeakage = !!packet[32];

        const outputVoltage = +packet.readInt16LE(33).toFixed(2) / 100;
        const hupsDVC = +packet.readInt16LE(35).toFixed(2) / 100;
        const inputVoltage = +packet.readInt16LE(37).toFixed(2) / 100;
        const hupsBatVolt = packet.readInt16LE(39);
        const batteryBackup = +packet.readFloatLE(41).toFixed(2);

        const alarmActive = !!packet[45];

        // 0 -> No alarm | 1 -> Fire | 2 -> Smoke | SmokeWait -> 80 | Smoke + Fire -> 81
        const fireAlarm = packet[46];
        const fanLevel1Running = !!packet[47];
        const fanLevel2Running = !!packet[48];
        const fanLevel3Running = !!packet[49];
        const fanLevel4Running = !!packet[50];

        const padding = packet[51]; // unused
        const fanStatusBits = packet.readUInt16LE(52);

        const pwsFailCount = packet[54]; // Password Failure Count
        const hupsStat = packet[55];
        const hupsRes = packet[56];
        const failMask = packet[57];

        const packetTimestamp = new Date();
        const macDir = ip.replace(/[:. ]/g, "_");

        // Getting HUPS Alarms
        const hupsAlarms = [];
        /* 
            Extracting Individual HUPS Alarms from 'hupsStat' using bitwise operations. 
            Each alarm is represented by a single bit within the 'hupsStat' integer. 
            The loop iterates 8 times (for 8 alarms), extracting each bit and 
            storing the alarm status in the 'hupsAlarms' array.
        */
        for (let i = 0; i < 8; i++) {
          hupsAlarms[i] = (hupsStat >> i) & 0x01;
        }

        // console.log(hupsAlarms);
        // console.log(hupsBatVolt);

        /*
          Extracting Individual Fan Status from 'fanStatusBits' using bitwise operations. 
          Each fan's status is represented by 2 bits within the 'fanStatusBits' integer. 
          The loop iterates 6 times (for 6 fans), extracting the relevant 2 bits for each fan and 
          storing the status in the 'fanStatus' array.
        */
        const fanStatus = [];
        for (let i = 0; i < 6; i++) {
          fanStatus[i] = (fanStatusBits >> (i * 2)) & 0x03; // 0=off, 1=healthy, 2=faulty
        }
        // console.log("Padding: ", padding);
        console.log("firealarm : ", fireAlarm);

        //* ===================== LOGGING EXTRACTED VALUES =====================
        if (eMS_LOGS) {
          // console.log("Humidity: ", humidity);
          // console.log("Input Voltage: ", inputVoltage);
          // console.log("Fan Status: ", fanStatus);
          // console.log(fanLevel1Running, fanLevel2Running, fanLevel3Running, fanLevel4Running);
          // console.log("BAT Volt: ", hupsBatVolt);
          // console.log("DV Current: ", hupsDVC);
          // console.log("Door status: ", doorStatus);
          // console.log("pwsFailCount: ", pwsFailCount);
        }
        //* ===================== LOGGING EXTRACTED VALUES =====================

        if (padding === 0x31 && !alreadyReplied) {
          sendX(socket);
          alreadyReplied = 40; // Load Balancing
        }

        // ===================== RABBITMQ SNAPSHOT LOGIC =====================
        if (padding === 0x43 && doorStatus === "OPEN") {
          console.log("Inside snapshot", ip);
          const deviceMeta = deviceCache.get(String(ip));

          if (!deviceMeta) {
            console.warn(`⚠️ Device metadata not found for snapshot: ${ip}`);
          } else {
            publishSnapshot({
              ip,
              cameraType: deviceMeta.cameraType,
              cameraIP: ip,
              requestedAt: new Date().toISOString(),
            });
          }
        }
        // ===================== RABBITMQ SNAPSHOT LOGIC =====================

        // ===================== Logging Incoming Data from Simulator | RABBITMQ =====================
        if (INC_LOGS_CMD) {
          publishLog({
            type: "inc",
            ip,
            humidity,
            insideTemperature,
            outsideTemperature,
            inputVoltage,
            outputVoltage,
            batteryBackup,
            timestamp: new Date().toISOString(),
          });
        }
        // ===================== Logging Incoming Data from Simulator | RABBITMQ =====================

        if (alreadyReplied) alreadyReplied--;

        // Extracting Fans Status
        // console.log("fanStatus", fanStatusBits);

        // console.log("Password Bit: ", pwsFailCount)// <-- Critical offset //Password

        const floats = [
          humidity,
          insideTemperature,
          outsideTemperature,
          outputVoltage,
          inputVoltage,
          batteryBackup,
        ];

        if (floats.some((val) => isNaN(val) || Math.abs(val) > 100000)) {
          console.warn(`⚠️ Skipping packet from ${ip}: bad float value(s)`);
          // buffer = buffer.slice(58);
          continue;
        }

        // Threshold-based alarms
        const thresholdAlarms = {
          insideTemperatureAlarm:
            insideTemperature > thresholds.insideTemperature.max ||
            insideTemperature < thresholds.insideTemperature.min,
          outsideTemperatureAlarm:
            outsideTemperature > thresholds.outsideTemperature.max ||
            outsideTemperature < thresholds.outsideTemperature.min,
          humidityAlarm:
            humidity > thresholds.humidity.max ||
            humidity < thresholds.humidity.min,
          inputVoltageAlarm:
            inputVoltage > thresholds.inputVoltage.max ||
            inputVoltage < thresholds.inputVoltage.min,
          outputVoltageAlarm:
            outputVoltage > thresholds.outputVoltage.max ||
            outputVoltage < thresholds.outputVoltage.min,
          batteryBackupAlarm: batteryBackup < thresholds.batteryBackup.min,
        };

        publishAlarm({
          ip,
          humidity,
          insideTemperature,
          outsideTemperature,
          inputVoltage,
          outputVoltage,
          batteryBackup,
          waterLogging,
          waterLeakage,
          doorStatus,
          lockStatus,
          fireAlarm,
          fanStatus,
          pwsFailCount,
          mainStatus: hupsAlarms[0],
          rectStatus: hupsAlarms[1],
          inveStatus: hupsAlarms[2],
          overStatus: hupsAlarms[3],
          mptStatus: hupsAlarms[4],
          mosfStatus: hupsAlarms[5],
          timestamp: new Date(),
        });

        // ========================== RABBIT MQ ALARM WORKER ==========================
        // }

        socket.deviceId = ip;
        connectedDevices.set(ip, socket);

        // Build and save the reading (fan status is now independent, not derived)
        const reading = new SensorReading({
          ip,
          humidity,
          insideTemperature,
          outsideTemperature,
          lockStatus,
          doorStatus,
          waterLogging,
          waterLeakage,
          outputVoltage,
          hupsDVC,
          inputVoltage,
          hupsBatVolt,
          batteryBackup,
          alarmActive,
          fireAlarm,
          fanLevel1Running,
          fanLevel2Running,
          fanLevel3Running,
          fanLevel4Running,
          // fanFailBits, // keep for legacy (optional)
          pwsFailCount,
          fan1Status: fanStatus[0],
          fan2Status: fanStatus[1],
          fan3Status: fanStatus[2],
          fan4Status: fanStatus[3],
          fan5Status: fanStatus[4],
          fan6Status: fanStatus[5],
          mainStatus: hupsAlarms[0],
          rectStatus: hupsAlarms[1],
          inveStatus: hupsAlarms[2],
          overStatus: hupsAlarms[3],
          mptStatus: hupsAlarms[4],
          mosfStatus: hupsAlarms[5],
          hupsRes,
          ...thresholdAlarms,
          // Set timestamp to IST
          timestamp: packetTimestamp,
        });

        console.log("Reading: ", reading.fireAlarm);

        // console.log("Fan1Status: ", reading.fan1Status)
        // console.log("Fan2Status: ", reading.fan2Status)
        // console.log("Fan3Status: ", reading.fan3Status)
        // console.log("Fan4Status: ", reading.fan4Status)
        // console.log("Fan5Status: ", reading.fan5Status)
        // console.log("Fan6Status: ", reading.fan6Status)

        // console.log("FanGroup1Status: ", reading.fanLevel1Running);
        // console.log("FanGroup2Status: ", reading.fanLevel2Running);
        // console.log("FanGroup3Status: ", reading.fanLevel3Running);
        // console.log("FanGroup4Status: ", reading.fanLevel4Running);

        // readingBuffer = readingBuffer.filter(r => r.ip !== ip);
        // sendToCloud(reading);
        readingBuffer.push(reading);
        // console.log(`[BUFFER] pushed reading; readingBuffer.length=${readingBuffer.length}`);
        // console.log(`[eMS_LOGS] Finished parsing packet for MAC: ${ip}`);

        if (readingBuffer.length >= BULK_SAVE_LIMIT) {
          const toSave = [...readingBuffer];
          readingBuffer = [];

          try {
            await SensorReading.insertMany(toSave);

            // Update deviceStatus only after successful save
            const uniqueMacs = [...new Set(toSave.map((r) => r.ip))];

            await Promise.all(uniqueMacs.map((ip) => updateDeviceStatus(ip)));
          } catch (err) {
            console.error("Immediate bulk save failed:", err);

            logger.error(
              {
                error: err.message,
                stack: err.stack,
                operation: "immediate bulk save",
                records: toSave.length,
              },
              "Immediate bulk save failed",
            );
          }
        }
        // setImmediate(async () => {
        //   if (readingBuffer.length >= BULK_SAVE_LIMIT) {
        //     const batch = readingBuffer.splice(0);
        //     await SensorReading.insertMany(batch, { ordered: false });
        //   }
        // });

        // socket.buffer = socket.buffer.slice(PACKET_LEN);

        // debugger;
        // if (eMS_LOGS) console.log(`✅ Packet processed successfully for MAC: ${ip}`, `Time: ${getFormattedDateTime()}`);
      }
    } catch (err) {
      console.error("Packet parsing failed:", err);

      logger.error(
        {
          error: err.message,
          stack: err.stack,
          clientInfo,
          packetCount,
          bufferLength: socket.buffer?.length,
        },
        "Packet parsing failed",
      );

      socket.destroy();
    }
  });

  socket.on("end", () => {
    for (const [ip, sock] of connectedDevices.entries()) {
      if (sock === socket) {
        connectedDevices.delete(socket.deviceId);
        logger.info(`Device ${ip} disconnected`);
      }
    }
  });

  socket.on("error", (err) => {
    if (err.code !== "ECONNRESET") {
      console.error("Socket error:", err);

      logger.error(
        {
          error: err.message,
          stack: err.stack,
          code: err.code,
          clientInfo,
          deviceId: socket.deviceId,
        },
        "Socket error",
      );
    }
  });

  // setInterval(() => {
  //   if (readingBuffer.length > 0) {
  //     const toSave = [...readingBuffer];
  //     readingBuffer = [];
  //     SensorReading.insertMany(toSave)
  //       .then((docs) => {
  //         docs.forEach(doc => {
  //           logger.info(`✅ Saved reading in DB (periodic): MAC=${doc.ip}, timestamp=${doc.timestamp}`);
  //         });
  //       })
  //       .catch((err) =>
  //         console.error("Periodic bulk save error:", err.message)
  //       );
  //   }
  // }, 5000);
});

server.listen(4000, "0.0.0.0", () => {
  logger.info("TCP server listening on port 4000");
});

app.listen(5000, "0.0.0.0", () => {
  logger.info("HTTP server running on port 5000");
});

// setInterval(async () => {
//   if (readingBuffer.length === 0) return;

//   const batch = readingBuffer.splice(0, BULK_SAVE_LIMIT);

//   try {
//     await SensorReading.insertMany(batch, { ordered: false });
//   } catch (err) {
//     console.error("❌ Bulk insert failed:", err.message);
//   }
// }, 200); // flush every 200ms
