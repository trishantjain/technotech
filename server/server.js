require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Device = require('./models/Device');
const net = require('net');
const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const SensorReading = require('./SensorReading');
const thresholds = require('./thresholds');

const app = express();
const connectedDevices = new Map();
app.use(bodyParser.json());
const cors = require('cors');
app.use(cors());

// 🔌 DB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err.message));

// --------------- HTTP API Endpoints (unchanged) ---------------
app.get('/ping', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.send('pong');
  } catch (e) {
    console.error('⚠️ /ping DB check failed:', e.message);
    res.status(500).send('MongoDB unreachable');
  }
});
// ✅ Login route (admin hardcoded via .env)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  // Admin login
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign(
      { username: 'admin', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    return res.json({ role: 'admin', token });
  }

  // User login from DB
  const user = await User.findOne({ username: username });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );

  res.json({ role: user.role, token }); // ✅ return role and token
});


// ✅ Register new user
app.post('/api/register-user', async (req, res) => {
  const { username, password, role } = req.body;

  if (!['admin', 'block', 'gp', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10); // ✅ hash password
    const user = new User({
      username: username.toLowerCase(),
      password: hashedPassword,
      role
    });
    await user.save();
    res.json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Error creating user' });
  }
});


// ✅ Register new device
app.post('/api/register-device', async (req, res) => {
  const { mac, block, panchayat, latitude, longitude, ipCamera } = req.body; // ⬅️ include ipCamera

  try {
    const device = new Device({
      mac,
      block,
      panchayat,
      latitude,
      longitude,
      ipCamera: ipCamera || '' // ⬅️ Optional
    });
    await device.save();
    res.json({ message: 'Device registered successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Error registering device' });
  }
});



// ✅ Get registered device metadata
app.get('/api/devices-info', async (req, res) => {
  try {
    const devices = await Device.find(); // includes ipCamera
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching devices' });
  }
});


// ✅ Delete device by MAC
app.delete('/api/device/:mac', async (req, res) => {
  try {
    await Device.deleteOne({ mac: req.params.mac });
    res.json({ message: 'Device deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting device' });
  }
});

// ✅ Command endpoint
app.post('/command', (req, res) => {
  const { mac, command } = req.body;
  const deviceSocket = connectedDevices.get(mac);

  if (!deviceSocket || deviceSocket.destroyed) {
    connectedDevices.delete(mac);
    return res.status(404).json({ message: `Device ${mac} not connected` });
  }

  const buffer = Buffer.from(command, 'utf-8');
  deviceSocket.write(buffer, (err) => {
    if (err) {
      console.error(`Failed to send command to ${mac}:`, err.message);
      return res.status(500).json({ message: `Error sending command to ${mac}` });
    }
    console.log(`Sent command "${command}" to ${mac}`);
    res.json({ message: `Command sent to ${mac}` });
  });
});

// ✅ Get connected MACs
app.get('/api/devices', (req, res) => {
  res.json(Array.from(connectedDevices.keys()));
});

