const Downtime = require("../models/Downtime");
const Device = require("../models/Device");

const mongoose = require("mongoose");

const maintenanceTimers = new Map();

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function parsePagination(page, limit) {
  const pageNumber =
    page === undefined || page === "" ? DEFAULT_PAGE : Number(page);

  const pageLimit =
    limit === undefined || limit === "" ? DEFAULT_LIMIT : Number(limit);

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

function normalizeIdList(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const values = Array.isArray(value) ? value : String(value).split(",");

  const ids = [
    ...new Set(
      values.map((value) =>
        typeof value === "string" ? value.trim() : String(value).trim(),
      ),
    ),
  ];

  if (ids.length === 0 || ids.some((id) => !id)) {
    throw new Error(`${fieldName} must be a non-empty array`);
  }

  const invalidIds = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));

  if (invalidIds.length > 0) {
    throw new Error(
      `${fieldName} contains invalid MongoDB ObjectId values: ${invalidIds.join(", ")}`,
    );
  }

  return ids;
}

function getDowntimeStatus(start, end) {
  const now = new Date();

  if (now < start) {
    return "scheduled";
  }

  if (now >= start && now <= end) {
    return "active";
  }

  return "expired";
}

function validateDowntimeDates(start, end, { rejectPastStart = false } = {}) {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (!start || isNaN(startDate.getTime())) {
    throw new Error("Invalid downtime_start");
  }

  if (!end || isNaN(endDate.getTime())) {
    throw new Error("Invalid downtime_end");
  }

  if (endDate <= startDate) {
    throw new Error("downtime_end must be greater than downtime_start");
  }

  if (rejectPastStart && startDate.getTime() < Date.now()) {
    throw new Error("downtime_start cannot be in the past");
  }

  return { startDate, endDate };
}

// ======================================================
// CREATE DOWNTIME
// ======================================================
// async function createDowntime(data = {}) {
//   const {
//     device_id,
//     downtime_start,
//     downtime_end,
//     reason,
//     initiated_by,
//     notes,
//     created_by,
//   } = data;

//   // -----------------------------------------
//   // Required field validation
//   // -----------------------------------------

//   if (!device_id) {
//     throw new Error("device_id is required");
//   }

//   if (!downtime_start) {
//     throw new Error("downtime_start is required");
//   }

//   if (!downtime_end) {
//     throw new Error("downtime_end is required");
//   }

//   if (!reason) {
//     throw new Error("reason is required");
//   }

//   if (!initiated_by) {
//     throw new Error("initiated_by is required");
//   }

//   // -----------------------------------------
//   // Validate device
//   // -----------------------------------------

//   const device = await Device.findById(device_id);

//   if (!device) {
//     throw new Error("Device not found");
//   }

//   // -----------------------------------------
//   // Validate dates
//   // -----------------------------------------

//   const startDate = new Date(downtime_start);
//   const endDate = new Date(downtime_end);

//   if (isNaN(startDate.getTime())) {
//     throw new Error("Invalid downtime_start");
//   }

//   if (isNaN(endDate.getTime())) {
//     throw new Error("Invalid downtime_end");
//   }

//   if (endDate <= startDate) {
//     throw new Error("downtime_end must be greater than downtime_start");
//   }

//   // PAST DATE & TIME CHECK
//   const now = new Date();

//   if (startDate < now) {
//     throw new Error("downtime start date can't be of past date");
//   }

//   if (endDate < now) {
//     throw new Error("downtime end date can't be of past date");
//   }

//   // -----------------------------------------
//   // Create downtime record
//   // -----------------------------------------

//   const downtime = await Downtime.create({
//     device_id,
//     downtime_start: startDate,
//     downtime_end: endDate,
//     reason,
//     initiated_by,
//     notes: notes || "",
//     created_by: created_by || "NMS",
//   });

//   // -----------------------------------------
//   // Determine current downtime status
//   // -----------------------------------------
//   const statusCheckTime = new Date();

//   let downtime_status;

//   if (now < downtime.downtime_start) {
//     downtime_status = "scheduled";
//   } else if (
//     statusCheckTime >= downtime.downtime_start &&
//     statusCheckTime <= downtime.downtime_end
//   ) {
//     downtime_status = "active";
//   } else {
//     downtime_status = "expired";
//   }

//   // -----------------------------------------
//   // Return API response object
//   // -----------------------------------------

//   return {
//     downtime_id: String(downtime._id),

//     device_id: String(downtime.device_id),

