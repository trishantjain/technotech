// const Device = require("../models/Device");

// const { updateDeviceStatusCache } = require("../services/deviceStatusCache");

// const { publishAlarm } = require("../services/rabbit");

// const CHECK_INTERVAL = 2000; // 2 seconds
// const OFFLINE_TIMEOUT = 15000; // 15 seconds

// let monitorTimer = null;
// let isChecking = false;

// async function persistDeviceUp(ip, heartbeat) {
//   const timestamp = heartbeat.lastPacketTime;

//   try {
//     await Device.updateOne(
//       { ip },
//       {
//         $set: {
//           deviceStatus: "UP",
//           lastPacketTime: new Date(timestamp),
//           lastStatusChangeTimeTicks: Date.now(),
//         },
//       },
//     );

//     heartbeat.statusDirty = false;

//     // Do not clear a newer heartbeat update.
//     if (heartbeat.lastPacketTime === timestamp) {
//       heartbeat.dirty = false;
//     }

//     heartbeat.pendingUpPersistence = false;

//     return true;
//   } catch (error) {
//     heartbeat.pendingUpPersistence = true;
//     heartbeat.statusDirty = true;

//     console.error(
//       `[StatusMonitor] Failed to persist UP status for ${ip}:`,
//       error.message,
//     );

//     return false;
//   }
// }

// async function markDeviceDown(ip, heartbeat) {
//   if (heartbeat.checkingDown) return;

//   heartbeat.checkingDown = true;

//   const checkedTimestamp = heartbeat.lastPacketTime;

//   try {
//     const result = await Device.updateOne(
//       {
//         ip,
//         deviceStatus: "UP",
//       },
//       {
//         $set: {
//           deviceStatus: "DOWN",
//           lastPacketTime: new Date(checkedTimestamp),
//           lastStatusChangeTimeTicks: Date.now(),
//           dashboardStatus: "disconnected",
//         },
//       },
//     );

//     // No UP document was modified.
//     if (result.matchedCount === 0) {
//       return;
//     }

//     // A new packet arrived while the DOWN update was running.
//     if (heartbeat.lastPacketTime !== checkedTimestamp) {
//       heartbeat.deviceStatus = "UP";
//       heartbeat.statusDirty = true;
//       heartbeat.dirty = true;
//       heartbeat.pendingUpPersistence = true;

//       // Immediately restore UP in MongoDB.
//       await persistDeviceUp(ip, heartbeat);

//       return;
//     }

//     // No new packet arrived. Confirm the DOWN transition.
//     heartbeat.deviceStatus = "DOWN";
//     heartbeat.dirty = false;
//     heartbeat.statusDirty = false;
//     heartbeat.pendingUpPersistence = false;

//     updateDeviceStatusCache(ip, "DOWN");

//     publishAlarm({
//       ip,
//       deviceStatus: "DOWN",
//       timestamp: new Date().toISOString(),
//     });

//     console.log(`[StatusMonitor] Device ${ip} marked DOWN`);
//   } catch (error) {
//     // Leave the in-memory status UP.
//     // The next monitor cycle will retry if the device is still stale.
//     console.error(`[StatusMonitor] Failed to mark ${ip} DOWN:`, error.message);
//   } finally {
//     heartbeat.checkingDown = false;
//   }
// }

// async function checkOfflineDevices(heartbeatCache) {
//   if (isChecking) return;

//   isChecking = true;

//   try {
//     const now = Date.now();

//     for (const [ip, heartbeat] of heartbeatCache.entries()) {
//       // Retry a failed UP transition persistence.
//       if (heartbeat.pendingUpPersistence) {
//         await persistDeviceUp(ip, heartbeat);
//       }

//       if (heartbeat.deviceStatus !== "UP" || heartbeat.checkingDown) {
//         continue;
//       }

//       const lastPacketTime = Number(heartbeat.lastPacketTime || 0);

//       if (now - lastPacketTime > OFFLINE_TIMEOUT) {
//         await markDeviceDown(ip, heartbeat);
//       }
//     }
//   } catch (error) {
//     console.error("[StatusMonitor] Offline check failed:", error);
//   } finally {
//     isChecking = false;
//   }
// }

// function startStatusMonitor(heartbeatCache) {
//   if (monitorTimer) return;

//   if (!(heartbeatCache instanceof Map)) {
//     throw new Error("[StatusMonitor] A valid heartbeatCache Map is required");
//   }

//   console.log("[StatusMonitor] Started using in-memory heartbeat cache");

//   monitorTimer = setInterval(() => {
//     checkOfflineDevices(heartbeatCache);
//   }, CHECK_INTERVAL);
// }

