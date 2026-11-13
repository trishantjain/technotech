//* CALCULATES ALARMS AND CLASSIFY ALARM TYPE

function getDashboardStatus(deviceStatus, alarms) {
  // Priority 1: Device disconnected
  if (
    deviceStatus === "DOWN" ||
    alarms.critical.some((alarm) => alarm.category === "disconnected")
  ) {
    return "disconnected";
  }

  const allAlarms = [...alarms.critical, ...alarms.major, ...alarms.minor];

  // Priority 2: Status alarm
  if (allAlarms.some((alarm) => alarm.category === "status")) {
    return "status-alarm";
  }

  // Priority 3: Gauge alarm
  if (allAlarms.some((alarm) => alarm.category === "gauge")) {
    return "gauge-alarm";
  }

  // Priority 4: No alarms
  return "connected";
}

const getFireAlarmDetails = (fireAlarm) => {
  const fireAlarmStates = {
    0: null,

    1: {
      alertType: "fireAlarm",
      value: "fire Alarm",
      reason: "Fire detected",
      severity: "critical",
    },

    2: {
      alertType: "smokeAlarm",
      value: "Smoke Alarm",
      reason: "Smoke detected",
      severity: "critical",
    },

    80: {
      alertType: "smokeWait",
      value: "Smoke wait Alarm",
      reason: "Smoke wait condition detected",
      severity: "minor",
    },

    81: {
      alertType: "smokeFireAlarm",
      value: "Smoke and fire Alarm",
      reason: "Smoke and fire detected",
      severity: "critical",
    },
  };

  return fireAlarmStates[Number(fireAlarm)] ?? null;
};