//     downtime_start: downtime.downtime_start,

//     downtime_end: downtime.downtime_end,

//     reason: downtime.reason,

//     initiated_by: downtime.initiated_by,

//     downtime_status,

//     created_by: downtime.created_by,

//     created_at: downtime.createdAt,

//     updated_at: downtime.updatedAt,

//     notes: downtime.notes,
//   };
// }

// ======================================================
// CREATE DOWNTIME | HANDLING MULTIPLE DEVICES
// ======================================================
async function createDowntime(data = {}) {
  const {
    device_ids,
    device_id,
    downtime_start,
    downtime_end,
    reason,
    initiated_by,
    notes,
    created_by,
  } = data;

  // -----------------------------------------
  // Normalize device IDs
  // -----------------------------------------
  const deviceIds = Array.isArray(device_ids)
    ? device_ids
    : device_id
      ? [device_id]
      : [];

  // -----------------------------------------
  // Required field validation
  // -----------------------------------------
  if (deviceIds.length === 0) {
    throw new Error("device_ids is required and must be a non-empty array");
  }

  if (deviceIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("Every device ID must be a non-empty string");
  }

  const uniqueDeviceIds = [...new Set(deviceIds.map((id) => id.trim()))];

  // Validate MongoDB ObjectId format before querying
  const invalidFormatIds = uniqueDeviceIds.filter(
    (id) => !/^[a-fA-F0-9]{24}$/.test(id),
  );

  if (invalidFormatIds.length > 0) {
    throw new Error(
      `Invalid MongoDB device ID format: ${invalidFormatIds.join(", ")}`,
    );
  }

  if (!downtime_start) {
    throw new Error("downtime_start is required");
  }

  if (!downtime_end) {
    throw new Error("downtime_end is required");
  }

  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error("reason is required");
  }

  if (typeof initiated_by !== "string" || !initiated_by.trim()) {
    throw new Error("initiated_by is required");
  }

  // -----------------------------------------
  // Validate device
  // -----------------------------------------
  const devices = await Device.find({
    _id: { $in: uniqueDeviceIds },
  }).select("_id");

  const foundIds = new Set(devices.map((device) => String(device._id)));

  const invalidIds = uniqueDeviceIds.filter((id) => !foundIds.has(id));

  if (invalidIds.length > 0) {
    throw new Error(`Device(s) not found: ${invalidIds.join(", ")}`);
  }

  // -----------------------------------------
  // Validate dates
  // -----------------------------------------
  // const startDate = new Date(downtime_start);
  // const endDate = new Date(downtime_end);

  // if (isNaN(startDate.getTime())) {
  //   throw new Error("Invalid downtime_start");
  // }

  // if (isNaN(endDate.getTime())) {
  //   throw new Error("Invalid downtime_end");
  // }

  // if (endDate <= startDate) {
  //   throw new Error("downtime_end must be greater than downtime_start");
  // }

  // // PAST DATE & TIME CHECK
  // const now = new Date();

  // if (startDate < now) {
  //   throw new Error("downtime start date can't be of past date");
  // }

  // if (endDate < now) {
  //   throw new Error("downtime end date can't be of past date");
  // }

  const { startDate, endDate } = validateDowntimeDates(
    downtime_start,
    downtime_end,
    { rejectPastStart: true },
  );

  // -----------------------------------------
  // Create one downtime record per device
  // -----------------------------------------
  const records = uniqueDeviceIds.map((id) => ({
    device_id: id,
    downtime_start: startDate,
    downtime_end: endDate,
    reason,
    initiated_by,
    notes: notes || "",
    created_by: created_by || "NMS",
  }));

  const createdRecords = await Downtime.insertMany(records);

  for (const downtime of createdRecords) {
    await syncDeviceMaintenanceMode(downtime.device_id);
    scheduleMaintenanceExpiry(downtime);
  }

  // -----------------------------------------
  // Determine status and format response
  // -----------------------------------------
  const statusCheckTime = new Date();

  const downtimeRecords = createdRecords.map((downtime) => {
    let downtime_status;

    if (statusCheckTime < downtime.downtime_start) {
      downtime_status = "scheduled";
    } else if (
      statusCheckTime >= downtime.downtime_start &&
      statusCheckTime <= downtime.downtime_end
    ) {
      downtime_status = "active";
    } else {
      downtime_status = "expired";
    }

    return {
      downtime_id: String(downtime._id),
      device_id: String(downtime.device_id),
      downtime_start: downtime.downtime_start,
      downtime_end: downtime.downtime_end,
      reason: downtime.reason,
      initiated_by: downtime.initiated_by,
      downtime_status,
      created_by: downtime.created_by,
      created_at: downtime.createdAt,
      updated_at: downtime.updatedAt,
      notes: downtime.notes,
    };
  });

  // -----------------------------------------
  // Return API response object
  // -----------------------------------------

  return {
    totalCreated: downtimeRecords.length,
    downtimeRecords,
  };
}

