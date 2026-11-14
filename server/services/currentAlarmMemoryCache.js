const Device = require("../models/Device");

const currentAlarmCache = new Map();
const dirtyVersions = new Map();

function emptyAlarms() {
  return {
    critical: [],
    major: [],
    minor: [],
  };
}

function markDirty(ip) {
  dirtyVersions.set(ip, (dirtyVersions.get(ip) || 0) + 1);
}

async function initializeCurrentAlarmCache() {
  const devices = await Device.find(
    {},
    {
      ip: 1,
      currentAlarms: 1,
    },
  ).lean();

  currentAlarmCache.clear();
  dirtyVersions.clear();

  for (const device of devices) {
    if (!device.ip) continue;

    currentAlarmCache.set(device.ip, device.currentAlarms || emptyAlarms());
  }

  console.log(`[AlarmCache] Initialized ${currentAlarmCache.size} devices`);
}

function setCurrentAlarms(ip, alarms) {
  if (!ip || !alarms) return false;

  const normalized = {
    critical: alarms.critical || [],
    major: alarms.major || [],
    minor: alarms.minor || [],
  };

  const existing = currentAlarmCache.get(ip);

  const oldValue = JSON.stringify(existing || emptyAlarms());
  const newValue = JSON.stringify(normalized);

  if (oldValue === newValue) {
    return false;
  }

  currentAlarmCache.set(ip, normalized);

  markDirty(ip);

  return true;
}

function getCurrentAlarms(ip) {
  return currentAlarmCache.get(ip) || null;
}

function getAllCurrentAlarms() {
  return Array.from(currentAlarmCache.entries());
}

function getDirtyAlarmSnapshot() {
  return new Map(dirtyVersions);
}

function clearAlarmDirtyIfUnchanged(snapshot) {
  for (const [ip, version] of snapshot) {
    if (dirtyVersions.get(ip) === version) {
      dirtyVersions.delete(ip);
    }
  }
}

function removeDeviceAlarmCache(ip) {
  currentAlarmCache.delete(ip);
  dirtyVersions.delete(ip);
}

module.exports = {
  initializeCurrentAlarmCache,
  setCurrentAlarms,
  getCurrentAlarms,
  getAllCurrentAlarms,
  getDirtyAlarmSnapshot,
  clearAlarmDirtyIfUnchanged,
  removeDeviceAlarmCache,
};
