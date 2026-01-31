require("dotenv").config();
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
const path = require("path");
const axios = require('axios');
const { spawn } = require('child_process');

const app = express();
const connectedDevices = new Map();
app.use(bodyParser.json());
const cors = require("cors");
app.use(cors());


const logStreams = {};

// ===================== DEBUG SYSTEM =====================

// const debug = {
//   enabled: false,
//   lastPacketTime: null,
//   packetCount: 0,
//   errorCount: 0,
//   bufferStats: {
//     totalBytes: 0,
//     discardedBytes: 0,
//     malformedPackets: 0
//   },

//   // Loging timestamp and context message
//   log: (message, context = '') => {
//     if (!debug.enabled) return;
//     const timestamp = getFormattedDateTime();
//     console.log(`🔍 [${timestamp}] ${message}`, context ? `| ${context}` : '')
//   },

//   // Error Logging
//   error: (message, error = null) => {
//     const timestamp = getFormattedDateTime();
//     console.log(`❌ [${timestamp}] ${message}`, error ? `| Error: ${error.message}` : '')
//     debug.errorCount++;
//   },

//   // Stats
//   stats: () => {
//     const now = new Date();
//     const uptime = process.uptime();
//     const stats = {
//       serverTime: getFormattedDateTime(),
//       upTime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
//       packetReceived: debug.packetCount,
//       errors: debug.errorCount,
//       lastPacket: debug.lastPacketTime ? `${Math.floor((now - debug.lastPacketTime) / 1000)}s ago` : 'Never',
//       bufferStats: debug.bufferStats,
//       connectedDevices: connectedDevices.size,
//       readingBufferSize: readingBuffer.length,
//       dateFunction: "getFormattedDateTime() working ✅"
//     };
//     console.log('📊 DEBUG STATS:', JSON.stringify(stats, null, 2));
//     return stats;
//   },

//   healthCheck: () => {
//     const issues = [];

//     if (!debug.lastPacketTime) {
//       issues.push("No Packets Received yet");
//     } else {
//       const timeSinceLastPacket = Date.now() - debug.lastPacketTime;
//       if (timeSinceLastPacket > 30000) {
//         issues.push(`No Packets for ${timeSinceLastPacket / 1000}s`);
//       }
//     }

//     if (debug.errorCount > 10) {
//       issues.push("High error count");
//     }

//     if (debug.bufferStats.malformedPackets > debug.packetCount * 0.5) {
//       issues.push("High malformed packet rate");
//     }

//     return {
//       status: issues.length === 0 ? "HEALTHY" : "ISSUES",
//       serverTime: getFormattedDateTime(),
//       issues: issues
//     };
//   }
// };


// 🔌 DB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));




// ===================== HTTP API Endpoints (unchanged) =====================
/* When a GET request is made to "/ping", it will attempt to ping the MongoDB database using Mongoose. 
   If the ping is successful, it will respond with "pong". If the ping fails, it will log an error message and
   respond with "MongoDB unreachable" along with a status code of 500. 
*/
app.get("/ping", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.send("pong");
  } catch (e) {
    console.error("⚠️ /ping DB check failed:", e.message);
    res.status(500).send("MongoDB unreachable");
  }
});

// ✅ Login route (admin hardcoded via .env)
/* It is checking if the provided username and password in the request body match the admin username and password stored in the
   environment variables. If the credentials match, it generates a JSON Web Token (JWT) with the
   username "admin" and role "admin" and sends it back in the response along with the role "admin". 
*/
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  // Admin login
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign(
      { username: "admin", role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
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
    { expiresIn: "2h" }
  );

  res.json({ role: user.role, token }); // ✅ return role and token
});