// ======================================================
// LIST DOWNTIME
// ======================================================
async function getDowntimes(queryParams = {}) {
  const {
    deviceid,
    device_id,
    device_ids,
    status = "active_scheduled",
    page,
    limit,
  } = queryParams;

  const { pageNumber, pageLimit } = parsePagination(page, limit);

  const query = {};
  const now = new Date();

  const requestedDeviceIds =
    device_ids !== undefined
      ? device_ids
      : device_id !== undefined
        ? device_id
        : deviceid;

  if (requestedDeviceIds !== undefined) {
    const deviceIds = normalizeIdList(requestedDeviceIds, "device_id");

    query.device_id =
      deviceIds.length === 1 ? deviceIds[0] : { $in: deviceIds };
  }

  if (!["active_scheduled", "active", "scheduled", "all"].includes(status)) {
    throw new Error(
      "status must be one of active_scheduled, active, scheduled, or all",
    );
  }

  if (status === "active_scheduled") {
    query.downtime_end = { $gte: now };
  } else if (status === "active") {
    query.downtime_start = { $lte: now };
    query.downtime_end = { $gte: now };
  } else if (status === "scheduled") {
    query.downtime_start = { $gt: now };
  }

  // // Support both single and multiple device IDs.
  // let deviceIds = [];

  // if (device_ids !== undefined) {
  //   // Accept either an array or comma-separated query parameter.
  //   deviceIds = Array.isArray(device_ids)
  //     ? device_ids
  //     : String(device_ids).split(",");
  // } else if (device_id !== undefined) {
  //   deviceIds = Array.isArray(device_id) ? device_id : [device_id];
  // }

  // if (deviceIds.length > 0) {
  //   // Trim values and remove duplicates.
  //   deviceIds = [
  //     ...new Set(
  //       deviceIds.map((id) => (typeof id === "string" ? id.trim() : "")),
  //     ),
  //   ];

  //   // Reject empty or invalid MongoDB ObjectId values.
  //   if (deviceIds.some((id) => !/^[a-fA-F0-9]{24}$/.test(id))) {
  //     throw new Error(
  //       "Every device ID must be a valid 24-character hexadecimal MongoDB ObjectId",
  //     );
  //   }

  //   // One ID uses equality; multiple IDs use $in.
  //   query.device_id =
  //     deviceIds.length === 1 ? deviceIds[0] : { $in: deviceIds };
  // }

  const skip = (pageNumber - 1) * pageLimit;

  const [downtimes, total] = await Promise.all([
    Downtime.find(query)
      .sort({ downtime_start: -1 })
      .skip(skip)
      .limit(pageLimit)
      .populate("device_id", "ip deviceName")
      .lean(),

    Downtime.countDocuments(query),
  ]);

  const data = downtimes.map((item) => ({
    downtime_id: String(item._id),

    device_id: item.device_id?._id
      ? String(item.device_id._id)
      : String(item.device_id),

    downtime_start: item.downtime_start,

    downtime_end: item.downtime_end,

    reason: item.reason,

    initiated_by: item.initiated_by,

    downtime_status: getDowntimeStatus(
      new Date(item.downtime_start),
      new Date(item.downtime_end),
    ),

    created_by: item.created_by,

    created_at: item.createdAt,

    updated_at: item.updatedAt,

    notes: item.notes,
  }));

  return {
    data,
    count: total,
    pagination: {
      page: pageNumber,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
}

// ======================================================
// EDIT DOWNTIME
// ======================================================
async function updateDowntime(id, updateData = {}) {
  const downtimeIds = Array.isArray(id) ? id : [id];

  if (
    downtimeIds.length === 0 ||
    downtimeIds.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(
      "downtime_id must be provided as a string or a non-empty array of IDs",
    );
  }

  const uniqueIds = [...new Set(downtimeIds.map((item) => item.trim()))];

  // -----------------------------------------
  // Fields allowed to be updated
  // -----------------------------------------
  const allowedFields = [
    "downtime_start",
    "downtime_end",
    "reason",
    "initiated_by",
    "notes",
  ];

  const hasUpdates = allowedFields.some(
    (field) => updateData[field] !== undefined,
  );

  if (!hasUpdates) {
    throw new Error("No valid fields provided for update");
  }

  // -----------------------------------------
  // Fetch and validate ALL downtime records
  // -----------------------------------------
  const records = await Downtime.find({
    _id: { $in: uniqueIds },
  });

  const foundIds = new Set(records.map((record) => String(record._id)));

  const missingIds = uniqueIds.filter((id) => !foundIds.has(id));

  if (missingIds.length > 0) {
    throw new Error(`Downtime record(s) not found: ${missingIds.join(", ")}`);
  }

  // -----------------------------------------
  // Validate proposed dates before saving
  // -----------------------------------------
  for (const downtime of records) {
    const proposedStart =
      updateData.downtime_start !== undefined
        ? new Date(updateData.downtime_start)
        : new Date(downtime.downtime_start);

    const proposedEnd =
      updateData.downtime_end !== undefined
        ? new Date(updateData.downtime_end)
        : new Date(downtime.downtime_end);

    if (isNaN(proposedStart.getTime())) {
      throw new Error("Invalid downtime_start");
    }

    if (isNaN(proposedEnd.getTime())) {
      throw new Error("Invalid downtime_end");
    }

    if (proposedEnd <= proposedStart) {
      throw new Error("downtime_end must be greater than downtime_start");
    }
  }

  // -----------------------------------------
  // Apply updates
  // -----------------------------------------

  for (const downtime of records) {
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        downtime[field] = updateData[field];
      }
    }
  }

  // Validate and save as a group
  await Promise.all(records.map((record) => record.validate()));

  await Promise.all(records.map((record) => record.save()));

  // -----------------------------------------
  // Determine current status
  // -----------------------------------------

  const now = new Date();

  const downtimeRecords = records.map((downtime) => {
    let downtime_status;

    if (now < downtime.downtime_start) {
      downtime_status = "scheduled";
    } else if (now >= downtime.downtime_start && now <= downtime.downtime_end) {
      downtime_status = "active";
    } else {
      downtime_status = "expired";
    }

    return {
      downtime_id: String(downtime._id),
      device_id: String(downtime.device_id),
      downtime_start: downtime.downtime_start,
      downtime_end: downtime.downtime_end,
      reason: downtime.reason,
      initiated_by: downtime.initiated_by,
      downtime_status,
      created_by: downtime.created_by,
      created_at: downtime.createdAt,
      updated_at: downtime.updatedAt,
      notes: downtime.notes,
    };
  });

  // -----------------------------------------
  // Return standardized response
  // -----------------------------------------
  return {
    totalUpdated: downtimeRecords.length,
    downtimeRecords,
  };
}

