const Device = require("../models/Device");
const { redisClient } = require("../services/redisClient");

const DIRTY_SET = "currentAlarms:dirty";

function getAlarmKey(ip) {
  return `device:${encodeURIComponent(ip)}:alarms`;
}

function emptyAlarms() {
  return {
    critical: [],
    major: [],
    minor: [],
  };
}

// Normalize objects so property ordering does not cause false changes.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }

  return value;
}

function normalizeAlarms(alarms) {
  return {
    critical: alarms?.critical || [],
    major: alarms?.major || [],
    minor: alarms?.minor || [],
  };
}

function serializeAlarms(alarms) {
  return JSON.stringify(canonicalize(normalizeAlarms(alarms)));
}

// Initialize Redis from existing MongoDB alarm data.
// Initialization must not mark devices dirty.

async function initializeCurrentAlarmRedis() {
  console.log("[AlarmRedis] Initializing current alarms...");

  let initialized = 0;

  const devices = await Device.find(
    {},
    {
      ip: 1,
      currentAlarms: 1,
    },
  ).lean();

  for (const device of devices) {
    if (!device.ip) continue;

    const key = getAlarmKey(device.ip);
    const existing = await redisClient.hGet(key, "data");

    // Preserve existing Redis data.
    if (existing !== null) continue;

    const alarms = normalizeAlarms(device.currentAlarms);

    await redisClient.hSet(key, {
      data: serializeAlarms(alarms),
      version: "0",
      persistedVersion: "0",
    });

    initialized++;
  }

  console.log(`[AlarmRedis] Initialized ${initialized} devices from MongoDB`);
}

// Store newly computed alarms.
// Returns true only when alarm content has changed.
async function updateCurrentAlarmsRedis(ip, alarms) {
  if (!ip || !alarms) return false;

  const key = getAlarmKey(ip);
  const newData = serializeAlarms(alarms);

  const existingData = await redisClient.hGet(key, "data");

  if (existingData === newData) {
    return false;
  }

  const currentVersion = Number(await redisClient.hGet(key, "version")) || 0;

  const nextVersion = currentVersion + 1;

  await redisClient.hSet(key, {
    data: newData,
    version: String(nextVersion),
  });

  // Mark device for MongoDB persistence.
  await redisClient.sAdd(DIRTY_SET, ip);

  return true;
}

// Read current alarms from Redis.
async function getCurrentAlarmsRedis(ip) {
  if (!ip) return null;

  const data = await redisClient.hGet(getAlarmKey(ip), "data");

  if (data === null) return null;

  return JSON.parse(data);
}

// Read alarm persistence information.
async function getCurrentAlarmPersistenceState(ip) {
  const state = await redisClient.hGetAll(getAlarmKey(ip));

  if (!state.data) return null;

  return {
    alarms: JSON.parse(state.data),
    version: Number(state.version || 0),
    persistedVersion: Number(state.persistedVersion || 0),
  };
}

// Get devices that need MongoDB persistence.
async function getDirtyCurrentAlarmDevices() {
  return redisClient.sMembers(DIRTY_SET);
}

// Mark a device persisted only if its Redis data has not
// changed while MongoDB was being updated.
async function markCurrentAlarmsPersisted(ip, persistedVersion) {
  const key = getAlarmKey(ip);

  const currentVersion = Number(await redisClient.hGet(key, "version"));

  if (currentVersion !== persistedVersion) {
    return false;
  }

  await redisClient.hSet(key, {
    persistedVersion: String(persistedVersion),
  });

  await redisClient.sRem(DIRTY_SET, ip);

  return true;
}

module.exports = {
  initializeCurrentAlarmRedis,
  updateCurrentAlarmsRedis,
  getCurrentAlarmsRedis,
  getCurrentAlarmPersistenceState,
  getDirtyCurrentAlarmDevices,
  markCurrentAlarmsPersisted,
  getAlarmKey,
};
