const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const { buildService } = require("../utils/nmsServiceBuilder");
const serviceConfig = require("../config/nmsServiceConfig");

async function getPerformance() {
    const devices = await Device.find()
        .sort({ createdAt: -1 })
        .lean();

    const cabinetData = await Promise.all(
        devices.map(async (device, index) => {

            const latestReading = await SensorReading
                .findOne({ mac: device.mac })
                .sort({ timestamp: -1 })
                .lean();

            console.log(
                "Device:", device.mac,
                "Latest Reading:", latestReading ? "FOUND" : "NOT FOUND"
            );

            const services = [];


            if (latestReading) {
                serviceConfig.forEach((service) => {
                    services.push(
                        buildService({
                            description:
                                service.getDescription
                                    ? service.getDescription(latestReading)
                                    : service.description,

                            serviceName:
                                service.serviceName,

                            value:
                                service.getValue
                                    ? service.getValue(latestReading)
                                    : latestReading[services.field],

                            unit:
                                service.unit,

                            status:
                                service.getStatus
                                    ? service.getStatus(latestReading)
                                    : service.status
                        })
                    )
                });
            }

            return {
                srNo: index + 1,

                cabinetId: String(device._id),

                cabinetName:
                    device.deviceName || "",

                timeTicks:
                    latestReading
                        ? Math.floor(
                            new Date(latestReading.timestamp).getTime() / 1000
                        )
                        : 0,

                timeStamp:
                    latestReading
                        ? latestReading.timestamp
                        : null,

                services: services

            };
        })
    );

    return {
        totalCabinets: cabinetData.length,
        cabinetData
    };
}

module.exports = {
    getPerformance
};