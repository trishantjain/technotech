const Device = require("../models/Device");
const { updateDeviceStatusCache } = require("../services/deviceStatusCache");

const CHECK_INTERVAL = 2000; // 2 sec
const OFFLINE_TIMEOUT = 15000; // 15 sec

let monitorTimer = null;
let isChecking = false;

async function checkOfflineDevices() {
  if (isChecking) return;

  isChecking = true;

  try {
    const cutoff = new Date(Date.now() - OFFLINE_TIMEOUT);

    // FIND DEVICES THAT ARE ABOUT TO TRANSITION FROM "UP" TO "DOWN"
    const staleDevices = await Device.find(
      {
        deviceStatus: "UP",
        lastPacketTime: { $lt: cutoff },
      },
      { _id: 1, ip: 1 },
    ).lean();

    if (staleDevices.length === 0) return;

    const deviceIds = staleDevices.map((device) => device._id);
    const changeTimeTicks = Date.now();

    for (const device of staleDevices) {
      // Recheck the timeout and status atomically for each device.
      // A newly received packet prevents an incorrect DOWN transition.
      const updatedDevice = await Device.findOneAndUpdate(
        {
          _id: device._id,
          deviceStatus: "UP",
          lastPacketTime: { $lt: cutoff },
        },
        {
          $set: {
            deviceStatus: "DOWN",
            lastStatusChangeTimeTicks: Date.now(),
          },
        },
        {
          new: true,
          projection: { _id: 1, ip: 1 },
        },
      );

      if (updatedDevice) {
        updateDeviceStatusCache(updatedDevice.ip, "DOWN");
        markedDownCount++;
      }
    }

    if (markedDownCount > 0) {
      console.log(`[StatusMonitor] ${markedDownCount} device(s) marked DOWN`);
    }
  } catch (err) {
    console.error("[StatusMonitor] Check failed:", err);
  } finally {
    isChecking = false;
  }
}

function startStatusMonitor() {
  if (monitorTimer) return;

  monitorTimer = setInterval(checkOfflineDevices, CHECK_INTERVAL);
}

function stopStatusMonitor() {
  if (!monitorTimer) return;

  clearInterval(monitorTimer);
  monitorTimer = null;
}

module.exports = {
  startStatusMonitor,
};
