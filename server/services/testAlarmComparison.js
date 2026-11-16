const { connectRedis, redisClient } = require("./redisClient");

const {
  updateCurrentAlarmsRedis,
  getCurrentAlarmPersistenceState,
  getDirtyCurrentAlarmDevices,
} = require("../redis/currentAlarmRedis");

async function testAlarmComparison() {
  try {
    await connectRedis();

    const ip = "192.168.0.1";

    const before = await getCurrentAlarmPersistenceState(ip);

    console.log("Before test:");
    console.log({
      version: before.version,
      persistedVersion: before.persistedVersion,
    });

    // Send exactly the same alarms already stored in Redis.
    const changed = await updateCurrentAlarmsRedis(ip, before.alarms);

    const after = await getCurrentAlarmPersistenceState(ip);

    console.log("\nComparison result:", changed);

    console.log("\nAfter test:");
    console.log({
      version: after.version,
      persistedVersion: after.persistedVersion,
    });

    console.log("\nDirty devices:", await getDirtyCurrentAlarmDevices());
  } catch (error) {
    console.error("Comparison test failed:", error);
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

testAlarmComparison();