// *====================  USER API  ========================
// ✅ Register new user
app.post("/api/register-user", async (req, res) => {
  const { username, password, role } = req.body;

  if (!["admin", "block", "gp", "user"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
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
    res.json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: "Error creating user" });
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
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ✅ Edit User
app.put("/api/user/:id", async (req, res) => {
  try {
    const { username, password, adminPassword } = req.body;
    if (adminPassword !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    // Finding User from DB with ID came from frontend
    const user = await User.findById(req.params.id);

    // Setting new Details of User in "UpdateField"
    const updateFields = {};
    updateFields.username = username;

    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10); // Hashing new Password
      updateFields.password = hashedPassword;
    }

    // Updating User Details
    const updatedDevice = await User.findOneAndUpdate(
      user,
      { $set: updateFields },
      { new: true }
    );

    if (!updatedDevice)
      return res.status(404).json({ error: "User not found" });
    res.json(updatedDevice);
  } catch (error) {
    console.error("Error updating device:", error);
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
    console.error("Error updating User:", error);
    res.status(500).json({ error: "Server error while updating device" });
  }
});
// *====================  USER API  ========================


// *====================  DEVICE API  ====================== 
// ✅ Register new device
app.post("/api/register-device", async (req, res) => {
  const { mac, locationId, address, latitude, longitude, ipCamera } = req.body;
  try {
    const normalizedMac = mac.toLowerCase(); //! Converting to LowerCase()
    let parsedCamera = ipCamera;

    if (ipCamera && typeof ipCamera === 'string') {
      const [camType, camIP] = ipCamera.split(',');
      parsedCamera = {
        type: camType,
        ip: camIP.trim()
      }
    }

    console.log("Parsed Camera: ", parsedCamera);
    const device = new Device({
      mac: normalizedMac, //! Converting to LowerCase()
      locationId,
      address,
      latitude,
      longitude,
      ipCamera: parsedCamera || "",
    });
    await device.save();
    res.json({ message: "Device registered successfully" });
  } catch (err) {
    res.status(500).json({ error: "Error registering device" });
  }
});

// ✅ Get registered device metadata
app.get("/api/devices-info", async (req, res) => {
  try {
    const devices = await Device.find().sort({ locationId: -1 }); // includes ipCamera
    /* NEW ADDED */
    const normalizedDevices = devices.map(device => ({
      ...device._doc,
      mac: device.mac.toLowerCase() //! Converting to LowerCase()
    }));
    res.json(normalizedDevices); //! Converting to LowerCase()
  } catch (err) {
    res.status(500).json({ error: "Error fetching devices" });
  }
});

// ✅ Get connected MACs
app.get("/api/devices", (req, res) => {
  res.json(Array.from(connectedDevices.keys()).map(mac => mac.toLowerCase())); //! Converting to LowerCase()
});

// ✅ Update device by MAC
app.put("/api/device/:mac", async (req, res) => {
  try {
    /* NEW ADDED*/
    const mac = req.params.mac.toLowerCase(); //! Converting to LowerCase()
    const { password, ...updateFields } = req.body;

    if (updateFields.locationId && updateFields.locationId.length > 17)
      return res
        .status(400)
        .json({ error: "Location ID must be 17 characters or fewer" });

    if (password !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    if (updateFields.ipCamera && typeof updateFields.ipCamera === 'string') {
      const [camType, camIP] = updateFields.ipCamera.split(',');
      updateFields.ipCamera = {
        type: camType,
        ip: camIP
      }

    }

    const updatedDevice = await Device.findOneAndUpdate(
      { mac },
      { $set: updateFields },
      { new: true }
    );
    if (!updatedDevice)
      return res.status(404).json({ error: "Device not found" });
    res.json(updatedDevice);
  } catch (error) {
    console.error("Error updating device:", error);
    res.status(500).json({ error: "Server error while updating device" });
  }
});

//! Have to check this API
// ✅ Deleting device by MAC
app.post("/api/device/delete/:mac", async (req, res) => {
  const { password } = req.body;

  // Converting MAC to LowerCase()
  const mac = req.params.mac.toLowerCase();

  if (password !== process.env.ADMIN_PASSWORD)
    return res
      .status(403)
      .json({ error: "Unauthorized: Invalid admin password" });
  try {
    const result = await Device.deleteOne({ mac: mac });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "Device not found" });
    res.json({ message: "Device deleted successfully" });
  } catch (err) {
    console.error("Error deleting device:", err);
    res.status(500).json({ error: "Error deleting device" });
  }
});

