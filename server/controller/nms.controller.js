const inventoryService = require("../services/invertoryService.js");
const performanceService = require("../services/performanceService.js");
const alarmService = require("../services/alarmService.js");
const downtimeService = require("../services/downtimeService.js");
const connectivityService = require("../services/connectivityService.js");

// GET INVENTORY
async function getInventory(req, res) {
  try {
    const result = await inventoryService.getInventory(req.query);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    console.error("Inventory API Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch inventory",
    });
  }
}

// GET PERFORMANCE
async function getPerformance(req, res) {
  try {
    const result = await performanceService.getPerformance(req.query);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    console.error("Performance API Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch performance.",
    });
  }
}

// GET ALARMS
async function getAlarms(req, res) {
  try {
    const result = await alarmService.getAlarms(req.query);

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("Alarm API Error:", err);

    res.status(400).json({
      success: false,
      message: err.message || "Failed to fetch alarms",
    });
  }
}

async function createDowntime(req, res) {
  try {
    const result = await downtimeService.createDowntime({
      ...req.body,
      created_by: req.user?.username || "NMS",
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("Create Downtime Error:", err);

    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

async function getDowntimes(req, res) {
  try {
    const result = await downtimeService.getDowntimes(req.query);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    console.error("Downtime Listing Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch downtime",
    });
  }
}

async function updateDowntime(req, res) {
  try {
    const result = await downtimeService.updateDowntime(
      req.params.id,
      req.body,
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("Update Downtime Error:", err);

    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

async function deleteDowntime(req, res) {
  try {
    const ids = req.body.downtime_ids;

    const result = await downtimeService.deleteDowntime(ids);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("Delete Downtime Error:", err);

    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

async function getBatteryBackupAlarms(req, res) {
  try {
    const result = await alarmService.getBatteryBackupAlarms(req.query);

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("Battery Backup Alarm API Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch battery backup alarms",
    });
  }
}

async function getPingConnectivity(req, res) {
  try {
    const result = await connectivityService.getPing(req.query);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    console.error("Ping Connectivity API Error:", err);

    res.status(400).json({
      success: false,
      message: err.message || "Failed to fetch ping connectivity",
    });
  }
}

module.exports = {
  getInventory,
  getPerformance,
  getAlarms,
  createDowntime,
  getDowntimes,
  updateDowntime,
  deleteDowntime,
  getBatteryBackupAlarms,
  getPingConnectivity
};
