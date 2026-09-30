require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");

const RECONNECT_DELAY_MS = 5000;

// Alarm is considered cleared when it has not been received
// for 10 seconds.
const ALARM_GAP_MS = 10 * 1000;

let restarting = false;

/*                                                                         
| -------------------------------------------------------------------------- |
| Active Alarm Lifecycle Map                                                 |
| -------------------------------------------------------------------------- |
|                                                                            |
| Key:                                                                       |
| device_ip + service_name                                                   |
|                                                                            |
| Example:                                                                   |
| 192.168.0.61:batteryBackup                                                 |
|                                                                            |
| Value:                                                                     |
| {                                                                          |
| alertId,                                                                   |
| deviceIp,                                                                  |
| severity,                                                                  |
| serviceName,                                                               |
| alarmValue,                                                                |
| startTime,                                                                 |
| lastSeen                                                                   |
| }                                                                          |
|                                                                            |
| */

const activeAlarms = new Map();

/*                                                                         
| -------------------------------------------------------------------------- |
| Alert ID Generator                                                         |
| -------------------------------------------------------------------------- |
|                                                                            |
| Format:                                                                    |
|                                                                            |
| yy_mm_dd_hh_0001                                                           |
|                                                                            |
| Example:                                                                   |
|                                                                            |
| 26_09_03_16_0001                                                           |
|                                                                            |
| */

let currentHourKey = "";
let alertSequence = 0;

function getHourKey(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");

  return `${yy}_${mm}_${dd}_${hh}`;
}

function generateAlertId(now) {
  const hourKey = getHourKey(now);

  if (hourKey !== currentHourKey) {
    currentHourKey = hourKey;
    alertSequence = 0;
  }

  alertSequence++;

  return `${hourKey}_${String(alertSequence).padStart(4, "0")}`;
}

/*                                                                         
| -------------------------------------------------------------------------- |
| Normalize Alarm Data                                                       |
| -------------------------------------------------------------------------- |
| */

function normalizeAlarms(alarms) {
  if (Array.isArray(alarms)) {
    return alarms;
  }

  if (alarms && typeof alarms === "object") {
    return [
      ...(alarms.critical || []),
      ...(alarms.major || []),
      ...(alarms.minor || []),
      ...(alarms.warning || []),
    ];
  }

  return [];
}

/*                                                                         
| -------------------------------------------------------------------------- |
| Log File Helper                                                            |
| -------------------------------------------------------------------------- |
| */

function getAlarmFilePath(baseDir, ip, now) {
  const deviceDirName = String(ip).replace(/[:. ]/g, "_");

  const deviceDir = path.join(baseDir, deviceDirName);

  fs.mkdirSync(deviceDir, {
    recursive: true,
  });

  const fileName = `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}_Alarm.inc`;

  return path.join(deviceDir, fileName);
}

/*                                                                         
| -------------------------------------------------------------------------- |
| Write Alarm Log                                                            |
| -------------------------------------------------------------------------- |
| */

function writeAlarmLog(baseDir, alarmData, now) {
  const filePath = getAlarmFilePath(baseDir, alarmData.deviceIp, now);

  /* * Fixed column format: * * log_timestamp * alert_id * device_ip * severity * alarm * alarm_value * start_time * end_time * status */
  const logLine = [
    now.toISOString(),
    alarmData.alertId,
    alarmData.deviceIp,
    String(alarmData.severity).toUpperCase(),
    alarmData.serviceName,
    alarmData.alarmValue,
    alarmData.startTime.toISOString(),
    alarmData.endTime ? alarmData.endTime.toISOString() : "null",
    alarmData.status,
  ].join(" | ");

  fs.appendFileSync(filePath, logLine + "\n");

  console.log(
    `📝 Alarm ${alarmData.status} | ${alarmData.alertId} | ${alarmData.serviceName}`,
  );
}

/*                                                                         
| -------------------------------------------------------------------------- |
| Clear Expired Alarms                                                       |
| -------------------------------------------------------------------------- |
|                                                                            |
| Any alarm not seen for 10 seconds is closed.                               |
|                                                                            |
| */

function clearExpiredAlarms(baseDir, now) {
  for (const [lifecycleKey, activeAlarm] of activeAlarms.entries()) {
    const timeSinceLastSeen = now.getTime() - activeAlarm.lastSeen;

    if (timeSinceLastSeen >= ALARM_GAP_MS) {
      /*
        |--------------------------------------------------------------------------
        | Write final CLEARED record
        |--------------------------------------------------------------------------
        */

      writeAlarmLog(
        baseDir,
        {
          alertId: activeAlarm.alertId,

          deviceIp: activeAlarm.deviceIp,

          severity: activeAlarm.severity,

          serviceName: activeAlarm.serviceName,

          alarmValue: activeAlarm.alarmValue,

          startTime: activeAlarm.startTime,

          endTime: now,

          status: "Cleared",
        },
        now,
      );

      console.log(
        `🔕 Alarm cleared | ${activeAlarm.alertId} | ${lifecycleKey}`,
      );

      activeAlarms.delete(lifecycleKey);
    }
  }
}

