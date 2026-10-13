const Alarm = require("../models/Alarm");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function parsePagination(page, limit) {
  const pageNumber = Number(page) || DEFAULT_PAGE;
  const pageLimit = Number(limit) || DEFAULT_LIMIT;

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error("page must be a positive integer");
  }

  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_LIMIT}`);
  }

  return {
    pageNumber,
    pageLimit,
  };
}

async function getAlarms(filters = {}) {
  const {
    acknowledgement_status,
    alert_type,
    start_time,
    end_time,
    device_id,
    page = DEFAULT_PAGE,
    limit = DEFAULT_LIMIT,
  } = filters;

  const { pageNumber, pageLimit } = parsePagination(page, limit);

  const query = {};

  // -----------------------------------------
  // Acknowledgement status
  // false = active
  // true  = cleared
  // -----------------------------------------
  if (acknowledgement_status !== undefined) {
    if (!["true", "false"].includes(String(acknowledgement_status))) {
      throw new Error("acknowledgement_status must be true or false");
    }

    query.acknowledgement_status = String(acknowledgement_status) === "true";
  }

  // -----------------------------------------
  // Alert type
  // true  = device alarm
  // false = service / metric alarm
  // -----------------------------------------
  if (alert_type !== undefined) {
    if (!["true", "false"].includes(String(alert_type))) {
      throw new Error("alert_type must be true or false");
    }

    query.alert_type = String(alert_type) === "true";
  }

  // -----------------------------------------
  // Device
  // -----------------------------------------
  if (device_id) {
    query.device_id = device_id;
  }

  // -----------------------------------------
  // Time range
  // -----------------------------------------
  const { time_range } = filters;

  const now = new Date();
  let startDate;
  let endDate;

  // PRE DEFINED TIME RANGE
  switch (time_range) {
    case "last_1_hour":
      startDate = new Date(now.getTime() - 60 * 60 * 1000);
      endDate = now;
      break;

    case "last_24_hours":
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      endDate = now;
      break;

    case "last_7_days":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      endDate = now;
      break;

    case "today":
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;

    case "custom":
    case undefined:
      if (filters.start_time) {
        startDate = new Date(filters.start_time);

        if (isNaN(startDate.getTime())) {
          throw new Error("Invalid start_time");
        }
      }

      if (filters.end_time) {
        endDate = new Date(filters.end_time);

        if (isNaN(endDate.getTime())) {
          throw new Error("Invalid end_time");
        }
      }
      break;

    default:
      throw new Error(
        "Invalid time_range. Use last_1_hour, last_24_hours, last_7_days, today, or custom",
      );
  }

  if (startDate && endDate && startDate > endDate) {
    throw new Error("start_time must be earlier than or equal to end_time");
  }

  if (startDate || endDate) {
    query.created_at = {};

    if (startDate) {
      query.created_at.$gte = startDate;
    }

    if (endDate) {
      query.created_at.$lte = endDate;
    }
  }
  const skip = (pageNumber - 1) * pageLimit;

  const [alarms, total] = await Promise.all([
    Alarm.find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(pageLimit)
      .lean(),

    Alarm.countDocuments(query),
  ]);

  const data = alarms.map((alarm) => ({
    alert_id: alarm.alert_id,
    device_id: alarm.device_id,
    device_ip: alarm.device_ip,
    alert_type: alarm.alert_type,
    alert_severity: alarm.alert_severity,
    created_at: alarm.created_at,
    last_hard_state_change: alarm.last_hard_state_change,
    resolved_at: alarm.resolved_at,
    value: alarm.value,
    reason: alarm.reason,
    acknowledgement_status: alarm.acknowledgement_status,
    service_name: alarm.service_name,
  }));

  return {
    data,
    pagination: {
      page: pageNumber,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
}

// FETCH DEVICE WITH BATTERY BACKUP ALARM
async function getBatteryBackupAlarms(query = {}) {
  const { page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = query;

  const { pageNumber, pageLimit } = parsePagination(page, limit);

  // -----------------------------------------
  // Get all active battery backup alarms
  // -----------------------------------------
  const activeBatteryAlarms = await Alarm.find({
    service_name: "batteryBackup",
    resolved_at: null,
  })
    .sort({
      updatedAt: -1,
    })
    .lean();

  // -----------------------------------------
  // Keep only latest active alarm per device
  // -----------------------------------------
  const latestAlarmByIP = new Map();

  for (const alarm of activeBatteryAlarms) {
    if (!latestAlarmByIP.has(alarm.device_ip)) {
      latestAlarmByIP.set(alarm.device_ip, alarm);
    }
  }

  const ips = [...latestAlarmByIP.keys()];

  const total = ips.length;

  const skip = (pageNumber - 1) * pageLimit;

  // -----------------------------------------
  // Apply pagination
  // -----------------------------------------
  const paginatedIps = ips.slice(skip, skip + pageLimit);

  if (paginatedIps.length === 0) {
    return {
      data: [],

      pagination: {
        page: pageNumber,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit),
      },
    };
  }

  // -----------------------------------------
  // Get devices for current page
  // -----------------------------------------
  const devices = await Device.find({
    ip: {
      $in: paginatedIps,
    },
  })
    .select(
      [
        "_id",
        "ip",
        "deviceName",
        "deviceSerialNumber",
        "deviceStatus",
        "maintenanceMode",
      ].join(" "),
    )
    .lean();

  const deviceMap = new Map(devices.map((device) => [device.ip, device]));

  // -----------------------------------------
  // Build response
  // -----------------------------------------
  const data = await Promise.all(
    paginatedIps.map(async (ip) => {
      const alarm = latestAlarmByIP.get(ip);

      const device = deviceMap.get(ip);

      if (!device) {
        return null;
      }

      // Latest IMONI reading
      const latestReading = await SensorReading.findOne({
        ip,
      })
        .sort({
          timestamp: -1,
        })
        .select("batteryBackup timestamp")
        .lean();

      return {
        device_id: String(device._id),

        device_ip: device.ip || "",

        device_name: device.deviceName || "",

        device_serial_number: device.deviceSerialNumber || "",

        device_status: device.deviceStatus || "",

        maintenance_mode: device.maintenanceMode || "",

        // IMONI battery backup
        battery_backup: latestReading?.batteryBackup ?? null,

        alarm: {
          alert_id: alarm.alert_id || "",

          service_name: alarm.service_name || "batteryBackup",

          value: alarm.value ?? null,

          reason: alarm.reason || "",

          alert_severity: alarm.alert_severity || "",

          created_at: alarm.created_at ?? null,

          last_hard_state_change: alarm.last_hard_state_change ?? null,
        },

        timestamp: latestReading?.timestamp ?? null,
      };
    }),
  );

  const validData = data.filter(Boolean);

  return {
    data: validData,

    pagination: {
      page: pageNumber,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
}

module.exports = {
  getAlarms,
  getBatteryBackupAlarms,
};
