const inventoryService = require("../services/invertoryService.js");
const performanceService = require("../services/performanceService.js")

async function getInventory(req, res) {
    try {
        const result = await inventoryService.getInventory();

        res.json({
            success: true,
            data: result
        });

    } catch (err) {
        console.error("Inventory API Error:", err);

        res.status(500).json({
            success: false,
            message: "Failed to fetch inventory"
        });

    }
}

async function getPerformance(req, res) {
    try {
        const result = await performanceService.getPerformance();

        res.json({
            success: true,
            data: result
        });

    } catch (err) {
        console.error("Performance API Error:", err);

        res.status(500).json({
            success: false,
            message: "Failed to fetch performance."
        });
    }
}

module.exports = {
    getInventory, 
    getPerformance
};