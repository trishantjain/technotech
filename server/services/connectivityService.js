const mongoose = require("mongoose");
const Device = require("../models/Device");
const Ping = require("../models/Ping");

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

function parsePagination(pageNumber, pageSize) {
    const page = Number(pageNumber) || DEFAULT_PAGE;
    const size = Number(pageSize) || DEFAULT_PAGE_SIZE;

    if (!Number.isInteger(page) || page < 1) {
        throw new Error("pageNumber must be a positive integer");
    }

    if (
        !Number.isInteger(size) ||
        size < 1 ||
        size > MAX_PAGE_SIZE
    ) {
        throw new Error(
            `pageSize must be between 1 and ${MAX_PAGE_SIZE}`
        );
    }

    return { pageNumber: page, pageSize: size };
}

function toMilliseconds(value, fieldName) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    const seconds = Number(value);

    if (!Number.isSafeInteger(seconds) || seconds < 0) {
        throw new Error(
            `${fieldName} must be a valid Unix timestamp in seconds`
        );
    }

    const milliseconds = seconds * 1000;

    if (!Number.isSafeInteger(milliseconds)) {
        throw new Error(`${fieldName} is outside the supported range`);
    }

    return milliseconds;
}

async function getPing(body = {}) {
    const {
        deviceId,
        startTimeTicks,
        endTimeTicks,
        pageSize,
        pageNumber
    } = body;

    const pagination = parsePagination(pageNumber, pageSize);
    const { pageSize: size, pageNumber: page } = pagination;

    if (
        deviceId !== undefined &&
        (
            typeof deviceId !== "string" ||
            !/^[a-fA-F0-9]{24}$/.test(deviceId) ||
            !mongoose.Types.ObjectId.isValid(deviceId)
        )
    ) {
        throw new Error("deviceId must be a valid MongoDB Device _id");
    }

    const startMs = toMilliseconds(
        startTimeTicks,
        "startTimeTicks"
    );

    const endMs = toMilliseconds(
        endTimeTicks,
        "endTimeTicks"
    );

    if (
        startMs !== undefined &&
        endMs !== undefined &&
        startMs > endMs
    ) {
        throw new Error(
            "startTimeTicks cannot be greater than endTimeTicks"
        );
    }

    const deviceFilter = {};

    if (deviceId) {
        deviceFilter._id = new mongoose.Types.ObjectId(deviceId);
    }

    const skip = (page - 1) * size;

    const [totalDevices, devices] = await Promise.all([
        Device.countDocuments(deviceFilter),

        Device.find(deviceFilter)
            .select("_id deviceName")
            .sort({ _id: 1 })
            .skip(skip)
            .limit(size)
            .lean()
    ]);

    const connectivityData = await Promise.all(
        devices.map(async (device, index) => {
            const pingFilter = {
                deviceId: String(device._id)
            };

            if (startMs !== undefined || endMs !== undefined) {
                pingFilter.sendTimeTicks = {};

                if (startMs !== undefined) {
                    pingFilter.sendTimeTicks.$gte = startMs;
                }

                if (endMs !== undefined) {
                    pingFilter.sendTimeTicks.$lte = endMs;
                }
            }

            const pingData = await Ping.find(pingFilter)
                .select("sendTimeTicks response -_id")
                .sort({ sendTimeTicks: 1 })
                .lean();

            const totalPings = pingData.length;

            const failedPings = pingData.filter(
                ping => ping.response === false
            ).length;

            const packetLoss = totalPings > 0
                ? Number(
                    ((failedPings / totalPings) * 100).toFixed(2)
                )
                : 0;

            return {
                srNo: skip + index + 1,
                deviceId: String(device._id),
                deviceName: device.deviceName || "",

                statistics: {
                    // Ping records currently do not store latency.
                    minimumPing: null,
                    maximumPing: null,
                    averagePing: null,
                    packetLoss
                },

                pingData: pingData.map(ping => ({
                    sendTimeTicks: ping.sendTimeTicks,
                    response: ping.response
                }))
            };
        })
    );

    return {
        data: {
            totalDevices,
            connectivityData
        },
        pagination: {
            page,
            pageSize: size,
            total: totalDevices,
            totalPages: Math.ceil(totalDevices / size)
        }
    };
}

module.exports = {
    getPing
};
