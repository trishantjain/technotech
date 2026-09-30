const express = require("express");
const router = express.Router();

const {
    getInventory,
    getPerformance,
    getAlarms,
    createDowntime,
    getDowntimes,
    updateDowntime,
    deleteDowntime,
    getBatteryBackupAlarms
} = require("../controller/nms.controller.js");

router.get("/inventory", getInventory);
router.get("/performance", getPerformance);
router.get("/alarms", getAlarms);

router.post("/downtime", createDowntime);
router.get("/downtime", getDowntimes);
router.put("/downtime/:id", updateDowntime);
router.delete("/downtime", deleteDowntime);
router.get("/battery-backup-alarms", getBatteryBackupAlarms);

module.exports = router;