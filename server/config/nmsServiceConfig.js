module.exports = [
    // HUMIDITY
    {
        field: "humidity",
        serviceName: "humidity",
        unit: "%",
        getDescription: (reading) =>
            reading.humidityAlarm
                ? "Humidity is high"
                : "Humidity is normal",

        getValue: (reading) =>
            String(reading.humidity),

        getStatus: (reading) =>
            reading.humidityAlarm
                ? "Major"
                : "OK"
    },

    // INSIDE TEMPERATURE
    {
        field: "insideTemperature",
        serviceName: "insideTemperature",
        unit: "°C",
        getDescription: (reading) =>
            reading.insideTemperatureAlarm
                ? "Cabinet temperature is high"
                : "Cabinet temperature is normal",

        getValue: (reading) =>
            String(reading.insideTemperature),

        getStatus: (reading) =>
            reading.insideTemperatureAlarm
                ? "Major"
                : "OK"
    },

    // OUTSIDE TEMPERATURE
    {
        field: "outsideTemperature",
        serviceName: "environmentTemp",
        unit: "°C",
        getDescription: (reading) =>
            reading.outsideTemperatureAlarm
                ? "Environment temperature is high"
                : "Environment temperature is normal",

        getValue: (reading) =>
            String(reading.outsideTemperature),

        getStatus: (reading) =>
            reading.outsideTemperatureAlarm
                ? "Major"
                : "OK"
    },

    // DOOR STATUS
    {
        field: "doorStatus",
        serviceName: "doorOpened",
        unit: "",

        getValue: (reading) =>
            reading.doorStatus === "OPEN"
                ? "true"
                : "false",

        getDescription: (reading) =>
            reading.doorStatus === "OPEN"
                ? "Door is opened"
                : "Door is closed",

        getStatus: (reading) =>
            reading.doorStatus === "OPEN"
                ? "Info"
                : "OK"
    },

    // PASSWORD FAIL
    {
        field: "passwordFail",

        serviceName: "wrongDoorCodeAttempts",

        unit: "",

        description: "Wrong door code attempts",

        getValue: (reading) => String(reading.passwordFail),

        getStatus: (reading) =>
            reading.passwordFail > 0
                ? "Info"
                : "OK"
    },

    // FIRE ALARM
    {
        field: "fireAlarm",

        serviceName: "smokeStatus",

        unit: "",

        getDescription: (reading) =>
            reading.fireAlarm === 1
                ? "Smoke detected"
                : "Smoke not detected",

        getValue: (reading) =>
            reading.fireAlarm === 1
                ? "true"
                : "false",

        getStatus: (reading) =>
            reading.fireAlarm === 1
                ? "Critical"
                : "OK"
    },

    // WATER LEAKAGE
    {
        field: "waterLeakage",

        serviceName: "waterLeakageStatus",

        unit: "",

        getDescription: (reading) =>
            reading.waterLeakage
                ? "Water leakage detected"
                : "Water leakage not detected",

        getValue: (reading) =>
            reading.waterLeakage
                ? "true"
                : "false",

        getStatus: (reading) =>
            reading.waterLeakage
                ? "Critical"
                : "OK"
    },

    // WATER LOGGING 
    {
        field: "waterLogging",

        serviceName: "flood",

        unit: "",

        getDescription: (reading) =>
            reading.waterLogging
                ? "Flood Detected"
                : "Flood not detected",

        getValue: (reading) =>
            reading.waterLogging
                ? "true"
                : "false",

        getStatus: (reading) =>
            reading.waterLogging
                ? "Critical"
                : "OK"
    },

    // RECTIFIER STATUS
    {
        field: "rectStatus",

        serviceName: "singleRectifierFail",

        unit: "",

        getDescription: (reading) =>
            reading.rectStatus === 0
                ? "rectifier failed"
                : "rectifiers are OK",

        getValue: (reading) =>
            reading.rectStatus === 0,

        getStatus: (reading) =>
            reading.rectStatus === 0
                ? "Major"
                : "OK"
    },

    // BATTERY FUSE
    {
        serviceName: "batteryFuseFail",

        description: "Battery fuse is OK",

        unit: "",

        getValue: () => false,

        getStatus: () => "OK"
    },

    // SPD
    {
        serviceName: "spdFail",

        description: "SPD is OK",

        unit: "",

        getValue: () => false,

        getStatus: () => "OK"
    },

    // MPT
    {
        field: "mptStatus",

        serviceName: "solarChargerFail",

        unit: "",

        getDescription: (reading) =>
            reading.mptStatus === 0
                ? "Solar charger failed"
                : "Solar charger is OK",

        getValue: (reading) =>
            reading.mptStatus === 0,

        getStatus: (reading) =>
            reading.mptStatus === 0
                ? "Major"
                : "OK"
    },

    // UPS BATTERY INTERLOCK
    {
        serviceName: "upsBatteryInterlock",

        description: "UPS battery interlock is inactive",

        unit: "",

        getValue: () => false,

        getStatus: () => "OK"
    },

    // SITE ENERGY SOURCE
    {
        serviceName: "siteEnergySource",

        description: "Site energy source info",

        unit: "",

        getValue: () => "NA",

        getStatus: () => "Info"
    }

];