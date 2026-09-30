const parseOldAlarm = require("./oldAlarmParser.js");

const parseNewAlarm = require("./newAlarmParser.js");

const parseFixedAlarm = require("./fixedAlarmParser.js");

function parseAlarmLine(line, payload, timestamp) {
  /*
   * =====================================================
   * NEW FIXED-COLUMN ALARM FORMAT
   * =====================================================
   *
   * log_timestamp | alert_id | device_ip | severity |
   * alarm | alarm_value | start_time | end_time | status
   */

  const pipeParts = String(line || "")
    .split("|")
    .map((part) => part.trim());

  if (pipeParts.length === 9) {
    return parseFixedAlarm(line);
  }

  /*
   * =====================================================
   * PREVIOUS ALARM FORMAT
   * =====================================================
   *
   * [timestamp] | ALERT_ID:... | IP:... |
   * SERVICE:... | SEVERITY:... |
   * ALARM:... | EVENT:ACTIVE
   */

  if (line.includes("ALARM:") && line.includes("EVENT:")) {
    return parseNewAlarm(line, timestamp);
  }

  /*
   * =====================================================
   * OLD ALARM FORMAT
   * =====================================================
   */

  return parseOldAlarm(payload, timestamp);
}

module.exports = parseAlarmLine;
