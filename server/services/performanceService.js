const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const { buildService } = require("../utils/nmsServiceBuilder");
const serviceConfig = require("../config/nmsServiceConfig");

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

async function getPerformance(query = {}) {
  const { page, limit } = query;

  const { pageNumber, pageLimit } = parsePagination(page, limit);

  const skip = (pageNumber - 1) * pageLimit;

  const [totalCabinets, devices] = await Promise.all([
    Device.countDocuments(),

    Device.find().sort({ createdAt: -1 }).skip(skip).limit(pageLimit).lean(),
  ]);

  const cabinetData = await Promise.all(
    devices.map(async (device, index) => {
      const latestReading = await SensorReading.findOne({
        ip: device.ip,
      })
        .sort({
          timestamp: -1,
        })
        .lean();

      const services = [];

      if (latestReading) {
        serviceConfig.forEach((service) => {
          services.push(
            buildService({
              description: service.getDescription
                ? service.getDescription(latestReading)
                : service.description,

              serviceName: service.serviceName,

              value: service.getValue
                ? service.getValue(latestReading)
                : service.field
                  ? latestReading[service.field]
                  : null,

              unit: service.unit,

              status: service.getStatus
                ? service.getStatus(latestReading)
                : service.status,
            }),
          );
        });
      }

      return {
        srNo: skip + index + 1,

        cabinetId: String(device._id),

        cabinetName: device.deviceName || "",

        timeTicks: latestReading
          ? Math.floor(new Date(latestReading.timestamp).getTime() / 1000)
          : 0,

        timeStamp: latestReading ? latestReading.timestamp : null,

        services,
      };
    }),
  );

  return {
    data: {
      totalCabinets,
      cabinetData,
    },

    pagination: {
      page: pageNumber,
      limit: pageLimit,
      total: totalCabinets,
      totalPages: Math.ceil(totalCabinets / pageLimit),
    },
  };
}

module.exports = {
  getPerformance,
};