function calculateAlarms(reading, thresholds) {
  const alarms = {
    critical: [],
    major: [],
    minor: [],
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
  if (reading.deviceStatus === "DOWN") {
    alarms.critical.push({
      key: "deviceDown",
      value: "Device Down",
      reason: "Device is not responding",
      category: "disconnected",
      severity: "critical",
      alertType: true,
    });
  }

  const fireAlarmDetails = getFireAlarmDetails(reading.fireAlarm);

  if (fireAlarmDetails) {
    alarms[fireAlarmDetails.severity].push({
      key: fireAlarmDetails.alertType,
      value: fireAlarmDetails.value,
      reason: fireAlarmDetails.reason,
      category: "status",
      severity: fireAlarmDetails.severity,
    });
  }

  if (reading.waterLeakage) {
    alarms.critical.push({
      key: "waterLeakage",
      value: `Water Leakage Alarm`,
      reason: "Water Leakage Detected",
      category: "status",
      // title: "Water Leakage Alarm",
      severity: "critical",
    });
  }

  if (reading.waterLogging) {
    alarms.major.push({
      key: "waterLogging",
      value: `Water Logging Alarm`,
      reason: "Water Logging Detected",
      category: "status",
      // title: "Water Logging Alarm",
      severity: "major",
    });
  }

  // ======================================================
  // MAJOR ALARMS
  // ======================================================
  if (insideTemperatureAlarm) {
    alarms.major.push({
      key: "insideTemperature",
      value: `Inside Temperature Alarm: ${reading.insideTemperature} °C`,
      reason: "Inside Temperature differ from threshold",
      category: "gauge",
      // title: `Inside Temperature Alarm: ${reading.insideTemperature} °C`,
      severity: "major",
    });
  }

  if (outsideTemperatureAlarm) {
    alarms.major.push({
      key: "outsideTemperature",
      value: `Outside Temperature Alarm: ${reading.outsideTemperature} °C`,
      reason: "Outside Temperature differ from threshold",
      category: "gauge",
      // title: `Outside Temperature Alarm: ${reading.outsideTemperature} °C`,
      severity: "major",
    });
  }

  if (humidityAlarm) {
    alarms.major.push({
      key: "humidity",
      value: `Humidity Alarm : ${reading.humidity}`,
      reason: "Humidity differ from threshold",
      category: "gauge",
      // title: `Humidity Alarm : ${reading.humidity}`,
      severity: "major",
    });
  }

  if (inputVoltageAlarm) {
    alarms.major.push({
      key: "inputVoltage",
      value: `Input Voltage Alarm: ${reading.inputVoltage} Volt.`,
      reason: "Input Voltage differ from threshold",
      category: "gauge",
      // title: `Input Voltage Alarm: ${reading.inputVoltage} Volt.`,
      severity: "major",
    });
  }

  if (outputVoltageAlarm) {
    alarms.major.push({
      key: "outputVoltage",
      value: `Output Voltage Alarm: ${reading.outputVoltage} Volt.`,
      reason: "Output Voltage differ from threshold",
      category: "gauge",
      severity: "major",
    });
  }

  if (batteryBackupAlarm) {
    alarms.major.push({
      key: "batteryBackup",
      value: `Battery Backup Alarm: ${reading.batteryBackup} Volt.`,
      reason: "Low Battery Backup",
      category: "gauge",
      severity: "major",
    });
  }

  if (reading.rectStatus === 0) {
    alarms.major.push({
      key: "rectifier",
      value: "Rectifier Alarm",
      reason: "Rectifier not working",
      category: "status",
      // title: "Rectifier Alarm",
      severity: "major",
    });
  }

  if (reading.inveStatus === 0) {
    alarms.major.push({
      key: "inverter",
      value: "Inverter Alarm",
      reason: "Inverter Alarm from HUPS",
      category: "status",
      // title: "Inverter Alarm",
      severity: "major",
    });
  }

  if (reading.overStatus === 0) {
    alarms.major.push({
      key: "overload",
      value: "OverLoad Alarm",
      reason: "System Overload",
      category: "status",
      // title: "OverLoad Alarm",
      severity: "major",
    });
  }

  if (reading.mptStatus === 0) {
    alarms.major.push({
      key: "mppt",
      value: `MPPT Alarm`,
      reason: "MPPT Alarm from HUPS",
      category: "status",
      // title: "MPPT Alarm",
      severity: "major",
    });
  }

  if (reading.mosfStatus === 0) {
    alarms.major.push({
      key: "mosfet",
      value: `MOSFET Alarm`,
      reason: "MOSFET Alarm from HUPS",
      category: "status",
      // title: "MOSFET Alarm",
      severity: "major",
    });
  }

  if (reading.mainStatus === 0) {
    alarms.major.push({
      key: "mainStatus",
      value: "Mains Alarm",
      reason: "Mains is down",
      category: "status",
      // title: "Mains Alarm",
      severity: "major",
    });
  }

  // ======================================================
  // MINOR ALARMS
  // ======================================================
  if (reading.doorStatus === "OPEN") {
    alarms.minor.push({
      key: "doorStatus",
      value: `Door Alarm`,
      reason: "Door is Open",
      category: "status",
      // title: "Door is Open",
      severity: "minor",
    });
  }

  if (reading.lockStatus === "OPEN") {
    alarms.minor.push({
      key: "lockStatus",
      value: `Lock Alarm`,
      reason: "Lock is Open",
      category: "status",
      // title: "Lock is Open",
      severity: "minor",
    });
  }

  const wrongPasswordAttempts = Number(reading.pwsFailCount);

  if (Number.isFinite(wrongPasswordAttempts) && wrongPasswordAttempts > 0) {
    alarms.minor.push({
      key: "wrongPassword",
      value: `Wrong Password Attempt : ${wrongPasswordAttempts}`,
      reason: "Wrong Password Entered for opening door",
      category: "status",
      // title: `Wrong Password Attempt : ${wrongPasswordAttempts}`,
      severity: "minor",
    });
  }

  return alarms;
}

module.exports = {
  calculateAlarms,
  getDashboardStatus,
};
