const Downtime = require("../models/Downtime");
const Device = require("../models/Device");

const maintenanceTimers = new Map();

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function parsePagination(page, limit) {

    const pageNumber =
        Number(page) || DEFAULT_PAGE;

    const pageLimit =
        Number(limit) || DEFAULT_LIMIT;

    if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1
    ) {
        throw new Error(
            "page must be a positive integer"
        );
    }

    if (
        !Number.isInteger(pageLimit) ||
        pageLimit < 1 ||
        pageLimit > MAX_LIMIT
    ) {
        throw new Error(
            `limit must be between 1 and ${MAX_LIMIT}`
        );
    }

    return {
        pageNumber,
        pageLimit
    };
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


// ======================================================
// CREATE DOWNTIME
// ======================================================
async function createDowntime(data = {}) {

    const {
        device_id,
        downtime_start,
        downtime_end,
        reason,
        initiated_by,
        notes,
        created_by
    } = data;


    // -----------------------------------------
    // Required field validation
    // -----------------------------------------

    if (!device_id) {
        throw new Error("device_id is required");
    }

    if (!downtime_start) {
        throw new Error("downtime_start is required");
    }

    if (!downtime_end) {
        throw new Error("downtime_end is required");
    }

    if (!reason) {
        throw new Error("reason is required");
    }

    if (!initiated_by) {
        throw new Error("initiated_by is required");
    }


    // -----------------------------------------
    // Validate device
    // -----------------------------------------

    const device = await Device.findById(device_id);

    if (!device) {
        throw new Error("Device not found");
    }


    // -----------------------------------------
    // Validate dates
    // -----------------------------------------

    const startDate = new Date(downtime_start);
    const endDate = new Date(downtime_end);

    if (isNaN(startDate.getTime())) {
        throw new Error("Invalid downtime_start");
    }

    if (isNaN(endDate.getTime())) {
        throw new Error("Invalid downtime_end");
    }

    if (endDate <= startDate) {
        throw new Error(
            "downtime_end must be greater than downtime_start"
        );
    }


    // -----------------------------------------
    // Create downtime record
    // -----------------------------------------

    const downtime = await Downtime.create({
        device_id,
        downtime_start: startDate,
        downtime_end: endDate,
        reason,
        initiated_by,
        notes: notes || "",
        created_by: created_by || "NMS"
    });


    // -----------------------------------------
    // Determine current downtime status
    // -----------------------------------------

    const now = new Date();

    let downtime_status;

    if (now < downtime.downtime_start) {
        downtime_status = "scheduled";

    } else if (
        now >= downtime.downtime_start &&
        now <= downtime.downtime_end
    ) {
        downtime_status = "active";

    } else {
        downtime_status = "expired";
    }


    // -----------------------------------------
    // Return API response object
    // -----------------------------------------

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

        notes: downtime.notes
    };
}


// ======================================================
// LIST DOWNTIME
// ======================================================
async function getDowntimes(queryParams = {}) {

    const {
        device_id,
        page = DEFAULT_PAGE,
        limit = DEFAULT_LIMIT
    } = queryParams;

    const {
        pageNumber,
        pageLimit
    } = parsePagination(
        page,
        limit
    );

    const query = {};

    if (device_id) {
        query.device_id = device_id;
    }

    const skip =
        (pageNumber - 1) * pageLimit;

    const [
        downtimes,
        total
    ] = await Promise.all([

        Downtime.find(query)
            .sort({ downtime_start: -1 })
            .skip(skip)
            .limit(pageLimit)
            .populate(
                "device_id",
                "ip deviceName"
            )
            .lean(),

        Downtime.countDocuments(query)
    ]);

    const data = downtimes.map(item => ({

        downtime_id:
            String(item._id),

        device_id:
            item.device_id?._id
                ? String(item.device_id._id)
                : String(item.device_id),

        downtime_start:
            item.downtime_start,

        downtime_end:
            item.downtime_end,

        reason:
            item.reason,

        initiated_by:
            item.initiated_by,

        downtime_status:
            getDowntimeStatus(
                new Date(item.downtime_start),
                new Date(item.downtime_end)
            ),

        created_by:
            item.created_by,

        created_at:
            item.createdAt,

        updated_at:
            item.updatedAt,

        notes:
            item.notes
    }));

    return {
        data,

        pagination: {
            page: pageNumber,
            limit: pageLimit,
            total,
            totalPages:
                Math.ceil(
                    total / pageLimit
                )
        }
    };
}


