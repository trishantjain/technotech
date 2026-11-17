const amqp = require("amqplib");

let channel;
let connection;
let reconnecting = false;

let connectionPromise = null;
let publisherChannel;
let reconnectTimer = null;

const consumers = [];

const READING_QUEUE = "sensor_readings_queue";
const READING_RETRY_QUEUE = "sensor_readings_retry_queue";
const READING_DEAD_QUEUE = "sensor_readings_dead_queue";

const READING_RETRY_DELAY = 5000;
const MAX_READING_RETRIES = 5;

const QUEUES = [
  "alarm.queue",
  "snapshot.queue",
  "log.queue",
  "snapshot.done",
  "alarm.result.queue",
  "sensor_readings_queue",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectRabbit() {
  if (connection && publisherChannel) {
    return publisherChannel;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    while (true) {
      try {
        const conn = await amqp.connect(process.env.RABBIT_URL);

        connection = conn;

        conn.on("error", (err) => {
          console.error("RabbitMQ connection error:", err.message);
        });

        conn.on("close", () => {
          console.error("❌ RabbitMQ connection closed. Reconnecting...");
          // channel = undefined;
          // setTimeout(connectRabbit, 5000);

          // channel = undefined;
          connection = undefined;
          publisherChannel = undefined;

          // Consumer channels belong to this connection.
          consumers.forEach((consumer) => {
            consumer.channel = undefined;
            consumer.consumerTag = undefined;
            consumer.starting = false;
            consumer.pending = [];
            consumer.flushing = false;

            if (consumer.timer) {
              clearTimeout(consumer.timer);
              consumer.timer = undefined;
            }
          });

          scheduleReconnect();
        });

        const pubChannel = await conn.createConfirmChannel();

        await pubChannel.assertQueue(READING_RETRY_QUEUE, {
          durable: true,
          arguments: {
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": READING_QUEUE,
          },
        });

        await pubChannel.assertQueue(READING_DEAD_QUEUE, {
          durable: true,
        });

        pubChannel.on("error", (err) => {
          console.error("RabbitMQ publisher channel error:", err.message);
        });

        pubChannel.on("close", () => {
          console.error("RabbitMQ publisher channel closed");

          if (connection === conn) {
            publisherChannel = undefined;
            scheduleReconnect();
          }
        });

        for (const queue of QUEUES) {
          await pubChannel.assertQueue(queue, {
            durable: true,
          });
        }

        publisherChannel = pubChannel;

        console.log("RabbitMQ connected successfully");

        // Restart all registered consumers on the new connection.
        await restartConsumers();

        return publisherChannel;
      } catch (err) {
        console.error("RabbitMQ connection failed:", err.message);

        connection = undefined;
        publisherChannel = undefined;

        await sleep(5000);
      }
    }
  })();

  try {
    return await connectionPromise;
  } finally {
    connectionPromise = null;
  }

  //   channel = await connection.createChannel();

  //   channel.on("error", (err) => {
  //     console.error("RabbitMQ channel error:", err.message);
  //   });

  //   channel.on("close", () => {
  //     console.error("RabbitMQ channel closed. Reconnecting...");
  //     channel = undefined;
  //     scheduleReconnect();
  //   });

  //   await assertQueues(channel);

  //   console.log("🐰 RabbitMQ connected");

  //   await restartConsumers();

  //   return channel;

  // Alarm Queue
  // await channel.assertQueue("alarm.queue", { durable: true });

  //! ADDED FOR DEAD LOCK QUEUE
  // await channel.assertQueue("snapshot.dead", { durable: true });

  // Snapshot job queue
  // await channel.assertQueue("snapshot.queue", { durable: true });

  //! ADDED FOR DEAD LOCK QUEUE
  // await channel.assertQueue("snapshot.queue", {
  //     durable: true,
  //     arguments: {
  //         "x-dead-letter-exchange": "",          // default exchange
  //         "x-dead-letter-routing-key": "snapshot.dead"
  //     }
  // });

  // await channel.assertQueue("log.queue", { durable: true });

  // // Snapshot completion events (worker -> API for SSE)
  // await channel.assertQueue("snapshot.done", { durable: true });

  // await channel.assertQueue("alarm.result.queue", { durable: true });

  // console.log("🐰 RabbitMQ connected");
  // return channel;
}

