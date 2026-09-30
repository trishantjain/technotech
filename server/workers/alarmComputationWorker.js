const { consume, publishAlarmResult } = require("../services/rabbit");
const thresholds = require("../thresholds");
const { calculateAlarms } = require("./alarmEngine");
const Device = require("../models/Device");
const connectDatabase = require("../config/db.js");

const Alarm = require("../models/Alarm");
const crypto = require("crypto");


(async () => {
  await connectDatabase();
  start();
})();


async function processAlarmLifecycle(device, alarms, timestamp) {
  const currentAlarms = [
    ...alarms.critical,
    ...alarms.major,
    ...alarms.minor
  ];

  /*
   * Get currently active alarms from DB.
   *
   * resolved_at: null means the alarm is still active.
   */
  const activeAlarms = await Alarm.find({
    device_id: device._id,
    resolved_at: null
  }).lean();

  const activeAlarmMap = new Map(
    activeAlarms.map(alarm => [alarm.service_name, alarm])
  );

  const currentAlarmKeys = new Set();

  // ======================================================
  // PROCESS CURRENT ALARMS
  // ======================================================

  for (const alarm of currentAlarms) {

    const serviceName = alarm.key;

    currentAlarmKeys.add(serviceName);

    const existingAlarm = activeAlarmMap.get(serviceName);

    // ----------------------------------------------------
    // NEW ALARM
    // ----------------------------------------------------

    if (!existingAlarm) {

      await Alarm.create({
        alert_id: crypto.randomUUID(),
        device_id: device._id,
        device_ip: device.ip,
        alert_type: false,
        alert_severity: alarm.severity,
        created_at: timestamp,
        last_hard_state_change: timestamp,
        resolved_at: null,
        value: alarm.title,
        reason: alarm.title,
        acknowledgement_status: false,
        service_name: serviceName
      });
      
      console.log(
        `🚨 Alarm created: ${serviceName} for ${device.ip}`,
        createdAlarm._id
    );

      continue;
    }

    // ----------------------------------------------------
    // EXISTING ALARM
    // ----------------------------------------------------

    /*
     * Alarm is still active.
     *
     * Do NOT update created_at or last_hard_state_change
     * on every packet.
     */

    if (existingAlarm.alert_severity !== alarm.severity) {

      await Alarm.updateOne(
        { _id: existingAlarm._id },
        {
          $set: {
            alert_severity: alarm.severity,
            value: alarm.title,
            reason: alarm.title,
            last_hard_state_change: timestamp
          }
        }
      );

    } else {

      // Value/reason can change while alarm remains active.
      await Alarm.updateOne(
        { _id: existingAlarm._id },
        {
          $set: {
            value: alarm.title,
            reason: alarm.title
          }
        }
      );
    }
  }

  // ======================================================
  // CLEAR ALARMS
  // ======================================================

  for (const activeAlarm of activeAlarms) {

    if (currentAlarmKeys.has(activeAlarm.service_name)) {
      continue;
    }

    /*
     * Alarm existed previously but is no longer
     * reported by Alarm Engine.
     */

    await Alarm.updateOne(
      {
        _id: activeAlarm._id,
        resolved_at: null
      },
      {
        $set: {
          resolved_at: timestamp,

          /*
           * OEM requirement:
           * false = active
           * true = clear
           */
          acknowledgement_status: true,

          last_hard_state_change: timestamp
        }
      }
    );
  }
}


async function start() {
  console.log("🚀 Alarm Processor Worker started");

  await consume("alarm.queue", async (data) => {
    const {
      ip,
      // humidity,
      // insideTemperature,
      // outsideTemperature,
      // inputVoltage,
      // outputVoltage,
      // batteryBackup,
      // waterLogging,
      // waterLeakage,
      // doorStatus,
      // lockStatus,
      // fireAlarm,
      // pwsFailCount,
      // mainStatus,
      // rectStatus,
      // inveStatus,
      // overStatus,
      // mptStatus,
      // mosfStatus,
      fanStatus
    } = data;

    // const activeAlarms = [];


    const timestamp = new Date();

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

    console.log(
      `🔔 Alarm calculation for ${ip}:`,
      JSON.stringify(alarms, null, 2)
    );

    // Process alarm lifecycle
    await processAlarmLifecycle(
      device,
      alarms,
      timestamp
    );

    // Save current alarm state
    await Device.updateOne(
      { ip },
      {
        $set: {
          currentAlarms: alarms
        }
      }
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
      timestamp: new Date().toISOString()
    });
  });
}

// start();
