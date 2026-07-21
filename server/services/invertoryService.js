const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");

const STALE_THRESHOLD_MS = 30000;

async function getInventory() {

    const devices = await Device.find()
        .sort({ createdAt: -1 })
        .lean();

    const cabinetData = await Promise.all(
        devices.map(async (device, index) => {

            const latestReading = await SensorReading
                .findOne({ mac: device.mac })
                .sort({ timestamp: -1 })
                .lean();

            let deviceStatus = "Down";

            if (latestReading?.timestamp) {

                const age =
                    Date.now() -
                    new Date(latestReading.timestamp).getTime();

                deviceStatus =
                    age <= STALE_THRESHOLD_MS
                        ? "Up"
                        : "Down";
            }
            return {

                srNo: index + 1,

                deviceId: String(device._id),

                deviceName:
                    device.deviceName || "",

                createdAt:
                    device.createdAt ?
                        Math.floor(
                            new Date(device.createdAt).getTime() / 1000
                        ) : 0,

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
                    device.mac || "",

                location:
                    device.address || "",

                latitude:
                    device.latitude ?? 0,

                longitude:
                    device.longitude ?? 0,

                deviceStatus,

                maintenanceMode:
                    device.maintenanceMode || "",

                swVersion:
                    device.swVersion || "",

                modifyTimeTicks:
                    // device.modifyTimeTicks || "",
                    0,

                modifyField:
                    device.modifyField || "",

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
        })

    );

    return {
        totalCabinets: cabinetData.length,
        cabinetData
    };
}

module.exports = {
    getInventory
};