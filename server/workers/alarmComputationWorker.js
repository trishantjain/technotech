const { consume, publishAlarmResult } = require("../services/rabbit");
const thresholds = require("../thresholds");
const { calculateAlarms, getDashboardStatus } = require("./alarmEngine");
const Device = require("../models/Device");
const connectDatabase = require("../config/db.js");

const Alarm = require("../models/Alarm");
const crypto = require("crypto");

// ======================================================
// IN-MEMORY ALARM STATE
// ======================================================

// Structure:
// Map {
//   deviceId: Map {
//     serviceName: alarmDocument
//   }
// }

const activeAlarmCache = new Map();

// Pending MongoDB changes, keyed by alert_id.
// Each entry contains the original document and pending changes.
const pendingAlarmWrites = new Map();

const ALARM_FLUSH_INTERVAL = 5000;

let isFlushing = false;

// Serialize processing for the same device.
const deviceProcessingQueues = new Map();

(async () => {
  await connectDatabase();
  await start();
})();

// ======================================================
// LOAD EXISTING ACTIVE ALARMS
// ======================================================
async function loadActiveAlarmCache() {
  console.log("Loading active alarms into memory...");

  const activeAlarms = await Alarm.find({
    resolved_at: null,
  }).lean();

  for (const alarm of activeAlarms) {
    const deviceId = String(alarm.device_id);

    if (!activeAlarmCache.has(deviceId)) {
      activeAlarmCache.set(deviceId, new Map());
    }

    activeAlarmCache.get(deviceId).set(alarm.service_name, alarm);
  }

  console.log(`Loaded ${activeAlarms.length} active alarms into memory`);
}

// ======================================================
// QUEUE ALARM DATABASE CHANGES
// ======================================================
function queueAlarmWrite(alarmDocument, updates = {}) {
  const alertId = alarmDocument.alert_id;

  const existingPending = pendingAlarmWrites.get(alertId);

  // Create a new entry rather than mutating the old one.
  // This ensures an in-progress DB flush cannot discard
  // newer changes accidentally.
  pendingAlarmWrites.set(alertId, {
    baseDocument: existingPending
      ? existingPending.baseDocument
      : alarmDocument,

    updates: {
      ...(existingPending?.updates || {}),
      ...updates,
    },
  });
}

// ======================================================
// FLUSH PENDING ALARM CHANGES TO MONGODB
// ======================================================
async function flushPendingAlarmWrites() {
  if (isFlushing || pendingAlarmWrites.size === 0) {
    return;
  }

  isFlushing = true;

  // Take a snapshot so new changes arriving during the
  // database operation remain pending for the next flush.
  const snapshot = Array.from(pendingAlarmWrites.entries()).map(
    ([alertId, entry]) => ({
      alertId,
      entry,

      baseDocument: entry.baseDocument,
      updates: { ...entry.updates },
    }),
  );

  try {
    const operations = snapshot.map((item) => {
      const setOnInsert = {
        ...item.baseDocument,
      };

      // Remove Mongoose-managed fields.
      delete setOnInsert.createdAt;
      delete setOnInsert.updatedAt;
      delete setOnInsert.__v;

      // A field must not appear in both $setOnInsert
      // and $set in the same MongoDB update.
      for (const field of Object.keys(item.updates)) {
        delete setOnInsert[field];
      }

      const update = {
        $setOnInsert: setOnInsert,
      };

      if (Object.keys(item.updates).length > 0) {
        update.$set = item.updates;
      }

      return {
        updateOne: {
          filter: {
            alert_id: item.alertId,
          },
          update,
          upsert: true,
        },
      };
    });

    await Alarm.bulkWrite(operations, {
      ordered: false,
    });

    // Remove only the entries that were included in this
    // successful batch and have not been replaced since.
    for (const item of snapshot) {
      if (pendingAlarmWrites.get(item.alertId) === item.entry) {
        pendingAlarmWrites.delete(item.alertId);
      }
    }

    console.log(`Alarm DB batch completed: ${operations.length} operations`);
  } catch (error) {
    // Do not clear pending entries.
    // They will be retried in the next 5-second cycle.
    console.error(
      "Alarm DB batch failed. Changes retained for retry:",
      error.message,
    );
  } finally {
    isFlushing = false;
  }
}