// function stopStatusMonitor() {
//   if (!monitorTimer) return;

//   clearInterval(monitorTimer);
//   monitorTimer = null;
// }

// module.exports = {
//   startStatusMonitor,
//   stopStatusMonitor,
// };

const { updateDeviceStateRedis } = require("../services/deviceStatusRedis");

const { updateDeviceStatusCache } = require("../services/deviceStatusCache");

const { publishAlarm } = require("../services/rabbit");

const CHECK_INTERVAL = 2000;
const OFFLINE_TIMEOUT = 15000;

let monitorTimer = null;
let isChecking = false;

async function persistDeviceUp(ip, heartbeat) {
  try {
    await updateDeviceStateRedis(ip, {
      deviceStatus: "UP",
      lastStatusChangeTimeTicks:
        heartbeat.lastStatusChangeTimeTicks || Date.now(),
    });

    heartbeat.statusDirty = false;
    heartbeat.pendingUpPersistence = false;

    if (heartbeat.lastPacketTime) {
      heartbeat.dirty = false;
    }

    updateDeviceStatusCache(ip, "UP");

    return true;
  } catch (error) {
    heartbeat.pendingUpPersistence = true;
    heartbeat.statusDirty = true;

    console.error(
      `[StatusMonitor] Failed to update Redis UP status for ${ip}:`,
      error.message,
    );

    return false;
  }
}

async function markDeviceDown(ip, heartbeat) {
  if (heartbeat.checkingDown) return;

  heartbeat.checkingDown = true;

  const checkedTimestamp = heartbeat.lastPacketTime;

  try {
    // Confirm that no newer packet has arrived.
    if (heartbeat.lastPacketTime !== checkedTimestamp) {
      return;
    }

    const transitionTime = Date.now();

    await updateDeviceStateRedis(ip, {
      deviceStatus: "DOWN",
      dashboardStatus: "disconnected",
      lastStatusChangeTimeTicks: transitionTime,
    });

    // Check again because a packet may have arrived
    // while the Redis operation was executing.
    if (heartbeat.lastPacketTime !== checkedTimestamp) {
      heartbeat.deviceStatus = "UP";
      heartbeat.statusDirty = true;
      heartbeat.lastStatusChangeTimeTicks =
        heartbeat.lastStatusChangeTimeTicks || Date.now();

      await persistDeviceUp(ip, heartbeat);

      return;
    }

    heartbeat.deviceStatus = "DOWN";
    heartbeat.lastStatusChangeTimeTicks = transitionTime;

    heartbeat.dirty = false;
    heartbeat.statusDirty = false;
    heartbeat.pendingUpPersistence = false;

    updateDeviceStatusCache(ip, "DOWN");

    publishAlarm({
      ip,
      deviceStatus: "DOWN",
      timestamp: new Date().toISOString(),
    });

    console.log(`[StatusMonitor] Device ${ip} marked DOWN`);
  } catch (error) {
    console.error(`[StatusMonitor] Failed to mark ${ip} DOWN:`, error.message);
  } finally {
    heartbeat.checkingDown = false;
  }
}

async function checkOfflineDevices(heartbeatCache) {
  if (isChecking) return;

  isChecking = true;

  try {
    const now = Date.now();

    for (const [ip, heartbeat] of heartbeatCache.entries()) {
      if (heartbeat.pendingUpPersistence) {
        await persistDeviceUp(ip, heartbeat);
      }

      if (heartbeat.deviceStatus !== "UP" || heartbeat.checkingDown) {
        continue;
      }

      const lastPacketTime = Number(heartbeat.lastPacketTime || 0);

      if (now - lastPacketTime > OFFLINE_TIMEOUT) {
        await markDeviceDown(ip, heartbeat);
      }
    }
  } catch (error) {
    console.error("[StatusMonitor] Offline check failed:", error);
  } finally {
    isChecking = false;
  }
}

function startStatusMonitor(heartbeatCache) {
  if (monitorTimer) return;

  if (!(heartbeatCache instanceof Map)) {
    throw new Error("[StatusMonitor] A valid heartbeatCache Map is required");
  }

  console.log("[StatusMonitor] Started using Redis device-status storage");

  monitorTimer = setInterval(() => {
    checkOfflineDevices(heartbeatCache);
  }, CHECK_INTERVAL);
}

function stopStatusMonitor() {
  if (!monitorTimer) return;

  clearInterval(monitorTimer);
  monitorTimer = null;
}

module.exports = {
  startStatusMonitor,
  stopStatusMonitor,
};
