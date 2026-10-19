const Device = require("../models/Device");

const deviceStatusCache = new Map();

async function initializeDeviceStatusCache() {
  const devices = await Device.find(
    {},
    {
      _id: 1,
      ip: 1,
      deviceStatus: 1,
    }
  ).lean();

  deviceStatusCache.clear();

  for (const device of devices) {
    if (!device.ip) continue;

    deviceStatusCache.set(device.ip, {
      deviceId: String(device._id),
      response: device.deviceStatus === "UP",
    });
  }

  console.log(
    `[PingRecord] Initialized status cache for ${deviceStatusCache.size} devices`
  );
}

function updateDeviceStatusCache(ip, status) {
  if (!ip) return;

  const existing = deviceStatusCache.get(ip);

  // Do not create an entry without a known MongoDB device ID.
  if (!existing) {
    console.warn(
      `[PingRecord] Device ${ip} is missing from the status cache`
    );
    return;
  }

  deviceStatusCache.set(ip, {
    ...existing,
    response: status === "UP",
  });
}

function registerDeviceInStatusCache(device) {
  if (!device || !device.ip || !device._id) return;

  deviceStatusCache.set(device.ip, {
    deviceId: String(device._id),
    response: device.deviceStatus === "UP",
  });
}

module.exports = {
  deviceStatusCache,
  initializeDeviceStatusCache,
  updateDeviceStatusCache,
  registerDeviceInStatusCache,
};
