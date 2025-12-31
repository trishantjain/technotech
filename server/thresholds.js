module.exports = {
  insideTemperature: {
    min: 0,
    max: 55   // Over 50°C triggers fire/alarm
  },
  outsideTemperature: {
    min: -20,
    max: 65
  },
  humidity: {
    min: 20,
    max: 80   // You can adjust as per your sensor/environment
  },
  inputVoltage: {
    min: 40.0,
    max: 65.0
  },
  outputVoltage: {
    min: 45.0,
    max: 55.0
  },
  batteryBackup: {
    min: 6,     // minimum 6 hours backup expected
    max: 13     // assume 13 hrs max for chart normalization
  }
};
