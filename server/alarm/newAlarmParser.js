function parseNewAlarm(line, timestamp) {

    const parts = String(line || "")
        .split("|")
        .map((part) => part.trim());

    /*
     * Fixed-column alarm format:
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
        return [];
    }

    const [
        log_timestamp,
        alert_id,
        device_ip,
        severity,
        alarm,
        alarm_value,
        start_time,
        end_time,
        status
    ] = parts;

    const parsedLogTimestamp = new Date(log_timestamp);

    if (isNaN(parsedLogTimestamp.getTime())) {
        return [];
    }

    return [{
        log_timestamp: parsedLogTimestamp.toISOString(),

        alert_id,

        device_ip,

        severity,

        alarm,

        alarm_value,

        start_time: start_time && start_time.toLowerCase() !== "null"
            ? start_time
            : null,

        end_time: end_time && end_time.toLowerCase() !== "null"
            ? end_time
            : null,

        status,

        // Backward compatibility with existing API code
        timestamp: parsedLogTimestamp.toISOString()
    }];
}

module.exports = parseNewAlarm;