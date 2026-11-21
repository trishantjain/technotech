const amqp = require("amqplib");

let channel;
let connection;
let reconnecting = false;

let connectionPromise = null;
let publisherChannel;
let reconnectTimer = null;

// ===================== BACKGROUND PUBLISHER =====================

// Maximum messages waiting to be published or confirmed.
const MAX_PUBLISHER_PENDING_MESSAGES = 10000;

// Maximum memory occupied by queued + unconfirmed messages.
const MAX_PUBLISHER_PENDING_BYTES = 64 * 1024 * 1024;

// Maximum messages sent to RabbitMQ without confirmation.
const MAX_PUBLISHER_IN_FLIGHT = 500;

// Retry delay when RabbitMQ rejects a message or publishing fails.
const PUBLISHER_RETRY_DELAY = 1000;

let publisherQueue = [];
let publisherInFlight = new Set();

let publisherPendingMessages = 0;
let publisherPendingBytes = 0;

let publisherBlocked = false;
let publisherPumpRunning = false;
let publisherRetryTimer = null;

let maxPublishInFlight = 0;
let publisherBackpressureCount = 0;

// ===================== BACKGROUND PUBLISHER =====================

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

        conn.on("blocked", (reason) => {
          console.error("[RABBIT CONNECTION BLOCKED]", reason);
        });

        conn.on("unblocked", () => {
          console.log("[RABBIT CONNECTION UNBLOCKED]");
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

          // Requeue messages that were sent but not confirmed.
          recoverPublisherMessages(pubChannel);

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

        // Start publishing any messages waiting in the local queue.
        pumpPublisher();

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
 * Remove a message from publisher accounting after final confirmation.
 */
function completePublisherMessage(item, error = null) {
  if (item.completed) return;

  item.completed = true;

  publisherPendingMessages--;
  publisherPendingBytes -= item.payload.length;

  if (publisherPendingMessages < 0) {
    publisherPendingMessages = 0;
  }

  if (publisherPendingBytes < 0) {
    publisherPendingBytes = 0;
  }

  if (item.resolve) {
    if (error) {
      item.reject(error);
    } else {
      item.resolve();
    }
  }
}

/**
 * Retry a message without changing pending-message accounting.
 */
function retryPublisherMessage(item) {
  if (item.completed || item.queuedForRetry) return;

  item.queuedForRetry = true;
  publisherQueue.unshift(item);

  if (!publisherRetryTimer) {
    publisherRetryTimer = setTimeout(() => {
      publisherRetryTimer = null;
      pumpPublisher();
    }, PUBLISHER_RETRY_DELAY);
  }
}

/**
 * Handle messages that were sent but not confirmed before
 * the publisher channel closed.
 */
function recoverPublisherMessages(ch) {
  for (const item of publisherInFlight) {
    if (item.channel !== ch) continue;

    publisherInFlight.delete(item);

    if (!item.completed) {
      retryPublisherMessage(item);
    }
  }

  publisherBlocked = false;
}

/**
 * Admit a message into the bounded local publisher queue.
 *
 * Normal publishing resolves after local queue admission.
 * Confirmed publishing resolves only after RabbitMQ confirms it.
 */
function enqueuePublisherMessage(
  queue,
  data,
  options = {},
  waitForConfirm = false,
) {
  const payload = Buffer.from(JSON.stringify(data));

  if (
    publisherPendingMessages >= MAX_PUBLISHER_PENDING_MESSAGES ||
    publisherPendingBytes + payload.length > MAX_PUBLISHER_PENDING_BYTES
  ) {
    throw new Error(
      `RabbitMQ publisher queue is full. Pending messages: ${publisherPendingMessages}, pending MB: ${(publisherPendingBytes / 1024 / 1024).toFixed(2)}`,
    );
  }

  publisherPendingMessages++;
  publisherPendingBytes += payload.length;

  let resolveConfirmation;
  let rejectConfirmation;

  const confirmationPromise = waitForConfirm
    ? new Promise((resolve, reject) => {
        resolveConfirmation = resolve;
        rejectConfirmation = reject;
      })
    : null;

  const item = {
    queue,
    payload,
    options: {
      persistent: true,
      contentType: "application/json",
      ...options,
    },
    resolve: resolveConfirmation,
    reject: rejectConfirmation,
    completed: false,
    queuedForRetry: false,
    channel: null,
  };

  publisherQueue.push(item);

  // Run publisher independently of the TCP packet handler.
  setImmediate(() => {
    pumpPublisher();
  });

  return confirmationPromise;
}

/**
 * Send queued messages in the background.
 *
 * Each message uses its own confirmation callback.
 * No global waitForConfirms() call is used here.
 */
async function pumpPublisher() {
  if (publisherPumpRunning || publisherBlocked) return;

  publisherPumpRunning = true;

  try {
    while (
      publisherQueue.length > 0 &&
      publisherInFlight.size < MAX_PUBLISHER_IN_FLIGHT &&
      !publisherBlocked
    ) {
      const ch = await getPublisherChannel();

      if (!ch || ch !== publisherChannel) {
        break;
      }

      const item = publisherQueue.shift();

      if (!item || item.completed) {
        continue;
      }

      item.queuedForRetry = false;
      item.channel = ch;
      publisherInFlight.add(item);

      maxPublishInFlight = Math.max(maxPublishInFlight, publisherInFlight.size);

      let writable;

      try {
        writable = ch.sendToQueue(
          item.queue,
          item.payload,
          item.options,
          (error) => {
            // Ignore callbacks for messages already recovered
            // after a channel-close event.
            if (!publisherInFlight.has(item)) return;

            publisherInFlight.delete(item);

            if (error) {
              console.error(
                `[RABBIT PUBLISH] Broker did not confirm ${item.queue}:`,
                error.message,
              );

              retryPublisherMessage(item);
              return;
            }

            completePublisherMessage(item);

            // Continue publishing after each confirmation.
            setImmediate(() => {
              pumpPublisher();
            });
          },
        );
      } catch (error) {
        publisherInFlight.delete(item);

        console.error(
          `[RABBIT PUBLISH] Send failed (${item.queue}):`,
          error.message,
        );

        retryPublisherMessage(item);
        break;
      }

      // Writable backpressure: wait for drain before sending more.
      if (!writable) {
        publisherBlocked = true;
        publisherBackpressureCount++;

        ch.once("drain", () => {
          // Ignore a drain event from an obsolete channel.
          if (publisherChannel !== ch) return;

          publisherBlocked = false;
          pumpPublisher();
        });

        break;
      }
    }
  } catch (error) {
    console.error("[RABBIT PUBLISHER] Pump failed:", error.message);

    if (!publisherRetryTimer) {
      publisherRetryTimer = setTimeout(() => {
        publisherRetryTimer = null;
        pumpPublisher();
      }, PUBLISHER_RETRY_DELAY);
    }
  } finally {
    publisherPumpRunning = false;
  }
}

/**
 * Normal publisher.
 *
 * Resolves when the bounded local queue accepts the message.
 * Broker confirmation happens in the background.
 */
async function publish(queue, data) {
  enqueuePublisherMessage(queue, data);
}

/**
 * Confirmed publisher.
 *
 * Used by retry/dead-letter handling.
 * Resolves only after RabbitMQ confirms the replacement message.
 */
async function publishConfirmed(queue, data, options = {}) {
  return enqueuePublisherMessage(queue, data, options, true);
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

  if (!batchChannel) return;

  consumer.flushing = true;

  const batch = consumer.pending.splice(0, consumer.options.batchSize);

  try {
    const readings = batch.map((item) => item.data);

    // Attempt MongoDB persistence.
    await consumer.handler(readings);

    // Acknowledge only using the original channel.
    if (consumer.channel === batchChannel) {
      for (const item of batch) {
        batchChannel.ack(item.msg);
      }
    }
  } catch (err) {
    console.error(`[READING WORKER] Batch save failed: ${err.message}`);

    if (consumer.channel === batchChannel) {
      try {
        for (const item of batch) {
          if (consumer.channel !== batchChannel) {
            break;
          }

          const headers = item.msg.properties.headers || {};

          const previousRetries = Number(headers["x-reading-retry-count"] || 0);

          const nextRetries = previousRetries + 1;

          if (previousRetries >= MAX_READING_RETRIES) {
            // Maximum retries reached: move reading to dead queue.
            await publishConfirmed(READING_DEAD_QUEUE, item.data, {
              headers: {
                "x-reading-retry-count": previousRetries,
                "x-reading-failure": err.message,
              },
            });

            console.error(
              `[READING DEAD] Reading moved to dead queue: ${item.data._id}`,
            );
          } else {
            // Publish reading to retry queue with 5-second TTL.
            await publishConfirmed(READING_RETRY_QUEUE, item.data, {
              expiration: String(READING_RETRY_DELAY),
              headers: {
                "x-reading-retry-count": nextRetries,
              },
            });

            console.warn(
              `[READING RETRY] ${item.data._id} - Attempt ${nextRetries}/${MAX_READING_RETRIES}`,
            );
          }

          // Acknowledge original only after replacement is confirmed.
          if (consumer.channel !== batchChannel) {
            break;
          }

          batchChannel.ack(item.msg);
        }
      } catch (retryError) {
        console.error(
          "[READING RETRY] Failed to publish replacement:",
          retryError.message,
        );

        // Leave remaining messages unacknowledged.
        // Closing the channel makes RabbitMQ requeue them.
        try {
          await batchChannel.close();
        } catch (closeError) {
          console.error(
            "[READING RETRY] Channel close error:",
            closeError.message,
          );
        }
      }
    }
  } finally {
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