/*                                                                      
| -------------------------------------------------------------------------- |
| RabbitMQ Restart Handling                                                  |
| -------------------------------------------------------------------------- |
| */

function scheduleRestart(reason) {
  if (restarting) return;

  restarting = true;

  console.error(
    `RabbitMQ worker disconnected: ${reason}. ` +
      `Restarting in ${RECONNECT_DELAY_MS / 1000}s...`,
  );

  setTimeout(() => {
    restarting = false;

    startWorker().catch((err) => {
      console.error("Worker restart failed:", err.message);

      scheduleRestart(err.message);
    });
  }, RECONNECT_DELAY_MS);
}
/*                                                                         
| -------------------------------------------------------------------------- |
| Start Worker                                                               |
| -------------------------------------------------------------------------- |
| */

async function startWorker() {
  let connection;

  try {
    connection = await amqp.connect(process.env.RABBIT_URL);

    const channel = await connection.createChannel();

    connection.on("error", (err) => {
      console.error("RabbitMQ connection error:", err.message);
    });

    connection.on("close", () => {
      scheduleRestart("connection closed");
    });

    channel.on("error", (err) => {
      console.error("RabbitMQ channel error:", err.message);
    });

    channel.on("close", () => {
      scheduleRestart("channel closed");
    });

    await channel.assertQueue("alarm.result.queue", {
      durable: true,
    });

    console.log("🚀 Alarm Log Worker started");

    channel.consume(
      "alarm.result.queue",

      async (msg) => {
        if (!msg) return;

        try {
          const data = JSON.parse(msg.content.toString());

          const { ip, alarms } = data;

          const baseDir = process.env.ALARM_LOG_DIR;

          if (!ip || !baseDir) {
            console.error("Invalid alarm message:", data);

            channel.ack(msg);

            return;
          }

          const now = new Date();

          const alarmList = normalizeAlarms(alarms);

          /*
                |--------------------------------------------------------------------------
                | Process Current Active Alarms
                |--------------------------------------------------------------------------
                */

          for (const alarm of alarmList) {
            if (!alarm || !alarm.key) {
              continue;
            }

            /*
                    |--------------------------------------------------------------------------
                    | Same Device + Same Service = Same Lifecycle
                    |--------------------------------------------------------------------------
                    */

            const lifecycleKey = `${ip}:${alarm.key}`;

            const existingAlarm = activeAlarms.get(lifecycleKey);

            let alertId;
            let startTime;

            /*
                    |--------------------------------------------------------------------------
                    | Existing Alarm
                    |--------------------------------------------------------------------------
                    */

            if (
              existingAlarm &&
              now.getTime() - existingAlarm.lastSeen < ALARM_GAP_MS
            ) {
              alertId = existingAlarm.alertId;

              startTime = existingAlarm.startTime;

              /*
                        | Update latest alarm information
                        */

              existingAlarm.lastSeen = now.getTime();

              existingAlarm.severity = alarm.severity;

              existingAlarm.alarmValue = alarm.title;

              activeAlarms.set(lifecycleKey, existingAlarm);
            } else {
              /*
                    |--------------------------------------------------------------------------
                    | New Alarm Occurrence
                    |--------------------------------------------------------------------------
                    */
              alertId = generateAlertId(now);

              startTime = now;

              activeAlarms.set(lifecycleKey, {
                alertId,

                deviceIp: ip,

                severity: alarm.severity,

                serviceName: alarm.key,

                alarmValue: alarm.title,

                startTime,

                lastSeen: now.getTime(),
              });
            }

            /*
                    |--------------------------------------------------------------------------
                    | Write ACTIVE Record
                    |--------------------------------------------------------------------------
                    */

            writeAlarmLog(
              baseDir,
              {
                alertId,

                deviceIp: ip,

                severity: alarm.severity,

                serviceName: alarm.key,

                alarmValue: alarm.title,

                startTime,

                endTime: null,

                status: "Active",
              },
              now,
            );
          }

          /*
                |--------------------------------------------------------------------------
                | Check For Alarms That Have Disappeared
                |--------------------------------------------------------------------------
                */

          clearExpiredAlarms(baseDir, now);

          channel.ack(msg);
        } catch (err) {
          console.error("Alarm Log Worker error:", err);

          channel.nack(msg, false, true);
        }
      },
    );
  } catch (err) {
    console.error("Worker failed to start:", err.message);

    try {
      await connection?.close();
    } catch {
      // Ignore close errors
    }

    scheduleRestart(err.message);
  }
}

startWorker();