function scheduleReconnect() {
  if (reconnectTimer || reconnecting) return;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    reconnecting = true;

    try {
      await connectRabbit();
    } catch (err) {
      console.error("RabbitMQ reconnect failed:", err.message);
    } finally {
      reconnecting = false;
    }
  }, 5000);
}

async function getPublisherChannel() {
  if (publisherChannel) {
    return publisherChannel;
  }

  return connectRabbit();
}

/**
 * Publish persistent messages and wait for broker confirmation.
 */
async function publish(queue, data) {
  const ch = await getPublisherChannel();

  const payload = Buffer.from(JSON.stringify(data));

  ch.sendToQueue(queue, payload, {
    persistent: true,
    contentType: "application/json",
  });

  await ch.waitForConfirms();
}

async function publishConfirmed(queue, data, options = {}) {
  const ch = await getPublisherChannel();

  ch.sendToQueue(queue, Buffer.from(JSON.stringify(data)), {
    persistent: true,
    contentType: "application/json",
    ...options,
  });

  await ch.waitForConfirms();
}

/**
 * Existing publishers.
 * Errors are logged so existing fire-and-forget callers
 * do not generate unhandled promise rejections.
 */
function publishExisting(queue, data) {
  return publish(queue, data).catch((err) => {
    console.error(`Failed to publish to ${queue}:`, err.message);
  });
}

/**
 * Sensor readings use a separate publisher function.
 * Errors are propagated to the TCP handler so it can log them.
 */
function publishReading(data) {
  return publish("sensor_readings_queue", data);
}

async function assertQueues(ch) {
  await ch.assertQueue("alarm.queue", { durable: true });
  await ch.assertQueue("snapshot.queue", { durable: true });
  await ch.assertQueue("log.queue", { durable: true });
  await ch.assertQueue("snapshot.done", { durable: true });
  await ch.assertQueue("alarm.result.queue", { durable: true });
}

async function ensureChannelReady() {
  if (channel) return channel;
  await connectRabbit();
  return channel;
}

async function restartConsumers() {
  for (const consumer of consumers) {
    await startConsumer(consumer);
  }
}

// async function publish(queue, data) {
//   // if (!channel) {
//   //     console.error("Channel not ready, message dropped");
//   //     return;
//   // }

//   // channel.sendToQueue(
//   //     queue,
//   //     Buffer.from(JSON.stringify(data)),
//   //     { persistent: true }
//   // );

//   try {
//     const ch = await ensureChannelReady();

//     ch.sendToQueue(queue, Buffer.from(JSON.stringify(data)), {
//       persistent: true,
//     });
//   } catch (err) {
//     console.error(`Failed to publish to ${queue}:`, err.message);
//   }
// }

function publishAlarm(data) {
  return publishExisting("alarm.queue", data);
}

function publishSnapshot(data) {
  return publishExisting("snapshot.queue", data);
}

function publishSnapshotDone(data) {
  return publishExisting("snapshot.done", data);
}

function publishLog(data) {
  return publishExisting("log.queue", data);
}

function publishAlarmResult(data) {
  return publishExisting("alarm.result.queue", data);
}

/**
 * Register a normal single-message consumer.
 */
async function consume(queue, handler, options = {}) {
  const consumer = {
    type: "normal",
    queue,
    handler,
    options,
    channel: undefined,
    consumerTag: undefined,
    starting: false,
  };

  consumers.push(consumer);

  await startConsumer(consumer);
}

/**
 * Start a consumer using its own independent channel.
 */
