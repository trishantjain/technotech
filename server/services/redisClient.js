const { createClient } = require("redis");

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
});

let connectPromise = null;

redisClient.on("error", (error) => {
  console.error("[Redis] Client error:", error.message);
});

redisClient.on("ready", () => {
  console.log("[Redis] Connection ready");
});

redisClient.on("reconnecting", () => {
  console.warn("[Redis] Reconnecting...");
});

async function connectRedis() {
  if (redisClient.isReady) {
    return;
  }

  if (!connectPromise) {
    connectPromise = redisClient.connect().finally(() => {
      connectPromise = null;
    });
  }

  await connectPromise;
}

module.exports = {
  redisClient,
  connectRedis,
};
