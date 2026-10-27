// alarm/alarmEngine.js

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
  if (reading.fireAlarm) {
    alarms.critical.push({
      key: "fireAlarm",
      value: `Fire Alarm`,
      reason: "Fire Detected",
      // title: "Fire Alarm",
      severity: "critical",
    });
  }

  if (reading.waterLeakage) {
    alarms.critical.push({
      key: "waterLeakage",
      value: `Water Leakage Alarm`,
      reason: "Water Leakage Detected",
      // title: "Water Leakage Alarm",
      severity: "critical",
    });
  }

  if (reading.waterLogging) {
    alarms.major.push({
      key: "waterLogging",
      value: `Water Logging Alarm`,
      reason: "Water Logging Detected",
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
      // title: `Inside Temperature Alarm: ${reading.insideTemperature} °C`,
      severity: "major",
    });
  }

  if (outsideTemperatureAlarm) {
    alarms.major.push({
      key: "outsideTemperature",
      value: `Outside Temperature Alarm: ${reading.outsideTemperature} °C`,
      reason: "Outside Temperature differ from threshold",
      // title: `Outside Temperature Alarm: ${reading.outsideTemperature} °C`,
      severity: "major",
    });
  }

  if (humidityAlarm) {
    alarms.major.push({
      key: "humidity",
      value: `Humidity Alarm : ${reading.humidity}`,
      reason: "Humidity differ from threshold",
      // title: `Humidity Alarm : ${reading.humidity}`,
      severity: "major",
    });
  }

  if (inputVoltageAlarm) {
    alarms.major.push({
      key: "inputVoltage",
      value: `Input Voltage Alarm: ${reading.inputVoltage} Volt.`,
      reason: "Input Voltage differ from threshold",
      // title: `Input Voltage Alarm: ${reading.inputVoltage} Volt.`,
      severity: "major",
    });
  }

  if (outputVoltageAlarm) {
    alarms.major.push({
      key: "outputVoltage",
      value: `Output Voltage Alarm: ${reading.outputVoltage} Volt.`,
      reason: "Output Voltage differ from threshold",
      severity: "major",
    });
  }

  if (batteryBackupAlarm) {
    alarms.major.push({
      key: "batteryBackup",
      value: `Battery Backup Alarm: ${reading.batteryBackup} Volt.`,
      reason: "Low Battery Backup",
      severity: "major",
    });
  }

  if (reading.rectStatus === 0) {
    alarms.major.push({
      key: "rectifier",
      value: "Rectifier Alarm",
      reason: "Rectifier not working",
      // title: "Rectifier Alarm",
      severity: "major",
    });
  }

  if (reading.inveStatus === 0) {
    alarms.major.push({
      key: "inverter",
      value: "Inverter Alarm",
      reason: "Inverter Alarm from HUPS",
      // title: "Inverter Alarm",
      severity: "major",
    });
  }

  if (reading.overStatus === 0) {
    alarms.major.push({
      key: "overload",
      value: "OverLoad Alarm",
      reason: "System Overload",
      // title: "OverLoad Alarm",
      severity: "major",
    });
  }

  if (reading.mptStatus === 0) {
    alarms.major.push({
      key: "mppt",
      value: `MPPT Alarm`,
      reason: "MPPT Alarm from HUPS",
      // title: "MPPT Alarm",
      severity: "major",
    });
  }

  if (reading.mosfStatus === 0) {
    alarms.major.push({
      key: "mosfet",
      value: `MOSFET Alarm`,
      reason: "MOSFET Alarm from HUPS",
      // title: "MOSFET Alarm",
      severity: "major",
    });
  }

  if (reading.mainStatus === 0) {
    alarms.major.push({
      key: "mainStatus",
      value: "Mains Alarm",
      reason: "Mains is down",
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
      // title: "Door is Open",
      severity: "minor",
    });
  }

  if (reading.lockStatus === "OPEN") {
    alarms.minor.push({
      key: "lockStatus",
      value: `Lock Alarm`,
      reason: "Lock is Open",
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
      // title: `Wrong Password Attempt : ${wrongPasswordAttempts}`,
      severity: "minor",
    });
  }

  return alarms;
}

module.exports = {
  calculateAlarms,
};
