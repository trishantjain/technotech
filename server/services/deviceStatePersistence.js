const Device = require("../models/Device");

const { redisClient } = require("./redisClient");

const {
  getDirtyStatusSnapshot,
  clearStatusDirtyIfUnchanged,
  getDeviceStateRedis,
} = require("./deviceStatusRedis");

const {
  getDirtyAlarmSnapshot,
  clearAlarmDirtyIfUnchanged,
  getCurrentAlarms,
} = require("./currentAlarmMemoryCache");
const { getDirtyCurrentAlarmDevices, getCurrentAlarmPersistenceState, markCurrentAlarmsPersisted } = require("../redis/currentAlarmRedis");

const PERSIST_INTERVAL = 120000;

let persistenceTimer = null;
let isPersisting = false;

async function persistDeviceStates() {
  if (isPersisting) return;

  isPersisting = true;

  const statusSnapshot = getDirtyStatusSnapshot();
  const alarmVersions = new Map();
  const alarmSnapshot = getDirtyAlarmSnapshot();

  try {
    // Get devices with pending alarm changes from Redis.
    const dirtyAlarmIps = await getDirtyCurrentAlarmDevices();

    const dirtyIps = new Set([
      ...statusSnapshot.keys(),
      ...dirtyAlarmIps,
      ...alarmSnapshot.keys(),
    ]);

    if (dirtyIps.size === 0) {
      return;
    }

    const operations = [];

    // Read latest state from both stores.
    const deviceStates = await Promise.all(
      [...dirtyIps].map(async (ip) => {
        const update = {};

        if (statusSnapshot.has(ip)) {
          const state = await getDeviceStateRedis(ip);

          if (state) {
            update.deviceStatus = state.deviceStatus;
            update.dashboardStatus = state.dashboardStatus;
            update.lastStatusChangeTimeTicks = state.lastStatusChangeTimeTicks;
          }
        }

        if (dirtyAlarmIps.includes(ip)) {
          const alarmState = await getCurrentAlarmPersistenceState(ip);

          if (alarmState) {
            update.currentAlarms = alarmState.alarms;

            // Remember exactly which Redis version is being persisted.
            alarmVersions.set(ip, alarmState.version);
          }
        }

        // if (alarmSnapshot.has(ip)) {
        //   const alarms = getCurrentAlarms(ip);

        //   if (alarms) {
        //     update.currentAlarms = alarms;
        //   }
        // }

        return { ip, update };
      }),
    );

    for (const { ip, update } of deviceStates) {
      if (Object.keys(update).length === 0) continue;

      operations.push({
        updateOne: {
          filter: { ip },
          update: {
            $set: update,
          },
        },
      });
    }

    if (operations.length === 0) {
      return;
    }

    const result = await Device.bulkWrite(operations, {
      ordered: false,
    });

    // Clear status changes only if their versions are unchanged.
    clearStatusDirtyIfUnchanged(statusSnapshot);
    clearAlarmDirtyIfUnchanged(alarmSnapshot);

    // Acknowledge only the exact Redis alarm versions written.
    for (const [ip, version] of alarmVersions) {
      const persisted = await markCurrentAlarmsPersisted(ip, version);

      if (!persisted) {
        console.log(
          `[DevicePersistence] Newer alarm update exists for ${ip}. Keeping it dirty.`,
        );
      }
    }

    console.log(
      `[DevicePersistence] Completed. Operations: ${operations.length}, matched: ${result.matchedCount}, modified: ${result.modifiedCount}, alarms persisted: ${alarmVersions.size}`,
    );
  } catch (error) {
    // Dirty versions are retained and retried on the next cycle.
    console.error(
      "[DevicePersistence] MongoDB persistence failed:",
      error.message,
    );
  } finally {
    isPersisting = false;
  }
}

function startDeviceStatePersistence() {
  if (persistenceTimer) return;

  console.log(
    `[DevicePersistence] Started. Interval: ${PERSIST_INTERVAL / 1000}s`,
  );

  // Persist pending changes immediately on startup.
  persistDeviceStates();

  persistenceTimer = setInterval(persistDeviceStates, PERSIST_INTERVAL);

  persistenceTimer.unref?.();
}

function stopDeviceStatePersistence() {
  if (persistenceTimer) {
    clearInterval(persistenceTimer);
    persistenceTimer = null;
  }
}

module.exports = {
  startDeviceStatePersistence,
  stopDeviceStatePersistence,
  persistDeviceStates,
};