// ======================================================
// DELETE DOWNTIME
// ======================================================
async function deleteDowntime(downtimeIds, deviceIds) {
  // -----------------------------------------
  // Validate input
  // -----------------------------------------

  const normalizedDowntimeIds = normalizeIdList(downtimeIds, "downtime_ids");

  const normalizedDeviceIds = normalizeIdList(deviceIds, "device_ids");

  if (normalizedDowntimeIds.length === 0 && normalizedDeviceIds.length === 0) {
    throw new Error("Provide downtime_ids/downtime_id or device_ids/device_id");
  }

  const queryParts = [];

  if (normalizedDowntimeIds.length > 0) {
    queryParts.push({
      _id:
        normalizedDowntimeIds.length === 1
          ? normalizedDowntimeIds[0]
          : { $in: normalizedDowntimeIds },
    });
  }

  if (normalizedDeviceIds.length > 0) {
    queryParts.push({
      device_id:
        normalizedDeviceIds.length === 1
          ? normalizedDeviceIds[0]
          : { $in: normalizedDeviceIds },
    });
  }

  const deleteQuery =
    queryParts.length === 1 ? queryParts[0] : { $or: queryParts };

  // -----------------------------------------
  // Find records first
  // -----------------------------------------
  const existingDowntimes = await Downtime.find(deleteQuery)
    .select("_id device_id")
    .lean();

  if (existingDowntimes.length === 0) {
    throw new Error("No downtime records found");
  }

  // -----------------------------------------
  // Delete records
  // -----------------------------------------
  const existingDowntimeIds = existingDowntimes.map((item) => String(item._id));

  const affectedDeviceIds = [
    ...new Set(existingDowntimes.map((item) => String(item.device_id))),
  ];

  const deleteResult = await Downtime.deleteMany({
    _id: { $in: existingDowntimeIds },
  });

  for (const affectedDeviceId of affectedDeviceIds) {
    await syncDeviceMaintenanceMode(affectedDeviceId);
  }

  // -----------------------------------------
  // Return standardized result
  // -----------------------------------------
  return {
    requested_downtime_count: normalizedDowntimeIds.length,
    requested_device_count: normalizedDeviceIds.length,
    deleted_count: deleteResult.deletedCount,
    deleted_downtime_ids: existingDowntimeIds,
    affected_device_ids: affectedDeviceIds,
  };
}