async function startConsumer(consumer) {
  if (consumer.starting || consumer.channel) return;

  consumer.starting = true;

  try {
    const conn = connection || ((await connectRabbit()) && connection);

    if (!conn) {
      throw new Error("RabbitMQ connection unavailable");
    }

    const ch = await conn.createChannel();

    consumer.channel = ch;

    ch.on("error", (err) => {
      console.error(`Consumer channel error (${consumer.queue}):`, err.message);
    });

    ch.on("close", () => {
      if (consumer.channel !== ch) return;

      console.error(`Consumer channel closed (${consumer.queue})`);

      consumer.channel = undefined;
      consumer.consumerTag = undefined;

      if (consumer.timer) {
        clearTimeout(consumer.timer);
        consumer.timer = undefined;
      }

      // Pending messages remain unacknowledged.
      // RabbitMQ will redeliver them after channel closure.
      consumer.pending = [];
      consumer.flushing = false;

      if (connection) {
        setTimeout(() => {
          startConsumer(consumer).catch((err) => {
            console.error(
              `Consumer restart failed (${consumer.queue}):`,
              err.message,
            );
          });
        }, 3000);
      }
    });

    await ch.assertQueue(consumer.queue, {
      durable: true,
    });

    ch.prefetch(consumer.options.prefetch || 10);

    const result = await ch.consume(consumer.queue, async (msg) => {
      if (!msg) return;

      try {
        const data = JSON.parse(msg.content.toString());

        await consumer.handler(data, msg);

        ch.ack(msg);
      } catch (err) {
        console.error(`Consumer error (${consumer.queue}):`, err.message);

        try {
          ch.nack(msg, false, true);
        } catch (nackError) {
          console.error("Nack failed:", nackError.message);
        }
      }
    });

    consumer.consumerTag = result.consumerTag;

    console.log(`Consumer started: ${consumer.queue}`);
  } catch (err) {
    consumer.channel = undefined;

    console.error(`Unable to start consumer (${consumer.queue}):`, err.message);

    scheduleReconnect();
  } finally {
    consumer.starting = false;
  }
}

/**
 * Batch consumer:
 * - Flushes when batchSize is reached.
 * - Flushes partial batches after flushInterval.
 * - Acknowledges messages only after handler succeeds.
 */
async function flushBatch(consumer) {
  if (consumer.flushing || consumer.pending.length === 0) {
    return;
  }

  const batchChannel = consumer.channel;

  if (!batchChannel) {
    return;
  }

  consumer.flushing = true;

  const batch = consumer.pending.splice(0, consumer.options.batchSize);

  try {
    const readings = batch.map((item) => item.data);

    // Save the complete batch to MongoDB.
    await consumer.handler(readings);

    // Acknowledge only on the original channel.
    if (consumer.channel === batchChannel) {
      for (const item of batch) {
        batchChannel.ack(item.msg);
      }
    }
  } catch (err) {
    console.error(
      `[BATCH] MongoDB save failed (${consumer.queue}):`,
      err.message,
    );

    if (consumer.channel === batchChannel) {
      try {
        for (const item of batch) {
          const previousRetries = Number(
            item.msg.properties.headers?.["x-reading-retry-count"] || 0,
          );

          const nextRetries = previousRetries + 1;

          if (nextRetries > MAX_READING_RETRIES) {
            // Maximum retries exceeded: move to dead-letter queue.
            await publishConfirmed(READING_DEAD_QUEUE, item.data, {
              headers: {
                "x-reading-retry-count": previousRetries,
                "x-reading-failure": err.message,
              },
            });

            console.error(
              `[READING DEAD] Reading moved to dead queue after ${previousRetries} retries`,
            );
          } else {
            // Retry after the configured delay.
            await publishConfirmed(READING_RETRY_QUEUE, item.data, {
              expiration: String(READING_RETRY_DELAY),
              headers: {
                "x-reading-retry-count": nextRetries,
              },
            });

            console.warn(
              `[READING RETRY] Attempt ${nextRetries}/${MAX_READING_RETRIES}`,
            );
          }

          // Acknowledge original only after replacement message is confirmed.
          if (consumer.channel !== batchChannel) {
            throw new Error("Consumer channel changed during retry");
          }

          batchChannel.ack(item.msg);
        }
      } catch (retryError) {
        console.error(
          "[READING RETRY] Failed to publish retry:",
          retryError.message,
        );

        // Do not acknowledge messages whose replacement was not confirmed.
        // Closing the channel causes unacknowledged deliveries to be requeued.
        try {
          await batchChannel.close();
        } catch (closeError) {
          console.error(
            "[READING RETRY] Channel close failed:",
            closeError.message,
          );
        }
      }
    }
  } finally {
    // Do not let an old batch overwrite the state of a replacement channel.
    if (consumer.channel === batchChannel) {
      consumer.flushing = false;

      if (consumer.pending.length >= consumer.options.batchSize) {
        setImmediate(() => flushBatch(consumer));
      } else if (consumer.pending.length > 0) {
        scheduleBatchFlush(consumer);
      }
    }
  }
}

