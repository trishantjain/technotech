const Device = require("../models/Device");

const CHECK_INTERVAL = 2000;       // 2 sec
const OFFLINE_TIMEOUT = 15000;     // 15 sec

async function checkOfflineDevices() {
    try {
        const cutoff = new Date(Date.now() - OFFLINE_TIMEOUT);

        const result = await Device.updateMany(
            {
                deviceStatus: "UP",
                lastPacketTime: { $lt: cutoff }
            },
            {
                $set: {
                    deviceStatus: "DOWN",
                    lastStatusChangeTimeTicks: Date.now()
                }
            }
        );

        if (result.modifiedCount > 0) {
            console.log(
                `[StatusMonitor] ${result.modifiedCount} device(s) marked DOWN`
            );
        }

    } catch (err) {
        console.error("[StatusMonitor]", err);
    }
}

function startStatusMonitor() {
    setInterval(checkOfflineDevices, CHECK_INTERVAL);
}

module.exports = {
    startStatusMonitor
};