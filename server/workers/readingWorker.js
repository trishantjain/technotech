require("dotenv").config();

const mongoose = require("mongoose");

const SensorReading = require("../models/SensorReading");

const { connectRabbit, consumeBatch } = require("../services/rabbit");

const BATCH_SIZE = 1000;
const FLUSH_INTERVAL = 10 * 1000; // 10 seconds

/**
 * Persist a batch of readings.
 * Existing _id values are used to make retries idempotent.
 */
async function saveReadings(readings) {
  if (!readings || readings.length === 0) {
    return;
  }

  const operations = readings.map((reading) => {
    if (!reading._id) {
      throw new Error("Reading is missing its _id");
    }

    return {
      updateOne: {
        filter: {
          _id: reading._id,
        },
        update: {
          $setOnInsert: reading,
        },
        upsert: true,
      },
    };
  });

  const mongoWriteStartedAt = Date.now();

  try {
    const result = await SensorReading.bulkWrite(operations, {
      ordered: false,
    });

    const mongoWriteDurationMs = Date.now() - mongoWriteStartedAt;

    console.log("[MONGODB BULK WRITE]", {
      batchSize: readings.length,
      durationMs: mongoWriteDurationMs,
      insertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });

    if (mongoWriteDurationMs > 3000) {
      console.warn("[MONGODB SLOW BULK WRITE]", {
        batchSize: readings.length,
        durationMs: mongoWriteDurationMs,
      });
    }
  } catch (err) {
    console.error("[MONGODB BULK WRITE FAILED]", {
      batchSize: readings.length,
      durationMs: Date.now() - mongoWriteStartedAt,
      error: err.message,
      name: err.name,
      code: err.code,
    });

    throw err;
  }

  console.log(
    `[READING WORKER] Successfully saved ${readings.length} readings`,
  );
}

async function startWorker() {
  try {
    console.log("[READING WORKER] Starting...");

    // Connect to MongoDB.
    await mongoose.connect(process.env.MONGO_URI);

    const mongoClient = mongoose.connection.getClient();

    mongoClient.on("serverHeartbeatFailed", (event) => {
      console.error("[MONGODB HEARTBEAT FAILED]", {
        duration: event.duration,
        failure: event.failure?.message,
      });
    });

    mongoClient.on("serverHeartbeatSucceeded", (event) => {
      if (event.duration > 1000) {
        console.warn("[MONGODB SLOW HEARTBEAT]", {
          duration: event.duration,
        });
      }
    });

    mongoose.connection.on("connected", () => {
      console.log("[MONGODB] Connected");
    });

    mongoose.connection.on("disconnected", () => {
      console.error("[MONGODB] Disconnected");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("[MONGODB] Reconnected");
    });

    mongoose.connection.on("error", (err) => {
      console.error("[MONGODB] Connection error:", err.message);
    });

    console.log("[READING WORKER] MongoDB connected");

    // Connect to RabbitMQ.
    await connectRabbit();

    console.log("[READING WORKER] RabbitMQ connected");

    // Start the batch consumer.
    await consumeBatch("sensor_readings_queue", saveReadings, {
      batchSize: BATCH_SIZE,
      flushInterval: FLUSH_INTERVAL,
      prefetch: BATCH_SIZE,
    });

    console.log("[READING WORKER] Ready to process readings");
  } catch (err) {
    console.error("[READING WORKER] Startup failed:", err);

    process.exit(1);
  }
}

startWorker();
