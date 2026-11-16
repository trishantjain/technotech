// const { redisClient, connectRedis } = require("./redisClient");

// async function checkDeviceStatus() {
//   try {
//     await connectRedis();

//     const keys = await redisClient.keys("device:*:state");

//     console.log("Total Redis device keys:", keys.length);

//     for (const key of keys) {
//       const state = await redisClient.hGetAll(key);

//       console.log(key, state);
//     }
//   } catch (error) {
//     console.error("Device cache test failed:", error);
//   } finally {
//     if (redisClient.isOpen) {
//       await redisClient.quit();
//     }
//   }
// }

// checkDeviceStatus();

const { connectRedis, redisClient } = require("./redisClient");

async function checkAlarmRedis() {
  try {
    await connectRedis();

    const keys = await redisClient.keys("device:*:alarms");

    console.log("Total alarm Redis keys:", keys.length);

    const ip = "192.168.0.1";
    const key = `device:${encodeURIComponent(ip)}:alarms`;

    const state = await redisClient.hGetAll(key);

    console.log("\nDevice:", ip);
    console.log("Redis alarm state:", state);

    if (state.data) {
      console.log(
        "\nParsed alarms:",
        JSON.stringify(JSON.parse(state.data), null, 2),
      );
    }

    console.log(
      "\nDirty devices:",
      await redisClient.sMembers("currentAlarms:dirty"),
    );
  } catch (error) {
    console.error("Alarm Redis check failed:", error);
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

checkAlarmRedis();
