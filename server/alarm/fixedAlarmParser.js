function parseFixedAlarm(line) {
  const parts = String(line || "")
    .split("|")
    .map((part) => part.trim());

  /*
   * Expected format:
   *
   * 0 = log_timestamp
   * 1 = alert_id
   * 2 = device_ip
   * 3 = severity
   * 4 = alarm
   * 5 = alarm_value
   * 6 = start_time
   * 7 = end_time
   * 8 = status
   */

  if (parts.length !== 9) {
    return null;
  }

  const [
    logTimestamp,
    alertId,
    deviceIp,
    severity,
    alarm,
    alarmValue,
    startTime,
    endTime,
    status,
  ] = parts;

  /*
   * Validate ISO timestamps.
   */

  const logDate = new Date(logTimestamp);

  const startDate = new Date(startTime);

  if (isNaN(logDate.getTime()) || isNaN(startDate.getTime())) {
    return null;
  }

  let endDate = null;

  if (endTime && endTime !== "null") {
    endDate = new Date(endTime);

    if (isNaN(endDate.getTime())) {
      return null;
    }
  }

  return [
    {
      log_timestamp: logDate.toISOString(),

      alert_id: alertId,

      device_ip: deviceIp,

      severity: severity,

      alarm: alarm,

      alarm_value: alarmValue,

      start_time: startDate.toISOString(),

      end_time: endDate ? endDate.toISOString() : null,

      status: status,
    },
  ];
}

module.exports = parseFixedAlarm;