// ✅ Get only registered MACs
app.get('/api/all-devices', async (req, res) => {
  try {
    const devices = await Device.find({}, 'mac');
    res.json(devices.map(d => d.mac));
  } catch (error) {
    console.error("Error fetching registered devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// ✅ Get last 100 readings
app.get('/api/readings', async (req, res) => {
  try {
    const readings = await SensorReading.find().sort({ timestamp: -1 }).limit(400);
    res.json(readings);
  } catch (error) {
    console.error("Error fetching readings:", error);
    res.status(500).json({ error: "Failed to fetch readings" });
  }
});

// ✅ Get latest reading by MAC
app.get('/api/device/:mac', async (req, res) => {
  try {
    const latest = await SensorReading.findOne({ mac: req.params.mac }).sort({ timestamp: -1 });
    if (!latest) return res.status(404).json({ message: 'No data found' });
    res.json(latest);
  } catch (err) {
    console.error('Error fetching device data:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.get('/api/thresholds', (req, res) => {
  res.json(thresholds);
});

// 📡 TCP Server
const BULK_SAVE_LIMIT = 1000;
let readingBuffer = [];
let alreadyReplied = 0;
function getFormattedDateTime() {
  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dd = pad(today.getDate());
  const mm = pad(today.getMonth() + 1);
  const yy = String(today.getFullYear()).slice(-2);
  const HH = pad(today.getHours());
  const MM = pad(today.getMinutes());
  const SS = pad(today.getSeconds());
  return `${dd}/${mm}/${yy} ${HH}:${MM}:${SS}`;
}
function sendX(socket) {
  const msg = `%X000${getFormattedDateTime()}$`;
  console.log(`⬅️ Sending back: ${msg}`);
  const ok = socket.write(msg);
  if (!ok) {
    console.warn("⚠️ Backpressure: socket buffer is full, write queued");
  }
}
const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);

  socket.on('data', async data => {
    console.log(`Received packet (${data.length} bytes):`, data.toString('hex'));
    buffer = Buffer.concat([buffer, data]);

    try {
      while (buffer.length >= 58) {
        const bufStr = buffer.toString('utf-8');

        // Search for first valid MAC pattern in buffer string
        const macPattern = /[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}/;
        const match = bufStr.match(macPattern);

        if (!match) {
          console.warn(`No MAC found in buffer, discarding ${buffer.length} bytes`);
          buffer = Buffer.alloc(0);
          break;
        }

        const macStartIndex = bufStr.indexOf(match[0]);

        if (macStartIndex > 0) {
          console.warn(`Discarding ${macStartIndex} bytes of junk before MAC`);
          buffer = buffer.slice(macStartIndex);
          continue;
        }

        if (buffer.length < 58) {
          // Wait for more data for complete packet
          break;
        }

        // Extract one full packet starting at MAC
        const packet = buffer.slice(0, 58);

        const macRaw = packet.subarray(0, 17);
        let macRawStr = macRaw.toString('utf-8');
        console.log(`Received MAC: [${macRawStr}], length: ${macRawStr.length}`);

        // Sanitize and verify MAC
        const sanitizedMac = macRawStr.replace(/[^0-9A-Fa-f:]/g, '');
        const macRegex = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
        if (sanitizedMac.length !== 17 || !macRegex.test(sanitizedMac)) {
          console.warn(`⚠️ Dropping malformed MAC: INVALID_${Date.now()}`);
          buffer = buffer.slice(58);
          continue;
        }

        const mac = sanitizedMac;
        const humidity = +buffer.readFloatLE(17).toFixed(2);
        const insideTemperature = +buffer.readFloatLE(21).toFixed(2);
        const outsideTemperature = +buffer.readFloatLE(25).toFixed(2);
        const lockStatus = buffer[29] === 1 ? 'OPEN' : 'CLOSED';
        const doorStatus = buffer[30] === 1 ? 'OPEN' : 'CLOSED';
        const waterLogging = !!buffer[31];
        const waterLeakage = !!buffer[32];
        const outputVoltage = +buffer.readFloatLE(33).toFixed(2);
        const inputVoltage = +buffer.readFloatLE(37).toFixed(2);
        const batteryBackup = +buffer.readFloatLE(41).toFixed(2);
        const alarmActive = !!buffer[45];
        const fireAlarm = !!buffer[46];
        const fanLevel1Running = !!buffer[47];
        const fanLevel2Running = !!buffer[48];
        const fanLevel3Running = !!buffer[49];
        const fanLevel4Running = !!buffer[50];
        const padding = buffer[51]; // unused
        if ((padding === 0x31) && (!alreadyReplied)) {
          sendX(socket);
          alreadyReplied = 40; // Load Balancing
        }
        if (alreadyReplied)
          alreadyReplied--;
        const fanStatusBits = buffer.readUInt16LE(52);
        const fanStatus = [];
        for (let i = 0; i < 6; i++) {
          fanStatus[i] = (fanStatusBits >> (i * 2)) & 0x03; // 0=off, 1=healthy, 2=faulty
        }
        console.log("fanStatus", fanStatus);

        const fanFailBits = buffer.readUInt32LE(54); // <-- Critical offset
        const floats = [
          humidity, insideTemperature, outsideTemperature,
          outputVoltage, inputVoltage, batteryBackup
        ];

        if (floats.some(val => isNaN(val) || Math.abs(val) > 100000)) {
          console.warn(`⚠️ Skipping packet from ${mac}: bad float value(s)`);
          buffer = buffer.slice(58);
          continue;
        }

        if (Math.random() < 0.01) {
          console.log(`📡 ${mac} | Temp: ${insideTemperature}°C | Humidity: ${humidity}% | Voltage: ${inputVoltage}V | Fan stat=${fanStatusBits.toString(16)}h`);
        }

        // Threshold-based alarms
        const thresholdAlarms = {
          insideTemperatureAlarm: insideTemperature > thresholds.insideTemperature.max || insideTemperature < thresholds.insideTemperature.min,
          outsideTemperatureAlarm: outsideTemperature > thresholds.outsideTemperature.max || outsideTemperature < thresholds.outsideTemperature.min,
          humidityAlarm: humidity > thresholds.humidity.max || humidity < thresholds.humidity.min,
          inputVoltageAlarm: inputVoltage > thresholds.inputVoltage.max || inputVoltage < thresholds.inputVoltage.min,
          outputVoltageAlarm: outputVoltage > thresholds.outputVoltage.max || outputVoltage < thresholds.outputVoltage.min,
          batteryBackupAlarm: batteryBackup < thresholds.batteryBackup.min
        };

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
          inputVoltage,
          batteryBackup,
          alarmActive,
          fireAlarm,
          fanLevel1Running,
          fanLevel2Running,
          fanLevel3Running,
          fanLevel4Running,
          fanFailBits,   // keep for legacy (optional)
          fan1Status: fanStatus[0],
          fan2Status: fanStatus[1],
          fan3Status: fanStatus[2],
          fan4Status: fanStatus[3],
          fan5Status: fanStatus[4],
          fan6Status: fanStatus[5],
          ...thresholdAlarms
        });

        connectedDevices.set(mac, socket);
        readingBuffer.push(reading);

        if (readingBuffer.length >= BULK_SAVE_LIMIT) {
          const toSave = [...readingBuffer];
          readingBuffer = [];
          SensorReading.insertMany(toSave).catch(err => console.error('Bulk save error:', err.message));
        }

        buffer = buffer.slice(58);
      }
    } catch (err) {
      console.error('Packet parsing failed:', err.message);
      socket.destroy();
    }
  });

  socket.on('end', () => {
    for (const [mac, sock] of connectedDevices.entries()) {
      if (sock === socket) {
        connectedDevices.delete(mac);
        console.log(`Device ${mac} disconnected`);
      }
    }
  });

  socket.on('error', err => {
    if (err.code !== 'ECONNRESET') {
      console.error('Socket error:', err.message);
    }
  });
});

setInterval(() => {
  if (readingBuffer.length > 0) {
    const toSave = [...readingBuffer];
    readingBuffer = [];
    SensorReading.insertMany(toSave).catch(err => console.error('Periodic bulk save error:', err.message));
  }
}, 5000);

server.listen(4000, '0.0.0.0', () => {
  console.log('TCP server listening on port 4000');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('HTTP server running on port 5000');
});
