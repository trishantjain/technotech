// LOGS
export const LOG_CONSTANTS = {
    LOG_RESET_MS: 60 * 60 * 1000, // 1 hour
    MAX_LOGS_PER_DEVICE: 300,
    LOG_THROTTLE_MS: 5000 // log at most once per 5 seconds per device
}

export const ALARM_KEYS = [
    {
        key: "fireAlarm",
        Name: "Fire Alarm",
    },
    {
        key: "waterLogging",
        Name: "Logging",
    },
    {
        key: "waterLeakage",
        Name: "Leakage",
    },
];

export const STATUS_KEYS = [
    {
        key: "lockStatus",
        Name: "Lock",
    },
    {
        key: "doorStatus",
        Name: "Door",
    },
    {
        key: "pwsFailCount",
        Name: "Password",
    },
];


export const HUPS_KEYS = [
    {
        key: "mainStatus",
        Name: "Main",
    },
    {
        key: "rectStatus",
        Name: "Rectfier",
    },
    {
        key: "inveStatus",
        Name: "Inverter",
    },
    {
        key: "overStatus",
        Name: "O.Load",
    },
    {
        key: "mptStatus",
        Name: "MPT",
    },
    {
        key: "mosfStatus",
        Name: "MOSFET",
    },
];

export const ADMIN_PASSWORD = "admin123"