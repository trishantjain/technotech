const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const path = require("path");
const fs = require("fs");

// ============================================================
// LOG DIRECTORY
// ============================================================

const LOG_DIR =
    process.env.EMS_LOG_DIR ||
    path.join(__dirname, "logs");

const APP_LOG_DIR = path.join(LOG_DIR, "application");
const ERROR_LOG_DIR = path.join(LOG_DIR, "error");

// Create directories if they don't exist
fs.mkdirSync(APP_LOG_DIR, { recursive: true });
fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });


// ============================================================
// LOG FORMAT
// ============================================================

const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: "YYYY-MM-DD HH:mm:ss.SSS"
    }),

    winston.format.errors({
        stack: true
    }),

    winston.format.json()
);


// ============================================================
// APPLICATION LOG
// ============================================================

const applicationTransport = new DailyRotateFile({
    filename: path.join(APP_LOG_DIR, "%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: "20m",
    maxFiles: "30d",
    zippedArchive: true
});


// ============================================================
// ERROR LOG
// ============================================================

const errorTransport = new DailyRotateFile({
    filename: path.join(ERROR_LOG_DIR, "%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    level: "error",
    maxSize: "20m",
    maxFiles: "30d",
    zippedArchive: true
});


// ============================================================
// LOGGER
// ============================================================

const logger = winston.createLogger({

    level: process.env.LOG_LEVEL || "info",

    format: logFormat,

    transports: [

        applicationTransport,
        errorTransport,

        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({
                    format: "HH:mm:ss"
                }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {

                    const extra =
                        Object.keys(meta).length > 0
                            ? ` ${JSON.stringify(meta)}`
                            : "";

                    return `[${timestamp}] ${level}: ${message}${extra}`;
                })
            )
        })
    ]
});


logger.info("EMS Logger initialized");

module.exports = logger;
