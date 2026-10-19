const Ping = require("../models/Ping");
const { deviceStatusCache } = require("./deviceStatusCache");

const PING_RECORD_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.PING_RECORD_INTERVAL_MS) || 60000,
);

let pingRecordTimer = null;
let isSaving = false;

async function savePingRecords() {
  if (isSaving) {
    console.warn("[PingRecord] Previous save is still running; skipping");
    return;
  }

  isSaving = true;

  try {
    const sendTimeTicks = Date.now();

    const records = Array.from(deviceStatusCache.values()).map(
      ({ deviceId, response }) => ({
        deviceId,
        sendTimeTicks,
        response,
      }),
    );

    if (records.length === 0) {
      console.log("[PingRecord] No devices available to record");
      return;
    }

    await Ping.insertMany(records, { ordered: false });

    console.log(
      `[PingRecord] Saved ${records.length} ping records`
    );
  } catch (error) {
    console.error("[PingRecord] Failed to save records:", error);
  } finally {
    isSaving = false;
  }
}

function startPingRecordService() {
  if (pingRecordTimer) return;

  // Begin after the first full interval; the cache must already be initialized.
  pingRecordTimer = setInterval(savePingRecords, PING_RECORD_INTERVAL_MS);

  console.log(`[PingRecord] Started; interval=${PING_RECORD_INTERVAL_MS}ms`);
}

function stopPingRecordService() {
  if (!pingRecordTimer) return;

  clearInterval(pingRecordTimer);
  pingRecordTimer = null;
}

module.exports = {
  startPingRecordService,
  stopPingRecordService,
  savePingRecords,
};