async function processAlarmLifecycle(device, alarms, timestamp) {
  const deviceId = String(device._id);

  const currentAlarms = [...alarms.critical, ...alarms.major, ...alarms.minor];

  if (!activeAlarmCache.has(deviceId)) {
    activeAlarmCache.set(deviceId, new Map());
  }

  const deviceAlarmMap = activeAlarmCache.get(deviceId);

  /*
   * Get currently active alarms from DB.
   * resolved_at: null means the alarm is still active.
   */
  // const activeAlarms = await Alarm.find({
  //   device_id: device._id,
  //   resolved_at: null,
  // }).lean();

  // const activeAlarmMap = new Map(
  //   activeAlarms.map((alarm) => [alarm.service_name, alarm]),
  // );

  const currentAlarmKeys = new Set();

  // ======================================================
  // PROCESS CURRENT ALARMS
  // ======================================================

  for (const alarm of currentAlarms) {
    const serviceName = alarm.key;

    currentAlarmKeys.add(serviceName);

    // const existingAlarm = activeAlarmMap.get(serviceName);
    const existingAlarm = deviceAlarmMap.get(serviceName);

    // ----------------------------------------------------
    // NEW ALARM
    // ----------------------------------------------------

    if (!existingAlarm) {
      const newAlarm = await Alarm({
        // await Alarm.create({
        alert_id: crypto.randomUUID(),
        device_id: device._id,
        device_ip: device.ip,
        // alert_type: false,
        alert_type: alarm.alertType === true,
        alert_severity: alarm.severity,
        created_at: timestamp,
        last_hard_state_change: timestamp,
        resolved_at: null,
        value: alarm.value,
        reason: alarm.reason,
        acknowledgement_status: false,
        service_name: serviceName,
      }).toObject();

      // Add immediately to memory.
      deviceAlarmMap.set(serviceName, newAlarm);

      // Queue DB insertion.
      queueAlarmWrite(newAlarm);

      console.log(
        `🚨 Alarm created: ${serviceName} for ${device.ip}`,
        newAlarm._id,
      );

      continue;
    }

    // ----------------------------------------------------
    // EXISTING ALARM
    // ----------------------------------------------------

    /*
     * Alarm is still active.
     *
     * Do NOT update created_at or last_hard_state_change on every packet.
     */

    if (existingAlarm.alert_severity !== alarm.severity) {
      existingAlarm.alert_severity = alarm.severity;

      existingAlarm.last_hard_state_change = timestamp;

      // Queue only the actual severity transition.
      queueAlarmWrite(existingAlarm, {
        alert_severity: alarm.severity,
        last_hard_state_change: timestamp,
      });

      console.log(`Alarm severity changed: ${serviceName} for ${device.ip}`);
    }
  }

  // ======================================================
  // CLEAR ALARMS
  // ======================================================

  for (const [serviceName, activeAlarm] of deviceAlarmMap) {
    if (currentAlarmKeys.has(serviceName)) {
      continue;
    }

    /*
     * Alarm existed previously but is no longer
     * reported by Alarm Engine.
     */

    const clearUpdates = {
      resolved_at: timestamp,
      acknowledgement_status: true,
      last_hard_state_change: timestamp,
    };

    // Queue resolution for MongoDB.
    queueAlarmWrite(activeAlarm, clearUpdates);

    // Remove immediately from active memory.
    deviceAlarmMap.delete(serviceName);

    console.log(`Alarm cleared: ${serviceName} for ${device.ip}`);
  }

  if (deviceAlarmMap.size === 0) {
    activeAlarmCache.delete(deviceId);
  }
}

// ======================================================
// PER-DEVICE PROCESSING QUEUE
// ======================================================
function enqueueDeviceProcessing(ip, task) {
  const previousTask = deviceProcessingQueues.get(ip) || Promise.resolve();

  const currentTask = previousTask
    .catch(() => {
      // Allow the next task to execute even if the
      // previous task failed.
    })
    .then(task);

  deviceProcessingQueues.set(ip, currentTask);

  return currentTask.finally(() => {
    if (deviceProcessingQueues.get(ip) === currentTask) {
      deviceProcessingQueues.delete(ip);
    }
  });
}

async function start() {
  console.log("🚀 Alarm Processor Worker started");

  // Load existing active alarms before consuming messages.
  await loadActiveAlarmCache();

  // Flush pending alarm changes every 5 seconds.
  setInterval(() => {
    flushPendingAlarmWrites();
  }, ALARM_FLUSH_INTERVAL);

  await consume("alarm.queue", async (data) => {
    const { ip, fanStatus } = data;

    // const activeAlarms = [];

    // const timestamp = new Date();
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();

    await enqueueDeviceProcessing(ip, async () => {
      // Find device
      const device = await Device.findOne({ ip });

      if (!device) {
        console.warn(`⚠️ Device not found for alarm processing: ${ip}`);
        return;
      }

      if (device.maintenanceMode === "Active") {
        return;
      }

      // Calculate alarms
      const alarms = calculateAlarms(data, thresholds);

      // console.log(
      //   `🔔 Alarm calculation for ${ip}:`,
      //   JSON.stringify(alarms, null, 2),
      // );

      // Process alarm lifecycle
      await processAlarmLifecycle(device, alarms, timestamp);

      // Save current alarm state
      await Device.updateOne(
        { ip },
        {
          $set: {
            currentAlarms: alarms,
            dashboardStatus: getDashboardStatus(device.deviceStatus, alarms),
          },
        },
      );

      // Check whether any alarms exist
      const hasAlarms =
        alarms.critical.length > 0 ||
        alarms.major.length > 0 ||
        alarms.minor.length > 0;

      publishAlarmResult({
        ip,
        alarms,
        fanStatus,
        type: hasAlarms ? "active" : "clear",
        // timestamp: new Date().toISOString(),
        timestamp: timestamp.toISOString(),
      });
    });
  });
}

// start();
