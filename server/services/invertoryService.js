const Device = require("../models/Device");
const Downtime = require("../models/Downtime");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;


function parsePagination(page, limit) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const pageLimit = Number(limit) || DEFAULT_LIMIT;

    if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1
    ) {
        throw new Error("page must be a positive integer");
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


function toUnixSeconds(value) {
    if (!value) {
        return 0;
    }

    const numericValue = Number(value);

    // Date.now() values are stored in milliseconds.
    if (numericValue > 100000000000) {
        return Math.floor(numericValue / 1000);
    }

    return Math.floor(numericValue);
}


async function getInventory(query = {}) {

    const {
        page,
        limit
    } = query;

    const {
        pageNumber,
        pageLimit
    } = parsePagination(page, limit);

    const skip =
        (pageNumber - 1) * pageLimit;

    const [
        totalCabinets,
        devices
    ] = await Promise.all([
        Device.countDocuments(),

        Device.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(pageLimit)
            .lean()
    ]);

    const deviceIds =
        devices.map(device => device._id);

    const now = new Date();

    /*
     * Find devices that currently fall inside
     * an active downtime window.
     */
    const activeDowntimes =
        await Downtime.find({
            device_id: {
                $in: deviceIds
            },
            downtime_start: {
                $lte: now
            },
            downtime_end: {
                $gte: now
            }
        })
            .select("device_id")
            .lean();

    const activeDowntimeDeviceIds =
        new Set(
            activeDowntimes.map(
                item => String(item.device_id)
            )
        );

    const cabinetData =
        devices.map((device, index) => {

            const isInDowntime =
                activeDowntimeDeviceIds.has(
                    String(device._id)
                );

            let deviceStatus;

            if (isInDowntime) {
                deviceStatus = "in_downtime";

            } else {
                deviceStatus =
                    device.deviceStatus === "UP"
                        ? "up"
                        : "down";
            }

            return {

                srNo:
                    skip + index + 1,

                deviceId:
                    String(device._id),

                deviceName:
                    device.deviceName || "",

                createdAt:
                    device.createdAt
                        ? Math.floor(
                            new Date(
                                device.createdAt
                            ).getTime() / 1000
                        )
                        : 0,

                vendorName:
                    device.vendorName || "",

                state:
                    device.status === "approved"
                        ? "active"
                        : "inactive",

                modelNumber:
                    device.modelNumber || "",

                deviceSerialNumber:
                    device.deviceSerialNumber || "",

                deviceType:
                    device.deviceType || "",

                deviceIp:
                    device.ip || "",

                location:
                    device.address || "",

                latitude:
                    device.latitude ?? 0,

                longitude:
                    device.longitude ?? 0,

                /*
                 * up
                 * down
                 * in_downtime
                 */
                deviceStatus,

                maintenanceMode:
                    isInDowntime
                        ? "Active"
                        : "Inactive",

                swVersion:
                    device.swVersion || "",

                modifyTimeTicks:
                    toUnixSeconds(
                        device.modifyTimeTicks
                    ),

                modifyField:
                    device.modifyField || "",

                lastStatusChangeTimeTicks:
                    toUnixSeconds(
                        device.lastStatusChangeTimeTicks
                    ),

                upsSoftwareVersion:
                    device.upsSoftwareVersion || "",

                rectifier1Version:
                    device.rectifier1Version || "",

                rectifier1SrNo:
                    device.rectifier1SrNo || "",

                rectifier2Version:
                    device.rectifier2Version || "",

                rectifier2SrNo:
                    device.rectifier2SrNo || "",

                solarMpptVersion:
                    device.solarMpptVersion || "",

                solarMpptSrNo:
                    device.solarMpptSrNo || "",

                inverterSrNo:
                    device.inverterSrNo || "",

                upsBatterySrNo:
                    device.upsBatterySrNo || ""
            };
        });

    return {
        data: {
            totalCabinets,
            cabinetData
        },

        pagination: {
            page: pageNumber,
            limit: pageLimit,
            total: totalCabinets,
            totalPages:
                Math.ceil(
                    totalCabinets / pageLimit
                )
        }
    };
}


module.exports = {
    getInventory
};