// ======================================================
// EDIT DOWNTIME
// ======================================================
async function updateDowntime(id, updateData = {}) {

    if (!id) {
        throw new Error("downtime_id is required");
    }

    const downtime =
        await Downtime.findById(id);

    if (!downtime) {
        throw new Error("Downtime record not found");
    }


    // -----------------------------------------
    // Fields allowed to be updated
    // -----------------------------------------

    const allowedFields = [
        "downtime_start",
        "downtime_end",
        "reason",
        "initiated_by",
        "notes"
    ];

    for (const field of allowedFields) {

        if (
            updateData[field] !== undefined
        ) {
            downtime[field] =
                updateData[field];
        }
    }


    // -----------------------------------------
    // Validate downtime dates
    // -----------------------------------------

    const startDate =
        new Date(downtime.downtime_start);

    const endDate =
        new Date(downtime.downtime_end);

    if (isNaN(startDate.getTime())) {
        throw new Error(
            "Invalid downtime_start"
        );
    }

    if (isNaN(endDate.getTime())) {
        throw new Error(
            "Invalid downtime_end"
        );
    }

    if (endDate <= startDate) {
        throw new Error(
            "downtime_end must be greater than downtime_start"
        );
    }


    // -----------------------------------------
    // Save updated downtime
    // -----------------------------------------

    await downtime.save();


    // -----------------------------------------
    // Determine current status
    // -----------------------------------------

    const now = new Date();

    let downtime_status;

    if (now < downtime.downtime_start) {

        downtime_status = "scheduled";

    } else if (
        now >= downtime.downtime_start &&
        now <= downtime.downtime_end
    ) {

        downtime_status = "active";

    } else {

        downtime_status = "expired";
    }


    // -----------------------------------------
    // Return standardized response
    // -----------------------------------------

    return {
        downtime_id:
            String(downtime._id),

        device_id:
            String(downtime.device_id),

        downtime_start:
            downtime.downtime_start,

        downtime_end:
            downtime.downtime_end,

        reason:
            downtime.reason,

        initiated_by:
            downtime.initiated_by,

        downtime_status,

        created_by:
            downtime.created_by,

        created_at:
            downtime.createdAt,

        updated_at:
            downtime.updatedAt,

        notes:
            downtime.notes
    };
}


// ======================================================
// DELETE DOWNTIME
// ======================================================
async function deleteDowntime(downtimeIds) {

    // -----------------------------------------
    // Validate input
    // -----------------------------------------

    if (
        !Array.isArray(downtimeIds) ||
        downtimeIds.length === 0
    ) {
        throw new Error(
            "downtime_ids must be a non-empty array"
        );
    }


    // -----------------------------------------
    // Remove duplicate IDs
    // -----------------------------------------

    const uniqueIds = [
        ...new Set(downtimeIds.map(String))
    ];


    // -----------------------------------------
    // Find records first
    // -----------------------------------------

    const existingDowntimes =
        await Downtime.find({
            _id: {
                $in: uniqueIds
            }
        }).select("_id");


    if (existingDowntimes.length === 0) {
        throw new Error(
            "No downtime records found"
        );
    }


    // -----------------------------------------
    // Delete records
    // -----------------------------------------

    const existingIds =
        existingDowntimes.map(
            item => String(item._id)
        );

    await Downtime.deleteMany({
        _id: {
            $in: existingIds
        }
    });


    // -----------------------------------------
    // Return standardized result
    // -----------------------------------------

    return {
        requested_count:
            uniqueIds.length,

        deleted_count:
            existingIds.length,

        deleted_downtime_ids:
            existingIds
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
        downtime_end: { $gte: new Date() }
    }).select("_id device_id");

    for (const downtime of activeDowntimes) {

        const timer = maintenanceTimers.get(
            String(downtime._id)
        );

        if (timer) {
            clearTimeout(timer);
            maintenanceTimers.delete(
                String(downtime._id)
            );
        }
    }

    await Device.updateMany(
        { _id: { $in: deviceIds } },
        {
            $set: {
                maintenanceMode: "Inactive"
            }
        }
    );

    return {
        success: true,
        deviceIds
    };
}


async function syncDeviceMaintenanceMode(deviceId) {
    const now = new Date();

    const activeDowntime = await Downtime.findOne({
        device_id: deviceId,
        downtime_start: { $lte: now },
        downtime_end: { $gte: now }
    }).lean();

    await Device.updateOne(
        { _id: deviceId },
        {
            $set: {
                maintenanceMode: activeDowntime
                    ? "Active"
                    : "Inactive"
            }
        }
    );

    return Boolean(activeDowntime);
}


async function restoreMaintenanceTimers() {

    try {
        const now = new Date();

        const downtimes = await Downtime.find({
            downtime_end: { $gt: now }
        }).lean();

        for (const downtime of downtimes) {
            await syncDeviceMaintenanceMode(downtime.device_id);

            scheduleMaintenanceExpiry(downtime);
        }

        console.log(
            `🔄 Restored ${downtimes.length} maintenance timers`
        );

    } catch (error) {
        console.error(
            "❌ Failed to restore maintenance timers:",
            error
        );
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
                await syncDeviceMaintenanceMode(
                    downtime.device_id
                );

                console.log(`🟢 Maintenance started: ${downtime.device_id}`);

                scheduleMaintenanceExpiry(downtime);

            } catch (error) {
                console.error(
                    "❌ Failed to start maintenance:",
                    error
                );
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

            await syncDeviceMaintenanceMode(
                downtime.device_id
            );

            maintenanceTimers.delete(downtimeId);

            console.log(
                `🔴 Maintenance expired: ${downtime.device_id}`
            );

        } catch (error) {
            console.error(
                "❌ Failed to expire maintenance:",
                error
            );
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
    stopMaintenance
};