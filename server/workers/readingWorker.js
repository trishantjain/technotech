
require("dotenv").config();

const mongoose = require("mongoose");

const SensorReading = require("../models/SensorReading");

const {
  connectRabbit,
  consumeBatch,
} = require("../services/rabbit");

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

  await SensorReading.bulkWrite(operations, {
    ordered: false,
  });

  console.log(
    `[READING WORKER] Successfully saved ${readings.length} readings`
  );
}

async function startWorker() {
  try {
    console.log("[READING WORKER] Starting...");

    // Connect to MongoDB.
    await mongoose.connect(process.env.MONGO_URI);

    console.log("[READING WORKER] MongoDB connected");

    // Connect to RabbitMQ.
    await connectRabbit();

    console.log("[READING WORKER] RabbitMQ connected");

    // Start the batch consumer.
    await consumeBatch(
      "sensor_readings_queue",
      saveReadings,
      {
        batchSize: BATCH_SIZE,
        flushInterval: FLUSH_INTERVAL,
        prefetch: BATCH_SIZE,
      }
    );

    console.log("[READING WORKER] Ready to process readings");
  } catch (err) {
    console.error(
      "[READING WORKER] Startup failed:",
      err
    );

    process.exit(1);
  }
}

startWorker();
