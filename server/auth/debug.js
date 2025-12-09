const express = require("express");
const router = express.Router();


router.get("/api/thresholds", (req, res) => {
    res.json(thresholds);
});

router.get("/api/debug/stats", (req, res) => {
    res.json(debug.stats());
});

router.get("/api/debug/health", (req, res) => {
    res.json(debug.healthCheck());
});

router.post("/api/debug/toggle", (req, res) => {
    debug.enabled = !debug.enabled;
    res.json({
        enabled: debug.enabled,
        message: `Debug ${debug.enabled ? 'enabled' : 'disabled'}`,
        timestamp: getFormattedDateTime()
    });
});

router.post("/api/debug/connected-devices", (req, res) => {
    const devices = Array.from(connectedDevices.entries().map(([mac, socket]) => ({
        mac: mac.toLowerCase(), //! Converting to LowerCase()
        connected: !socket.destroyed,
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        lastSeen: getFormattedDateTime()
    })));

    res.json(devices);
});

router.post("/api/debug/reset-counters", (req, res) => {
    debug.errorCount = 0;
    debug.packetCount = 0;
    debug.bufferStats.malformedPackets = 0;
    debug.bufferStats.discardedBytes = 0;
    debug.bufferStats.totalBytes = 0;
    debug.lastPacketTime = null;

    res.json({
        message: "All counters reset",
        resetTime: getFormattedDateTime()
    });
});

router.get("/api/debug/packet-stream", (req, res) => {
    res.json({
        currentTime: getFormattedDateTime(),
        totalPackets: debug.packetCount,
        lastPacketTime: debug.lastPacketTime ? getFormattedDateTime(new Date(debug.lastPacketTime)) : "Never",
        activeConnections: connectedDevices.size,
        bufferStatus: {
            currentBufferSize: readingBuffer.length,
            maxBufferSize: BULK_SAVE_LIMIT
        }
    });
});

module.exports = router;