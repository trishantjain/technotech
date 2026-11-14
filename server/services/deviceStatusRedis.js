const Device = require("../models/Device");
const { redisClient } = require("./redisClient");

const dirtyVersions = new Map();

function getDeviceKey(ip) {
  return `device:${ip}:state`;
}

function markDirty(ip) {
  dirtyVersions.set(ip, (dirtyVersions.get(ip) || 0) + 1);
}

// Initialize Redis from MongoDB.
// Do not overwrite an existing Redis state because it may be
// newer than the last two-minute MongoDB snapshot.
async function initializeDeviceStatusRedis() {
  const devices = await Device.find(
    {},
    {
      ip: 1,
      deviceStatus: 1,
      dashboardStatus: 1,
      lastStatusChangeTimeTicks: 1,
    },
  ).lean();

  let initialized = 0;

  for (const device of devices) {
    if (!device.ip) continue;

    const key = getDeviceKey(device.ip);

    await redisClient.hSetNX(
      key,
      "deviceStatus",
      device.deviceStatus || "DOWN",
    );

    await redisClient.hSetNX(
      key,
      "dashboardStatus",
      device.dashboardStatus || "connected",
    );

    await redisClient.hSetNX(
      key,
      "lastStatusChangeTimeTicks",
      String(device.lastStatusChangeTimeTicks || 0),
    );

    // const created = await redisClient.hSetNX(
    //   key,
    //   "deviceStatus",
    //   device.deviceStatus || "DOWN",
    // );

    // if (created) {
    //   await redisClient.hSet(key, {
    //     dashboardStatus: device.dashboardStatus || "connected",
    //     lastStatusChangeTimeTicks: String(
    //       device.lastStatusChangeTimeTicks || 0,
    //     ),
    //   });

    //   initialized++;
    // }
  }

  console.log(
    `[Redis] Device status initialized. New keys: ${initialized}, devices: ${devices.length}`,
  );
}

// Update only fields whose values have changed.
async function updateDeviceStateRedis(ip, fields) {
  if (!ip || !fields || Object.keys(fields).length === 0) {
    return false;
  }

  const allowedFields = [
    "deviceStatus",
    "dashboardStatus",
    "lastStatusChangeTimeTicks",
  ];

  const updates = {};

  for (const [field, value] of Object.entries(fields)) {
    if (!allowedFields.includes(field) || value === undefined) {
      continue;
    }

    updates[field] = String(value);
  }

  if (Object.keys(updates).length === 0) {
    return false;
  }

  const key = getDeviceKey(ip);
  const existing = await redisClient.hGetAll(key);

  const changedFields = {};

  for (const [field, value] of Object.entries(updates)) {
    if (existing[field] !== value) {
      changedFields[field] = value;
    }
  }

  if (Object.keys(changedFields).length === 0) {
    return false;
  }

  await redisClient.hSet(key, changedFields);

  markDirty(ip);

  return true;
}

async function getDeviceStateRedis(ip) {
  const state = await redisClient.hGetAll(getDeviceKey(ip));

  if (!Object.keys(state).length) {
    return null;
  }

  return {
    deviceStatus: state.deviceStatus || "DOWN",
    dashboardStatus: state.dashboardStatus || "connected",
    lastStatusChangeTimeTicks: Number(state.lastStatusChangeTimeTicks || 0),
  };
}

function getDirtyStatusSnapshot() {
  return new Map(dirtyVersions);
}

function clearStatusDirtyIfUnchanged(snapshot) {
  for (const [ip, version] of snapshot) {
    if (dirtyVersions.get(ip) === version) {
      dirtyVersions.delete(ip);
    }
  }
}

module.exports = {
  initializeDeviceStatusRedis,
  updateDeviceStateRedis,
  getDeviceStateRedis,
  getDirtyStatusSnapshot,
  clearStatusDirtyIfUnchanged,
};
