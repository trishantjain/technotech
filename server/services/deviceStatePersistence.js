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

const PERSIST_INTERVAL = 120000;

let persistenceTimer = null;
let isPersisting = false;

async function persistDeviceStates() {
  if (isPersisting) return;

  isPersisting = true;

  const statusSnapshot = getDirtyStatusSnapshot();
  const alarmSnapshot = getDirtyAlarmSnapshot();

  try {
    const dirtyIps = new Set([
      ...statusSnapshot.keys(),
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

        if (alarmSnapshot.has(ip)) {
          const alarms = getCurrentAlarms(ip);

          if (alarms) {
            update.currentAlarms = alarms;
          }
        }

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

    // Clear only the versions that were successfully persisted.
    clearStatusDirtyIfUnchanged(statusSnapshot);
    clearAlarmDirtyIfUnchanged(alarmSnapshot);

    console.log(
      `[DevicePersistence] Completed. Operations: ${operations.length}, matched: ${result.matchedCount}, modified: ${result.modifiedCount}`,
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