// ======================================================
// STOP MAINTENANCE
// ======================================================
async function stopMaintenance(deviceIds) {
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    throw new Error("device_id must be a non-empty array");
  }

  const activeDowntimes = await Downtime.find({
    device_id: { $in: deviceIds },
    downtime_start: { $lte: new Date() },
    downtime_end: { $gte: new Date() },
  }).select("_id device_id");

  for (const downtime of activeDowntimes) {
    const timer = maintenanceTimers.get(String(downtime._id));

    if (timer) {
      clearTimeout(timer);
      maintenanceTimers.delete(String(downtime._id));
    }
  }

  await Device.updateMany(
    { _id: { $in: deviceIds } },
    {
      $set: {
        maintenanceMode: "Inactive",
      },
    },
  );

  return {
    success: true,
    deviceIds,
  };
}

async function syncDeviceMaintenanceMode(deviceId) {
  const now = new Date();

  const activeDowntime = await Downtime.findOne({
    device_id: deviceId,
    downtime_start: { $lte: now },
    downtime_end: { $gte: now },
  }).lean();

  await Device.updateOne(
    { _id: deviceId },
    {
      $set: {
        maintenanceMode: activeDowntime ? "Active" : "Inactive",
      },
    },
  );

  return Boolean(activeDowntime);
}

async function restoreMaintenanceTimers() {
  try {
    const now = new Date();

    const downtimes = await Downtime.find({
      downtime_end: { $gt: now },
    }).lean();

    for (const downtime of downtimes) {
      await syncDeviceMaintenanceMode(downtime.device_id);

      scheduleMaintenanceExpiry(downtime);
    }

    console.log(`🔄 Restored ${downtimes.length} maintenance timers`);
  } catch (error) {
    console.error("❌ Failed to restore maintenance timers:", error);
  }
}

function scheduleMaintenanceExpiry(downtime) {
  const downtimeId = String(downtime._id);

  // Clear existing timer for this downtime
  if (maintenanceTimers.has(downtimeId)) {
    clearTimeout(maintenanceTimers.get(downtimeId));
    maintenanceTimers.delete(downtimeId);
  }

  const now = Date.now();
  const start = new Date(downtime.downtime_start).getTime();
  const end = new Date(downtime.downtime_end).getTime();

  // --------------------------------------------------
  // Downtime already expired
  // --------------------------------------------------
  if (end <= now) {
    return;
  }

  // --------------------------------------------------
  // Future downtime
  // --------------------------------------------------
  if (start > now) {
    const startTimer = setTimeout(async () => {
      try {
        await syncDeviceMaintenanceMode(downtime.device_id);

        console.log(`🟢 Maintenance started: ${downtime.device_id}`);

        scheduleMaintenanceExpiry(downtime);
      } catch (error) {
        console.error("❌ Failed to start maintenance:", error);
      }
    }, start - now);

    maintenanceTimers.set(downtimeId, startTimer);

    return;
  }

  // --------------------------------------------------
  // Already active → schedule expiry
  // --------------------------------------------------
  const expiryTimer = setTimeout(async () => {
    try {
      await syncDeviceMaintenanceMode(downtime.device_id);

      maintenanceTimers.delete(downtimeId);

      console.log(`🔴 Maintenance expired: ${downtime.device_id}`);
    } catch (error) {
      console.error("❌ Failed to expire maintenance:", error);
    }
  }, end - now);

  maintenanceTimers.set(downtimeId, expiryTimer);
}

restoreMaintenanceTimers();

// setInterval(syncAllMaintenanceModes, 60 * 1000);

module.exports = {
  createDowntime,
  getDowntimes,
  updateDowntime,
  deleteDowntime,
  getDowntimeStatus,
  syncDeviceMaintenanceMode,
  stopMaintenance,
};
