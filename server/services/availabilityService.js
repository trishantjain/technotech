const Device = require("../models/Device");

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

  return { pageNumber, pageLimit };
}

async function getDeviceAvailability(query = {}) {
  const { start_time, end_time, page, limit } = query;

  // Validate requested time range
  if (!start_time) {
    throw new Error("start_time is required");
  }

  if (!end_time) {
    throw new Error("end_time is required");
  }

  const startDate = new Date(start_time);
  const endDate = new Date(end_time);

  if (Number.isNaN(startDate.getTime())) {
    throw new Error("Invalid start_time");
  }

  if (Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid end_time");
  }

  if (startDate > endDate) {
    throw new Error("start_time must be earlier than or equal to end_time");
  }

  const { pageNumber, pageLimit } = parsePagination(page, limit);
  const skip = (pageNumber - 1) * pageLimit;

  // Fetch registered devices using your existing Device model
  const [totalDevices, devices] = await Promise.all([
    Device.countDocuments(),

    Device.find().sort({ createdAt: -1 }).skip(skip).limit(pageLimit).lean(),
  ]);

  const gridHours = Math.floor(Math.random() * 24);
  const gridMinutes = Math.floor(Math.random() * 60);

  // Dummy values for NMS integration testing only
  const availabilityData = devices.map((device) => {
    const availabilityValue = Number((70 + Math.random() * 29).toFixed(2));

    const downtimeValue = Number((Math.random() * 20).toFixed(2));

    const gridHours = Math.floor(Math.random() * 24);
    const gridMinutes = Math.floor(Math.random() * 60);

    return {
      rackId: device.rackId || String(device._id),

      availability: `${availabilityValue.toFixed(2)}%`,

      downtime_availability: `${downtimeValue.toFixed(2)}%`,

      grid_availability: `${gridHours}:${String(gridMinutes).padStart(2, "0")}`,

      start_time: startDate.toISOString(),

      end_time: endDate.toISOString(),
    };
  });

  return {
    data: availabilityData,

    pagination: {
      page: pageNumber,
      limit: pageLimit,
      total: totalDevices,
      totalPages: Math.ceil(totalDevices / pageLimit),
    },
  };
}

module.exports = {
  getDeviceAvailability,
};
