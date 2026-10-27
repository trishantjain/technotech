module.exports = [
  // HUMIDITY
  {
    field: "humidity",
    serviceName: "humidity",
    unit: "%",
    getDescription: (reading) =>
      reading.humidityAlarm ? "Humidity is high" : "Humidity is normal",

    getValue: (reading) => String(reading.humidity),

    getStatus: (reading) => (reading.humidityAlarm ? "Major" : "OK"),
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

    getValue: (reading) => String(reading.insideTemperature),

    getStatus: (reading) => (reading.insideTemperatureAlarm ? "Major" : "OK"),
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

    getValue: (reading) => String(reading.outsideTemperature),

    getStatus: (reading) => (reading.outsideTemperatureAlarm ? "Major" : "OK"),
  },

  // DOOR STATUS
  {
    field: "doorStatus",
    serviceName: "doorOpened",
    unit: "",

    getValue: (reading) => (reading.doorStatus === "OPEN" ? "true" : "false"),

    getDescription: (reading) =>
      reading.doorStatus === "OPEN" ? "Door is opened" : "Door is closed",

    getStatus: (reading) => (reading.doorStatus === "OPEN" ? "Info" : "OK"),
  },

  // PASSWORD FAIL
  {
    field: "pwsFailCount",
    serviceName: "wrongDoorCodeAttempts",
    unit: "",

    getDescription: (reading) =>
      Number(reading.pwsFailCount ?? 0) > 0
        ? "Wrong door code attempts detected"
        : "No wrong door code attempts",

    getValue: (reading) => String(reading.pwsFailCount ?? 0),

    getStatus: (reading) =>
      Number(reading.pwsFailCount ?? 0) > 0 ? "Info" : "OK",
  },

  // FIRE ALARM
  {
    field: "fireAlarm",
    serviceName: "smokeStatus",
    unit: "",

    getDescription: (reading) =>
      reading.fireAlarm === 1 ? "Smoke detected" : "Smoke not detected",

    getValue: (reading) => (reading.fireAlarm === 1 ? "true" : "false"),

    getStatus: (reading) => (reading.fireAlarm === 1 ? "Critical" : "OK"),
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

    getValue: (reading) => (reading.waterLeakage ? "true" : "false"),

    getStatus: (reading) => (reading.waterLeakage ? "Critical" : "OK"),
  },

  // WATER LOGGING
  {
    field: "waterLogging",
    serviceName: "flood",
    unit: "",

    getDescription: (reading) =>
      reading.waterLogging ? "Flood Detected" : "Flood not detected",

    getValue: (reading) => (reading.waterLogging ? "true" : "false"),

    getStatus: (reading) => (reading.waterLogging ? "Critical" : "OK"),
  },

  // IMONI BATTERY BACKUP
  {
    field: "batteryBackup",
    serviceName: "batteryBackup",
    unit: "V",

    getDescription: (reading) =>
      reading.batteryBackupAlarm
        ? "Battery backup alarm"
        : "Battery backup is normal",

    getValue: (reading) => String(reading.batteryBackup ?? 0),

    getStatus: (reading) => (reading.batteryBackupAlarm ? "Major" : "OK"),
  },

  // MAINS ALARM
  {
    field: "mainStatus",
    serviceName: "mainsFail",
    unit: "",

    getDescription: (reading) =>
      reading.mainStatus === 0
        ? "Mains supply failed"
        : "Mains supply is normal",

    getValue: (reading) => reading.mainStatus === 0,

    getStatus: (reading) => (reading.mainStatus === 0 ? "Critical" : "OK"),
  },

  // INVERTOR ALARM
  {
    field: "inveStatus",
    serviceName: "inverterFail",
    unit: "",

    getDescription: (reading) =>
      reading.inveStatus === 0 ? "Inverter failed" : "Inverter is normal",

    getValue: (reading) => reading.inveStatus === 0,

    getStatus: (reading) => (reading.inveStatus === 0 ? "Major" : "OK"),
  },

  // OVER ALARM
  {
    field: "overStatus",
    serviceName: "overloadAlarm",
    unit: "",

    getDescription: (reading) =>
      reading.overStatus === 0 ? "Overload detected" : "No overload",

    getValue: (reading) => reading.overStatus === 0,

    getStatus: (reading) => (reading.overStatus === 0 ? "Major" : "OK"),
  },

  // RECTIFIER STATUS
  {
    field: "rectStatus",
    serviceName: "singleRectifierFail",
    unit: "",

    getDescription: (reading) =>
      reading.rectStatus === 0 ? "rectifier failed" : "rectifiers are OK",

    getValue: (reading) => reading.rectStatus === 0,

    getStatus: (reading) => (reading.rectStatus === 0 ? "Major" : "OK"),
  },

  // MOST ALARM
  {
    field: "mosfStatus",
    serviceName: "mosfetFail",
    unit: "",

    getDescription: (reading) =>
      reading.mosfStatus === 0 ? "MOSFET fault detected" : "MOSFET is normal",

    getValue: (reading) => reading.mosfStatus === 0,

    getStatus: (reading) => (reading.mosfStatus === 0 ? "Major" : "OK"),
  },

  // MPT
  {
    field: "mptStatus",
    serviceName: "solarChargerFail",
    unit: "",

    getDescription: (reading) =>
      reading.mptStatus === 0 ? "Solar charger failed" : "Solar charger is OK",

    getValue: (reading) => reading.mptStatus === 0,

    getStatus: (reading) => (reading.mptStatus === 0 ? "Major" : "OK"),
  },

  // BATTERY FUSE
  {
    serviceName: "batteryFuseFail",
    description: "Battery fuse is OK",
    unit: "",

    getValue: () => false,

    getStatus: () => "OK",
  },

  // SPD
  {
    serviceName: "spdFail",
    description: "SPD is OK",
    unit: "",

    getValue: () => false,

    getStatus: () => "OK",
  },

  // UPS BATTERY INTERLOCK
  {
    serviceName: "upsBatteryInterlock",
    description: "UPS battery interlock is inactive",
    unit: "",

    getValue: () => false,

    getStatus: () => "OK",
  },

  // SITE ENERGY SOURCE
  {
    serviceName: "siteEnergySource",
    description: "Site energy source info",
    unit: "",

    getValue: () => "Mains",

    getStatus: () => "Info",
  },

  // FAN FAULTY
  {
    serviceName: "fanFaultyCount",
    unit: "",

    getDescription: (reading) => {
      const fanStatuses = [
        reading.fan1Status,
        reading.fan2Status,
        reading.fan3Status,
        reading.fan4Status,
        reading.fan5Status,
        reading.fan6Status,
      ];

      const faultyCount = fanStatuses.filter(
        (status) => Number(status) === 0,
      ).length;

      return faultyCount > 0
        ? `${faultyCount} fan(s) faulty`
        : "All fans are OK";
    },

    getValue: (reading) => {
      const fanStatuses = [
        reading.fan1Status,
        reading.fan2Status,
        reading.fan3Status,
        reading.fan4Status,
        reading.fan5Status,
        reading.fan6Status,
      ];

      return String(
        fanStatuses.filter((status) => Number(status) === 0).length,
      );
    },

    getStatus: (reading) => {
      const fanStatuses = [
        reading.fan1Status,
        reading.fan2Status,
        reading.fan3Status,
        reading.fan4Status,
        reading.fan5Status,
        reading.fan6Status,
      ];

      return fanStatuses.some((status) => Number(status) === 0)
        ? "Major"
        : "OK";
    },
  },

  // INPUT VOLTAGE
  {
    field: "inputVoltage",
    serviceName: "acInputVoltage",
    unit: "V",

    getDescription: (reading) =>
      reading.inputVoltageAlarm
        ? "AC input voltage alarm"
        : "AC input voltage is normal",

    getValue: (reading) => String(reading.inputVoltage ?? 0),

    getStatus: (reading) => (reading.inputVoltageAlarm ? "Major" : "OK"),
  },

  // OUTPUT VOLTAGE
  {
    field: "outputVoltage",
    serviceName: "dcOutputVoltage",
    unit: "V",

    getDescription: (reading) =>
      reading.outputVoltageAlarm
        ? "DC output voltage alarm"
        : "DC output voltage is normal",

    getValue: (reading) => String(reading.outputVoltage ?? 0),

    getStatus: (reading) => (reading.outputVoltageAlarm ? "Major" : "OK"),
  },

  // DC OUTPUT CURRENT
  {
    field: "hupsDVC",
    serviceName: "dcOutputCurrent",
    unit: "A",

    getDescription: () => "DC output current",

    getValue: (reading) => String(reading.hupsDVC ?? 0),

    getStatus: () => "OK",
  },

  // HUPS BAT VOLT
  {
    field: "hupsBatVolt",
    serviceName: "upsBatteryVoltage",
    unit: "V",

    getDescription: () => "UPS battery voltage",

    getValue: (reading) => String(reading.hupsBatVolt ?? 0),

    getStatus: (reading) =>
      Number(reading.hupsBatVolt ?? 0) > 0 ? "OK" : "Info",
  },
];
