const { connectRedis, redisClient } = require("./services/redisClient");

const {
  getCurrentAlarmPersistenceState,
  getDirtyCurrentAlarmDevices,
} = require("./redis/currentAlarmRedis");

async function checkAlarmState() {
  try {
    await connectRedis();

    // Check Redis alarm state
    const state = await getCurrentAlarmPersistenceState("192.168.0.1");

    console.log("\n===== REDIS ALARM STATE =====");
    console.log("Version:", state?.version);
    console.log("Persisted Version:", state?.persistedVersion);
    console.log("Alarms:", JSON.stringify(state?.alarms, null, 2));

    // Check dirty devices
    const dirtyDevices = await getDirtyCurrentAlarmDevices();

    console.log("\n===== DIRTY DEVICES =====");
    console.log(dirtyDevices);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await redisClient.quit();
  }
}

checkAlarmState();
