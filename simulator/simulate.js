const net = require('net');

const TOTAL_DEVICES = 11;
const devices = [];

function generateMac(index) {
  return `00:11:22:33:44:${(index % 256).toString(16).padStart(2, '0').toUpperCase()}`;
}

function toFloatLE(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatLE(value, 0);
  return buf;
}

function startDevice(mac, index) {
  let sendCount = 0;

  const isHealthyDevice = index >= TOTAL_DEVICES - 2;
  const isDisconnectedSim = index >= TOTAL_DEVICES - 5 && index < TOTAL_DEVICES - 2;

  let alarmStart = 5 + Math.floor(Math.random() * 5);
  let alarmDuration = 2 + Math.floor(Math.random() * 2);
  let inAlarmPhase = false;

  const client = net.createConnection({ host: 'localhost', port: 4000 });

  client.on('connect', () => {
    console.log(`✅ Connected as ${mac}`);

    const interval = setInterval(() => {
      sendCount++;

      // Disconnection Simulation
      if (isDisconnectedSim && sendCount >= 3) {
        console.log(`❌ [${mac}] Disconnecting after ${sendCount} packets`);
        clearInterval(interval);
        client.end();

        const reconnectDelay = 10000 + Math.random() * 10000;
        console.log(`🔄 [${mac}] Will reconnect in ${(reconnectDelay / 1000).toFixed(1)}s`);
        setTimeout(() => startDevice(mac, index), reconnectDelay);
        return;
      }

      // Toggle alarm phase
      if (isHealthyDevice) {
        if (sendCount >= alarmStart && sendCount < alarmStart + alarmDuration) {
          inAlarmPhase = true;
        } else {
          inAlarmPhase = false;
        }

        if (sendCount >= alarmStart + alarmDuration) {
          alarmStart = sendCount + 5 + Math.floor(Math.random() * 5);
          alarmDuration = 2 + Math.floor(Math.random() * 2);
        }
      }

      // Sensor value simulation
      const triggerAlarm = !isHealthyDevice || inAlarmPhase;


      // SENSOR DATA GENERATION
      const humidity = triggerAlarm ? 85 + Math.random() * 10 : 55 + Math.random() * 5;
      const insideTemp = triggerAlarm ? 55 + Math.random() * 5 : 35 + Math.random() * 3;
      const outsideTemp = triggerAlarm ? 65 + Math.random() * 5 : 40 + Math.random() * 3;

      const lockStatus = Math.random() < 0.5 ? 1 : 0;
      const doorStatus = Math.random() < 0.5 ? 1 : 0;
      const waterLogging = triggerAlarm && Math.random() < 0.2 ? 1 : 0;
      const waterLeakage = triggerAlarm && Math.random() < 0.2 ? 1 : 0;

      const outputVoltage = triggerAlarm ? 2.5 + Math.random() * 0.2 : 3.3 + Math.random() * 0.1;
      const inputVoltage = outputVoltage * 10;
      const batteryBackup = triggerAlarm ? 5 + Math.random() * 2 : 12 + Math.random() * 3;

      const alarmActive = waterLogging || waterLeakage;
      const fireAlarm = triggerAlarm && Math.random() < 0.2 ? 1 : 0;

      const fan1 = Math.random() < 0.9 ? 1 : 0;
      const fan2 = Math.random() < 0.9 ? 1 : 0;
      const fan3 = Math.random() < 0.9 ? 1 : 0;
      const fan4 = Math.random() < 0.9 ? 1 : 0;

      // -- NEW: DIRECT FAN STATUS CODES (per fan, 0=off, 1=healthy, 2=faulty)
      const fanStatuses = [];
      for (let i = 0; i < 6; i++) {
        const rand = Math.random();
        // Adjust probabilities (here: off 40%, healthy 50%, faulty 10%)
        // You can adjust these to your testing needs!
        fanStatuses[i] =
          rand < 0.4 ? 0 : // off (grey)
          rand < 0.9 ? 1 : // healthy (green)
          2; // faulty (red)
      }
      // Pack 6 x 2-bit codes into a uint16 (2 bytes)
      let fanStatusBits = 0;
      for (let i = 0; i < 6; i++) {
        fanStatusBits |= (fanStatuses[i] << (i * 2));
      }
      const fanStatusBuf = Buffer.alloc(2);
      fanStatusBuf.writeUInt16LE(fanStatusBits, 0);

      // -- OLD: Fail mask for legacy compatibility (not related to new fan status)
      let failMask = 0;
      for (let bit = 0; bit <= 5; bit++) {
        if (triggerAlarm && Math.random() < 0.1) failMask |= (1 << bit);
      }

      const failBuf = Buffer.alloc(4);
      failBuf.writeUInt32LE(failMask, 0);

      // -- Build the packet (new total 58 bytes)
      const packet = Buffer.concat([
        Buffer.from(mac.padEnd(17, ' '), 'utf-8'), // 17 bytes
        toFloatLE(humidity), // 4
        toFloatLE(insideTemp), // 4
        toFloatLE(outsideTemp), // 4
        Buffer.from([lockStatus, doorStatus, waterLogging, waterLeakage]), // 4
        toFloatLE(outputVoltage), // 4
        toFloatLE(inputVoltage), // 4
        toFloatLE(batteryBackup), // 4
        Buffer.from([
          alarmActive ? 1 : 0,
          fireAlarm,
          fan1,
          fan2,
          fan3,
          fan4,
          0 // extra padding
        ]), // 7 bytes
        fanStatusBuf, // 2 bytes (NEW: direct fan status codes)
        failBuf // 4 bytes
      ]);

      const status =
        isDisconnectedSim && sendCount >= 3
          ? '❌ DISCONNECTED'
          : triggerAlarm
          ? '🚨 ALARM'
          : '✅ NORMAL';
      console.log(`[${mac}] ${status} | Packet #${sendCount}`);
      client.write(packet);
    }, 5000); // Send packet every 5 seconds

    client.on('data', (data) => {
      console.log(`${mac} received command: ${data.toString()}`);
    });

    client.on('error', (err) => {
      console.error(`${mac} error:`, err);
    });

    client.on('close', () => {
      console.warn(`${mac} connection closed`);
    });
  });
}

// Start all devices
let index = 0;
const spawnInterval = setInterval(() => {
  if (index >= TOTAL_DEVICES) {
    clearInterval(spawnInterval);
    console.log('✅ All simulated devices started.');
    return;
  }
  const mac = generateMac(index);
  startDevice(mac, index);
  devices.push(mac);
  index++;
}, 10);
