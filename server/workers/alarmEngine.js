// alarm/alarmEngine.js

function calculateAlarms(reading, thresholds) {
    const alarms = {
        critical: [],
        major: [],
        minor: []
    };

    // -------------------------
    // Threshold Checks
    // -------------------------
    const insideTemperatureAlarm =
        reading.insideTemperature > thresholds.insideTemperature.max ||
        reading.insideTemperature < thresholds.insideTemperature.min;

    const outsideTemperatureAlarm =
        reading.outsideTemperature > thresholds.outsideTemperature.max ||
        reading.outsideTemperature < thresholds.outsideTemperature.min;

    const humidityAlarm =
        reading.humidity > thresholds.humidity.max ||
        reading.humidity < thresholds.humidity.min;

    const inputVoltageAlarm =
        reading.inputVoltage > thresholds.inputVoltage.max ||
        reading.inputVoltage < thresholds.inputVoltage.min;

    const outputVoltageAlarm =
        reading.outputVoltage > thresholds.outputVoltage.max ||
        reading.outputVoltage < thresholds.outputVoltage.min;

    const batteryBackupAlarm =
        reading.batteryBackup < thresholds.batteryBackup.min;

    // ======================================================
    // CRITICAL ALARMS
    // ======================================================
    if (reading.fireAlarm) {
        alarms.critical.push({
            key: "fireAlarm",
            title: "Fire Alarm",
            severity: "critical"
        });
    }

    if (reading.waterLeakage) {
        alarms.critical.push({
            key: "waterLeakage",
            title: "Water Leakage Alarm",
            severity: "critical"
        });
    }

    // ======================================================
    // MAJOR ALARMS
    // ======================================================
    if (insideTemperatureAlarm) {
        alarms.major.push({
            key: "insideTemperature",
            title: `Inside Temperature : ${reading.insideTemperature}`,
            severity: "major"
        });
    }

    if (outsideTemperatureAlarm) {
        alarms.major.push({
            key: "outsideTemperature",
            title: `Outside Temperature : ${reading.outsideTemperature}`,
            severity: "major"
        });
    }

    if (humidityAlarm) {
        alarms.major.push({
            key: "humidity",
            title: `Humidity : ${reading.humidity}`,
            severity: "major"
        });
    }

    if (inputVoltageAlarm) {
        alarms.major.push({
            key: "inputVoltage",
            title: `Input Voltage : ${reading.inputVoltage}`,
            severity: "major"
        });
    }

    if (outputVoltageAlarm) {
        alarms.major.push({
            key: "outputVoltage",
            title: `Output Voltage : ${reading.outputVoltage}`,
            severity: "major"
        });
    }

    if (batteryBackupAlarm) {
        alarms.major.push({
            key: "batteryBackup",
            title: `Battery Backup : ${reading.batteryBackup}`,
            severity: "major"
        });
    }

    if (reading.rectStatus === 0) {
        alarms.major.push({
            key: "rectifier",
            title: "Rectifier Alarm",
            severity: "major"
        });
    }

    if (reading.inveStatus === 0) {
        alarms.major.push({
            key: "inverter",
            title: "Inverter Alarm",
            severity: "major"
        });
    }

    if (reading.overStatus === 0) {
        alarms.major.push({
            key: "overload",
            title: "OverLoad Alarm",
            severity: "major"
        });
    }

    if (reading.mptStatus === 0) {
        alarms.major.push({
            key: "mppt",
            title: "MPPT Alarm",
            severity: "major"
        });
    }

    if (reading.mosfStatus === 0) {
        alarms.major.push({
            key: "mosfet",
            title: "MOSFET Alarm",
            severity: "major"
        });
    }

    if (reading.mainStatus === 0) {
        alarms.major.push({
            key: "mainStatus",
            title: "Mains Alarm",
            severity: "major"
        });
    }

    if (reading.waterLogging) {
        alarms.major.push({
            key: "waterLogging",
            title: "Water Logging Alarm",
            severity: "major"
        });
    }

    // ======================================================
    // MINOR ALARMS
    // ======================================================
    if (reading.doorStatus === "OPEN") {
        alarms.minor.push({
            key: "doorStatus",
            title: "Door Alarm",
            severity: "minor"
        });
    }

    if (reading.lockStatus === "OPEN") {
        alarms.minor.push({
            key: "lockStatus",
            title: "Lock Alarm",
            severity: "minor"
        });
    }

    const wrongPasswordAttempts = Number(reading.pwsFailCount);

    if (
        Number.isFinite(wrongPasswordAttempts) &&
        wrongPasswordAttempts > 0
    ) {
        alarms.minor.push({
            key: "wrongPassword",
            title: `Wrong Password Attempt : ${wrongPasswordAttempts}`,
            severity: "minor"
        });
    }

    return alarms;
}

module.exports = {
    calculateAlarms
};