function scheduleBatchFlush(consumer) {
  if (consumer.timer) return;

  consumer.timer = setTimeout(() => {
    consumer.timer = undefined;
    flushBatch(consumer);
  }, consumer.options.flushInterval);
}

async function startBatchConsumer(consumer) {
  if (consumer.starting || consumer.channel) return;

  consumer.starting = true;

  try {
    const conn = connection || ((await connectRabbit()) && connection);

    if (!conn) {
      throw new Error("RabbitMQ connection unavailable");
    }

    const ch = await conn.createChannel();

    consumer.channel = ch;

    ch.on("error", (err) => {
      console.error(
        `Batch consumer channel error (${consumer.queue}):`,
        err.message,
      );
    });

    ch.on("close", () => {
      if (consumer.channel !== ch) return;

      console.error(`Batch consumer channel closed (${consumer.queue})`);

      consumer.channel = undefined;
      consumer.consumerTag = undefined;

      if (consumer.timer) {
        clearTimeout(consumer.timer);
        consumer.timer = undefined;
      }

      // Do not acknowledge pending messages.
      // RabbitMQ will redeliver unacknowledged messages.
      consumer.pending = [];
      consumer.flushing = false;

      if (connection) {
        setTimeout(() => {
          startBatchConsumer(consumer).catch((err) => {
            console.error("Batch consumer restart failed:", err.message);
          });
        }, 3000);
      }
    });

    await ch.assertQueue(consumer.queue, {
      durable: true,
    });

    ch.prefetch(consumer.options.prefetch);

    const result = await ch.consume(consumer.queue, (msg) => {
      if (!msg) return;

      try {
        const data = JSON.parse(msg.content.toString());

        consumer.pending.push({
          data,
          msg,
        });

        if (consumer.pending.length >= consumer.options.batchSize) {
          if (consumer.timer) {
            clearTimeout(consumer.timer);
            consumer.timer = undefined;
          }

          flushBatch(consumer);
        } else {
          scheduleBatchFlush(consumer);
        }
      } catch (err) {
        console.error("Invalid batch message:", err.message);

        try {
          ch.nack(msg, false, false);
        } catch {}
      }
    });

    consumer.consumerTag = result.consumerTag;

    console.log(`Batch consumer started: ${consumer.queue}`);
  } catch (err) {
    consumer.channel = undefined;

    console.error(
      `Unable to start batch consumer (${consumer.queue}):`,
      err.message,
    );

    scheduleReconnect();
  } finally {
    consumer.starting = false;
  }
}

async function consumeBatch(queue, handler, options = {}) {
  const batchSize = options.batchSize || 1000;
  const flushInterval = options.flushInterval || 10000;
  const prefetch = options.prefetch || batchSize;

  const consumer = {
    type: "batch",
    queue,
    handler,
    options: {
      ...options,
      batchSize,
      flushInterval,
      prefetch,
    },
    channel: undefined,
    consumerTag: undefined,
    starting: false,
    pending: [],
    timer: undefined,
    flushing: false,
  };

  consumers.push(consumer);

  await startBatchConsumer(consumer);
}

async function restartConsumers() {
  for (const consumer of consumers) {
    if (consumer.type === "batch") {
      await startBatchConsumer(consumer);
    } else {
      await startConsumer(consumer);
    }
  }
}

module.exports = {
  connectRabbit,
  publishAlarm,
  publishSnapshot,
  publishSnapshotDone,
  publishLog,
  publishAlarmResult,
  publishReading,
  consume,
  consumeBatch,
};