// ✅ Get only registered MACs
app.get("/api/all-devices", async (req, res) => {
  try {
    const devices = await Device.find({}, "mac");
    res.json(devices.map((d) => d.mac.toLowerCase())); //! Converting to LowerCase()
  } catch (error) {
    console.error("Error fetching registered devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// ✅ Get latest reading by MAC
app.get("/api/device/:mac", async (req, res) => {
  try {
    const normalizedMac = req.params.mac.toLowerCase(); //! Converting to LowerCase()
    const latest = await SensorReading.findOne({ mac: normalizedMac }).sort({
      timestamp: -1,
    });
    if (!latest) return res.status(404).json({ message: "No data found" });
    res.json(latest);
  } catch (err) {
    console.error("Error fetching device data:", err.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});
// *====================  DEVICE API  ====================== 


// *==================== SNAPSHOTS API =====================
// ✅ Serve snapshot images
app.get("/api/snapshots/:imageName", (req, res) => {
  try {
    const imageName = req.params.imageName;
    const rawMac = req.query.mac;
    const macSuffix = rawMac.slice(8).replace(/[. ]/g, "_"); // Gets characters 9-16 (0-indexed)

    const imagePath = path.join(`${snapshotOutputDir}/${macSuffix}`, imageName);

    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "Image not found" });
    }

    // Send the image file
    res.sendFile(imagePath);
  } catch (err) {
    console.error("Error reading snapshots:", err);
    res.status(500).json({ error: "Failed to read snapshots" });
  }
});

// ✅ Get list of available snapshots
app.get("/api/snapshots", (req, res) => {
  try {
    const rawMac = req.query.mac;

    // Validate MAC address exists
    if (!rawMac) {
      return res.status(400).json({ error: "MAC address is required" });
    }

    // Extract the last part of MAC 
    const macSuffix = rawMac.slice(8).replace(/[. ]/g, "_"); // Gets characters 9-16 (0-indexed)
    // console.log("MAC ADDRESS: ", macSuffix);

    const snapshotsDir = `${snapshotOutputDir}/${macSuffix}`;
    let files = [];
    try {
      files = fs
        .readdirSync(snapshotsDir)
        .filter((file) => /\.(jpg|jpeg|png|gif)$/i.test(file))
        // Sorting images in descending order based on timestamp in filename
        .sort((a, b) => {
          // Extract YYMMDDHHMMSS format for comparison
          const getKey = (filename) => {
            const match = filename.match(/_(\d{2})_(\d{2})_(\d{2})_(\d{2}f)_(\d{2})_(\d{2})\./);
            return match ? match[3] + match[2] + match[1] + match[4] + match[5] + match[6] : '0';
          };
          return getKey(b).localeCompare(getKey(a));
        })
        .slice(0, 15); // Get last 15 images
    } catch (dirErr) {
      console.error("Snapshots directory not found or error reading:", dirErr.message);
      // Return empty array if directory not found
      files = [];
    }
    res.json(files);
  } catch (err) {
    console.error("Error reading snapshots:", err);
    res.status(500).json({ error: "Failed to read snapshots" });
  }
});
// *==================== SNAPSHOTS API =====================


// ✅ Command endpoint
app.post("/command", (req, res) => {
  const { mac, command } = req.body;
  const normalizedMac = mac.toLowerCase(); //! Converting to LowerCase()
  const deviceSocket = connectedDevices.get(normalizedMac);

  if (!deviceSocket || deviceSocket.destroyed) {
    connectedDevices.delete(normalizedMac);
    return res.status(404).json({ message: `Device ${normalizedMac} not connected` });
  }

  const buffer = Buffer.from(command, "utf-8");
  deviceSocket.write(buffer, (err) => {
    if (err) {
      console.error(`Failed to send command to ${normalizedMac}:`, err.message);
      return res
        .status(500)
        .json({ message: `Error sending command to ${normalizedMac}` });
    }
    console.log(`Sent command "${command}" to ${normalizedMac}`);
    res.json({ message: `${command} sent to ${normalizedMac}` });
  });
});

// ✅ Get last 100 readings
app.get("/api/readings", async (req, res) => {
  try {
    const readings = await SensorReading.find()
      .sort({ timestamp: -1 })
      .limit(200);
    res.json(readings);
  } catch (error) {
    console.error("Error fetching readings:", error);
    res.status(500).json({ error: "Failed to fetch readings" });
  }
});

// // Super simple test API
// app.get("/api/alarms-test", async (req, res) => {
//   try {
//     // Simple aggregation - get latest per device
//     const results = await SensorReading.aggregate([
//       { $sort: { timestamp: -1 } },
//       {
//         $group: {
//           _id: "$mac",
//           mac: { $first: "$mac" },
//           hasAnyAlarm: {
//             $first: {
//               $or: [
//                 { $eq: ["$fireAlarm", 1] },
//                 { $eq: ["$waterLogging", true] },
//                 { $eq: ["$lockStatus", "OPEN"] },
//                 { $eq: ["$insideTemperatureAlarm", true] }
//               ]
//             }
//           }
//         }
//       },
//       { $limit: 5 }
//     ]);

//     res.json({
//       test: "Alarm computation working",
//       devices: results
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// ✅ Get logs saved in PC
app.post("/api/log-command", (req, res) => {
  console.log("Log API Called");
  const { date, mac, command, status, message } = req.body;

  console.log(date, mac, command, status, message);

  const now = new Date();
  const fileName = `${now.getDate()}_${now.getMonth() + 1
    }_${now.getHours()}.out`;
  // const outLogDir = "C:/CommandLogs/out";

  // if (!fs.existsSync(outLogDir)) {
  //   fs.mkdirSync(outLogDir, { recursive: true });
  // }

  const filePath = path.join(logDir, fileName);
  const timestamp = now.toLocaleString();
  const logEntry = `[${timestamp}] | MAC:${mac} | ${status}  | COMMAND:"${command}" | MESSAGE:"${message}"\n`;

  // ✅ Send response immediately, log in background
  res.json({ message: "Log received" });

  // File writing happens after response
  // fs.appendFile(filePath, logEntry, (err) => {
  //   if (err) {
  //     console.error("Failed to save log:", err);
  //   } else {
  //     if (eMS_LOGS) console.log(`✅ Log saved: ${filePath}`);
  //   }
  // });

  writeLog(
    `${filePath}`,
    logEntry
  );

});

app.get("/api/historical-data", async (req, res) => {
  const { mac, datetime } = req.query;
  if (!mac || !datetime)
    return res.status(400).json({ error: "Missing mac or datetime" });
  const normalizedMac = mac.toLowerCase(); //! Converting to LowerCase()
  const datetimeObj = new Date(datetime);
  if (isNaN(datetimeObj.getTime()))
    return res.status(400).json({ error: "Invalid datetime format" });
  const selectedDate = new Date(datetimeObj);
  selectedDate.setHours(0, 0, 0, 0);
  const nextDate = new Date(selectedDate);
  nextDate.setDate(nextDate.getDate() + 1);
  try {
    const readings = await SensorReading.find({
      mac: normalizedMac,
      timestamp: { $gte: selectedDate, $lt: nextDate },
    }).sort({ timestamp: 1 });
    const atSelectedTime = await SensorReading.findOne({
      mac: normalizedMac,
      timestamp: { $lte: datetimeObj },
    }).sort({ timestamp: -1 });
    res.json({ readings, atSelectedTime });
  } catch (err) {
    console.error("Historical data error:", err.message);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

// ✅ Debug routes
// app.use('/debug', require('./auth/debug'));


// 📡 TCP Server
const BULK_SAVE_LIMIT = 1000;
let readingBuffer = [];
let alreadyReplied = 0;

const eMS_LOGS = process.env.eMS_LOGS === "true";
console.log(`[BOOT] eMS_LOGS is`, eMS_LOGS);

const INC_LOGS_CMD = process.env.INC_LOGS_CMD === "true";
const OUT_LOGS_CMD = process.env.OUT_LOGS_CMD === "true";
const ALARM_LOGS_CMD = process.env.ALARM_LOGS_CMD === "true";
const SNAP_CMD = process.env.SNAP_CMD === "true";

const IncLogDir = process.env.INC_LOG_DIR;
const outLogDir = process.env.OUT_LOG_DIR;
const alarmLogDir = process.env.ALARM_LOG_DIR;
const snapshotOutputDir = process.env.SNAP_DIR;


function dirCheck(dir, enabled) {
  if (!enabled) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create dir ${dir}:`, err.message);
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
function getFormattedDateTime(outType = 'string') {
  // Pass any string to function if you want output in second way
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dd = pad(today.getDate());
  const mm = pad(today.getMonth() + 1);
  const yy = String(today.getFullYear()).slice(-2);
  const HH = pad(today.getHours());
  const MM = pad(today.getMinutes());
  const SS = pad(today.getSeconds());

  if (outType === 'string') {
    return `${dd}/${mm}/${yy} ${HH}:${MM}:${SS}`;
  } else {
    return `${dd}_${mm}_${yy}_${HH}_${MM}_${SS}`;
  }
}

function sendX(socket) {
  const msg = `%X000${getFormattedDateTime()}$`;
  console.log(`⬅️ Sending back: ${msg}`);
  const ok = socket.write(msg);
  if (!ok) {
    console.warn("⚠️ Backpressure: socket buffer is full, write queued");
  }
}

// *=================================== CLEANING CODE ===================================
// Function to delete DB Records
async function DBCleanup() {
  try {
    const MAX_DOCS = parseInt(process.env.MAX_SENSOR_DOCS || '50000', 10);
    // const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '15', 10);

    // 1) Time-based retention purge
    // const retentionCutoff = new Date(Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000));
    // const retentionRes = await SensorReading.deleteMany({
    //   timestamp: { $lt: retentionCutoff }
    // });
    // if (retentionRes.deletedCount) {
    //   debug.log(`Retention purge: deleted ${retentionRes.deletedCount} docs older than ${RETENTION_DAYS} days`, 'CLEANUP');
    // }

    // Getting 'SensorReading' count
    const sensorRecordsCount = await SensorReading.countDocuments();
    if (sensorRecordsCount === 0) {
      console.log("No Sensor Data found", 'CLEANUP');
      return;
    }


    if (sensorRecordsCount > MAX_DOCS) {
      // Getting the boundary Document of SensorReading to delete all documents before from that bounday date
      const boundaryDoc = await SensorReading
        .findOne({}, { timestamp: 1 })
        .sort({ timestamp: -1 }) // Latest Doc first
        .skip(MAX_DOCS - 1);

      if (!boundaryDoc || !boundaryDoc.timestamp) {
        console.error("Unable to determine boundary timestamp for capping", 'CLEANUP');
        return;
      }

      // Deleting Documents
      const capRes = await SensorReading.deleteMany({
        timestamp: { $lt: boundaryDoc.timestamp }
      });
      if (eMS_LOGS) console.log(`Count capping: deleted ${capRes.deletedCount} docs older than ${boundaryDoc.timestamp.toISOString()}`, 'CLEANUP');
    }
  } catch (err) {
    console.error("Error in DB cleanup", err);
  }
}

// Cleaning up DB hourly
function hourlyDBCleanup() {
  let isCleaning = false;

  const runCleanup = async () => {
    if (isCleaning) {
      if (eMS_LOGS) console.log("Cleanup already running, skipping this tick", 'CLEANUP');
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

// Function to delete log files older than 3 days
function deleteLogFiles() {
  // const IncLogDir = "C:/CommandLogs/inc";

  const daysThreshold = 3;
  const thresholdTime = Date.now() - (daysThreshold * 24 * 60 * 60 * 1000);

  fs.readdir(IncLogDir, (err, files) => {
    if (err) {
      // If directory doesn't exist, that's fine - nothing to delete
      if (err.code === 'ENOENT') return;
      console.error(`⚠️ Error reading log directory: ${err}`);
      return;
    }

    files.forEach(filename => {
      if (!filename.endsWith('.inc')) return;

      const filePath = path.join(IncLogDir, filename);

      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`⚠️ Error getting stats for ${filename}: ${err}`);
          return;
        }

        // Check if file is older than threshold
        if (stats.mtimeMs < thresholdTime) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`⚠️ Error deleting ${filename}: ${err}`);
            } else {
              console.log(`✅ ${filename} successfully deleted ✅`);
            }
          });
        }
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
      flags: "a" // append mode
    });

    logStreams[filePath].on("error", (err) => {
      console.error("Log stream error:", err.message);
    });
  }

  return logStreams[filePath];
}

function writeLog(filePath, data) {
  const stream = getLogStream(filePath);
  stream.write(data + "\n");
}


const server = net.createServer((socket) => {
  // let buffer = Buffer.alloc(0);
  socket.buffer = Buffer.alloc(0);


  const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;
  const connStart = Date.now();
  if (eMS_LOGS) {
    console.log(`[LOG] New TCP Connection from ${clientInfo} at ${new Date(connStart).toISOString()}`);
    // console.log(`[LOG] New TCP Connection from ${clientInfo} at ${new Date(connStart).toISOString()}`);
  }
  console.log(`New TCP Connection from`, clientInfo);

  socket.on("data", async (data) => {
    let packetCount = 0;
    const dataStart = Date.now();
    // buffer = Buffer.concat([buffer, data]);
    socket.buffer = Buffer.concat([socket.buffer, data]);
    const PACKET_LEN = 58;


    // let mac = null;
    try {
      // console.packetCount++;
      // debug.lastPacketTime = Date.now();
      // debug.bufferStats.discardedBytes.totalBytes += data.length;

      console.log(`Raw data received ${data.toString('hex')} with length (${data.length} bytes) from`, clientInfo);
      // console.log(`Raw data hex preview:`, data.toString('hex').substring(0, 100) + '...');

      // buffer = Buffer.concat([buffer, data]);
      // console.log(`Total buffer size: ${buffer.length} bytes`);

      // let mac = null;
      while (socket.buffer.length >= 58) {
        packetCount++;
        // const packet = socket.buffer.slice(0, PACKET_LEN);

        // console.log(`[eMS_LOGS] Parsing packet #${packetCount} in this data event, buffer.length=${buffer.length}`);

        // if (buffer.length < 4) break;

        // const b0 = socket.buffer[0];
        // const b1 = socket.buffer[1];
        // const b2 = socket.buffer[2];
        // const b3 = socket.buffer[3];


        // // invalid / garbage header → resync exactly like MAC
        // if (
        //   b0 === 0 || b0 === 255 ||           // invalid first octet
        //   b1 === undefined || b2 === undefined || b3 === undefined
        // ) {
        //   socket.buffer = socket.buffer.slice(1);
        //   continue;
        // }

        // Handle protocol preamble once after device restart
        if (!socket.preambleHandled && socket.buffer.length >= 4) {
          const preamble = socket.buffer.slice(0, 4).toString('ascii');
          if (preamble === 'tcp2') {
            socket.buffer = socket.buffer.slice(4);
            socket.preambleHandled = true;
          }
        }

        const header = socket.buffer.slice(0, 8).toString('ascii');

        if (!/^[0-9a-fA-F]{8}$/.test(header)) {
          // corrupted / misaligned packet → resync like MAC server
          socket.buffer = socket.buffer.slice(1);
          continue;
        }

        const ipHexAscii = socket.buffer.slice(0, 8).toString('ascii');

        // Convert hex pairs → decimal
        const ip = ipHexAscii
          .match(/.{2}/g)
          .map(h => parseInt(h, 16))
          .join('.');

        console.log("EXTRACTED IP: ", ip);

        // wait for full packet
        if (socket.buffer.length < 58) break;

        const packet = socket.buffer.slice(0, 58);
        socket.buffer = socket.buffer.slice(58);

        // const ip = `${packet[0]}.${packet[1]}.${packet[2]}.${packet[3]}`;

        //! =============== CODE FOR MAC CHECKING =============== 
        // const bufStr = buffer.toString("utf-8");

        // // Search for first valid MAC pattern in buffer string
        // const macPattern = /[0-9]{3}(.[0-9]{3})(.[0-9]{1})(.[0-9]{3})/;
        // const match = bufStr.match(macPattern);

        // if (!match) {
        //   console.warn(
        //     `No IP found in buffer, discarding ${buffer.length} bytes`
        //   );
        //   buffer = Buffer.alloc(0);
        //   break;
        // }

        // const macStartIndex = bufStr.indexOf(match[0]);

        // if (macStartIndex > 0) {
        //   console.warn(`Discarding ${macStartIndex} bytes of junk before MAC`);
        //   buffer = buffer.slice(macStartIndex);
        //   continue;
        // }

        // if (socket.buffer.length < 58) {
        //   // Wait for more data for complete packet
        //   break;


        // Extract one full packet starting at MAC
        // const packet = buffer.slice(0, 58);

        // const macRaw = packet.subarray(0, 17);
        // let macRawStr = macRaw.toString("utf-8");
        // console.log(
        //   `Received MAC: [${macRawStr}], length: ${macRawStr.length}`
        // );

        // Sanitize and verify MAC
        // const sanitizedMac = macRawStr.replace(/[^0-9A-Fa-f:]/g, "");
        // const macRegex = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
        // if (sanitizedMac.length !== 17 || !macRegex.test(sanitizedMac)) {
        //   console.warn(`⚠️ Dropping malformed MAC: INVALID_${Date.now()}`);
        //   buffer = buffer.slice(58);
        //   continue;
        // }
        //! =============== CODE FOR MAC CHECKING =============== 


        // console.log("Extracted IP: ", extractedIP);
        const mac = ip; //! Converting to LowerCase()
        const humidity = +packet.readFloatLE(17).toFixed(2);
        const insideTemperature = +packet.readFloatLE(21).toFixed(2);
        const outsideTemperature = +packet.readFloatLE(25).toFixed(2); // "+" converts string to number as toFixed return string

        const lockStatus = packet[29] === 1 ? "OPEN" : "CLOSED";
        const doorStatus = packet[30] === 1 ? "OPEN" : "CLOSED";
        const waterLogging = !!packet[31]; // "!!" -> converts true/false to 1/0
        const waterLeakage = !!packet[32];

        const outputVoltage = +packet.readInt16LE(33).toFixed(2);
        const hupsDVC = packet.readInt16LE(35);
        const inputVoltage = +packet.readInt16LE(37).toFixed(2);
        const hupsBatVolt = packet.readInt16LE(39);
        const batteryBackup = +packet.readFloatLE(41).toFixed(2);

        const alarmActive = !!packet[45];
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

        // Getting HUPS Alarms
        const hupsAlarms = []
        /* 
            Extracting Individual HUPS Alarms from 'hupsStat' using bitwise operations. 
            Each alarm is represented by a single bit within the 'hupsStat' integer. 
            The loop iterates 8 times (for 8 alarms), extracting each bit and 
            storing the alarm status in the 'hupsAlarms' array.
        */
        for (let i = 0; i < 8; i++) {
          hupsAlarms[i] = (hupsStat >> (i) & 0x01);
        }

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


        if (padding === 0x31 && !alreadyReplied) {
          sendX(socket);
          alreadyReplied = 40; // Load Balancing
        }


        // Snapshot Capture Code
        if ((padding === 0x43) && (doorStatus === "OPEN")) {
          // if (true) {
          let timestamp = getFormattedDateTime("path");
          const snapshotFileName = `image_${timestamp}.jpg`;


          /* 
            Function that captures snapshots from Hi-Focus and Sparsh Cameras. 
          */
          try {
            // console.log("Padding: ", padding)
            if (eMS_LOGS) console.log("⚡Camera Function runs ...⚡")
            const cameraDetails = await Device.findOne({ mac }, 'ipCamera').lean();
            const cameraMake = cameraDetails.ipCamera.type.trim();
            if (eMS_LOGS) console.log("Camera Make: ", cameraMake);

            if (cameraMake === 'H') {
              console.log("⏰ Snapshot for HiFocus Camera ⏰");

              const ip = cameraDetails.ipCamera.ip.trim();
              const snapshotOutputDir_MAC = path.join(snapshotOutputDir, mac.slice(8).replace(/[: ]/g, '_'));

              // Using ffmpeg to capture snapshot from the HI-Focus Camera
              const args = [
                '-rtsp_transport', 'tcp',
                '-i', `rtsp://${ip}/media/video1`,
                '-frames:v', '1',
                `${snapshotOutputDir_MAC}/${snapshotFileName}`
              ];

              const ffmpeg = spawn('ffmpeg', args);

              ffmpeg.on('close', (code) => {
                if (code === 0) {
                  if (eMS_LOGS) console.log("Captured successfully...");
                } else {
                  console.error(`ffmpeg process exited with code ${code}`);
                }
              });

            } else {
              console.log("⏰ Snapshot for Sparsh Camera ⏰");

              console.log("Timestamp: ", timestamp);

              // Extracting Camera IP from DB for Sparsh Camera
              let camIP = cameraDetails.ipCamera.ip.trim();

              // Added 3 seconds delay for first snapshot capture to wait for opening the door 
              setTimeout(() => {
                let url = `https://${camIP}/CGI/command/snap?channel=01`;
                console.log("📸 Capturing from URL:", url);

                const snapshotOutputDir_MAC = path.join(snapshotOutputDir, mac.slice(8).replace(/[. ]/g, '_'));
                const snapshotOutputPath = path.join(snapshotOutputDir_MAC, snapshotFileName);

                if (eMS_LOGS) console.log("🔴outputDir: ", snapshotOutputDir, "🔴");

                try {
                  if (!fs.existsSync(snapshotOutputDir)) {
                    fs.mkdirSync(snapshotOutputDir, { recursive: true });
                    console.log(`📁 Created directory: ${snapshotOutputDir}`);
                  }
                } catch (err) {
                  console.error(`❌ Failed to create directory ${snapshotOutputDir}:`, err.message);
                }

                axios({
                  method: 'GET',
                  url: url,
                  responseType: 'stream',
                  timeout: 10000
                })
                  .then((response) => {
                    const writer = fs.createWriteStream(snapshotOutputPath);
                    response.data.pipe(writer);

                    return new Promise((resolve, reject) => {
                      writer.on('finish', resolve);
                      writer.on('error', reject);
                    });
                  })
                  .then(() => {
                    if (eMS_LOGS) console.log(`✅ Snapshot captured: ${snapshotFileName}`);
                  })
                  .catch((error) => {
                    console.error(`❌ Error capturing snapshot: ${error.message}`);
                  });
              }, 3000); // 3 second delay
            }
          } catch (err) {
            console.error(`Error occured while caputuring snapshots: ${err}`)
          }
        }


        // ===================== Logging Incoming Data from Simulator =====================
        if (INC_LOGS_CMD) {
          const now = new Date();
          const fileName = `${now.getDate()}_${now.getMonth() + 1
            }_${now.getHours()}.inc`;

          // const sensorData = {
          //   humidity: humidity,
          //   insideTemperature: insideTemperature,
          //   outsideTemperature: outsideTemperature,
          //   inputVoltage: inputVoltage,
          //   outputVoltage: outputVoltage,
          //   batteryBackup: batteryBackup,
          // };

          const IncLogFilePath = path.join(IncLogDir, fileName);
          const timestamp = now.toLocaleString();
          const IncLogEntry = `[${timestamp}] | MAC:${mac} | Humid=${humidity} | IT=${insideTemperature} | OT=${outsideTemperature} | IV=${inputVoltage} | OV=${outputVoltage} | BB=${batteryBackup}`;

          // File writing happens after response
          // fs.appendFile(IncLogFilePath, IncLogEntry, (err) => {
          //   if (err) {
          //     console.error("Failed to save log:", err);
          //   } else {
          //     if (eMS_LOGS) console.log(`✅ Log saved: ${IncLogFilePath}`);
          //   }
          // });

          writeLog(
            `${IncLogFilePath}`,
            IncLogEntry
          );

        }
        // ===================== Logging Incoming Data from Simulator =====================



        if (alreadyReplied) alreadyReplied--;

        // Extracting Fans Status
        console.log("fanStatus", fanStatusBits);


        console.log("Password Bit: ", pwsFailCount)// <-- Critical offset //Password

        const floats = [
          humidity,
          insideTemperature,
          outsideTemperature,
          outputVoltage,
          inputVoltage,
          batteryBackup,
        ];

        if (floats.some((val) => isNaN(val) || Math.abs(val) > 100000)) {
          console.warn(`⚠️ Skipping packet from ${mac}: bad float value(s)`);
          // buffer = buffer.slice(58);
          // continue;
        }

        if (Math.random() < 0.01) {
          if (eMS_LOGS) console.log(
            `📡 ${mac} | Temp: ${insideTemperature}°C | Humidity: ${humidity}% | Voltage: ${inputVoltage}V | Fan stat=${fanStatusBits.toString(
              16
            )}h`
          );
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

        const activeAlarms = [];

        if (thresholdAlarms.insideTemperatureAlarm) {
          activeAlarms.push(`Inside Temperature: ${insideTemperature}`);
        }
        if (thresholdAlarms.outsideTemperatureAlarm) {
          activeAlarms.push(`Outside Temperature: ${outsideTemperature}`);
        }
        if (thresholdAlarms.humidityAlarm) {
          activeAlarms.push(`Humidity: ${humidity}`);
        }
        if (thresholdAlarms.inputVoltageAlarm) {
          activeAlarms.push(`Input Voltage: ${inputVoltage}`);
        }
        if (thresholdAlarms.outputVoltageAlarm) {
          activeAlarms.push(`Output Voltage: ${outputVoltage}`);
        }
        if (thresholdAlarms.batteryBackupAlarm) {
          activeAlarms.push(`Battery Backup: ${batteryBackup}`);
        }

        if (waterLogging) {
          activeAlarms.push("Water Logging Alarm");
        }

        if (waterLeakage) {
          activeAlarms.push("Water Leakage Alarm");
        }

        if (doorStatus) {
          activeAlarms.push("Door Alarm");
        }

        if (lockStatus) {
          activeAlarms.push("Lock Alarm");
        }

        if (fireAlarm) {
          activeAlarms.push("Fire Alarm");
        }

        // Single console output
        if (activeAlarms.length > 0) {
          // const alarmLogDir = "C:/CommandLogs/alarm"

          // if (!fs.existsSync(alarmLogDir)) {
          //   fs.mkdirSync(alarmLogDir, { recursive: true });
          // }

          const now = new Date();
          const timestamp = now.toLocaleString();

          const alarmFileName = `${now.getDate()}_${now.getMonth() + 1
            }_${now.getHours()}_Alarm.inc`;

          if (fanStatus.includes(2)) {
            var logAlarm = `[${timestamp}] | MAC: ${mac}| ${activeAlarms} | Fan Status: ${fanStatus}\n`;
          } else {
            var logAlarm = `[${timestamp}] | MAC: ${mac}| ${activeAlarms}\n`;
          }

          const alarmFilePath = path.join(alarmLogDir, alarmFileName);

          // fs.appendFile(alarmFilePath, logAlarm, (err) => {
          //   if (err) {
          //     console.error("Failed to save log:", err);
          //   } else {
          //     if (eMS_LOGS) console.log(`✅ Log saved: ${alarmFilePath}`);
          //   }
          // });

          writeLog(
            `${alarmFilePath}`,
            logAlarm
          );
        }

        socket.deviceId = mac;
        connectedDevices.set(mac, socket);

        // Build and save the reading (fan status is now independent, not derived)
        const reading = new SensorReading({
          mac,
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
          pwsFailCount, // keep for legacy (optional)
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
          timestamp: packetTimestamp
        });

        // readingBuffer = readingBuffer.filter(r => r.mac !== mac);
        readingBuffer.push(reading);
        console.log(`[BUFFER] pushed reading; readingBuffer.length=${readingBuffer.length}`);
        console.log(`[eMS_LOGS] Finished parsing packet for MAC: ${mac}`);

        if (readingBuffer.length >= BULK_SAVE_LIMIT) {
          const toSave = [...readingBuffer];
          readingBuffer = [];
          SensorReading.insertMany(toSave)
            .catch((err) =>
              console.error("Bulk save error:", err.message)
            );

          buffer = buffer.slice(58);
        }

        // setImmediate(async () => {
        //   if (readingBuffer.length >= BULK_SAVE_LIMIT) {
        //     const batch = readingBuffer.splice(0);
        //     await SensorReading.insertMany(batch, { ordered: false });
        //   }
        // });

        socket.buffer = socket.buffer.slice(PACKET_LEN);

        debugger;
        if (eMS_LOGS) console.log(`✅ Packet processed successfully for MAC: ${mac}`, `Time: ${getFormattedDateTime()}`);
      }
    } catch (err) {
      console.error("Packet parsing failed:", err.message);
      socket.destroy();
    }
  });

  socket.on("end", () => {
    for (const [mac, sock] of connectedDevices.entries()) {
      if (sock === socket) {
        connectedDevices.delete(socket.deviceId);
        console.log(`Device ${mac} disconnected`);
      }
    }
  });

  socket.on("error", (err) => {
    if (err.code !== "ECONNRESET") {
      console.error("Socket error:", err.message);
    }
  });


  setInterval(() => {
    if (readingBuffer.length > 0) {
      const toSave = [...readingBuffer];
      readingBuffer = [];
      SensorReading.insertMany(toSave)
        .then((docs) => {
          docs.forEach(doc => {
            console.log(`✅ Saved reading in DB (periodic): MAC=${doc.mac}, timestamp=${doc.timestamp}`);
          });
        })
        .catch((err) =>
          console.error("Periodic bulk save error:", err.message)
        );
    }
  }, 5000);

});

server.listen(4000, "0.0.0.0", () => {
  console.log("TCP server listening on port 4000");
});

app.listen(5000, "0.0.0.0", () => {
  console.log("HTTP server running on port 5000");
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


