const express = require("express");
const router = express.Router();

const {
    getInventory,
    getPerformance,
    // getPerformance
} = require("../controller/nms.controller.js");

router.get("/inventory", getInventory);
router.get("/performance", getPerformance);

// router.get("/performance", getPerformance);

module.exports = router;