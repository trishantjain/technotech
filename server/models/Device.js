const mongoose = require('mongoose');
const deviceSchema = new mongoose.Schema(
  {
    // STORING IP OF DEVICE
    mac: {
      type: String,
      unique: true,
      required: true
    },

    location:String,

    deviceName: String,

    address: String,

    latitude: Number,

    longitude: Number,

    ipCamera: {
      type: {
        type: String,
        required: false,
        default: "T"
      },
      ip: {
        type: String,
        required: false
      }
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    createdBy: {
      type: String, // username from JWT
      required: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    approvedBy: {
      type: String,
      default: null,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    vendorName: {
      type: String,
      default: ""
    },

    modelNumber: {
      type: String,
      default: ""
    },

    deviceSerialNumber: {
      type: String,
      default: ""
    },

    deviceType: {
      type: String,
      default: "EMS"
    },

    deviceName: {
      type: String,
      default: ""
    },

    maintenanceMode: {
      type: String,
      default: "Inactive"
    },

    swVersion: {
      type: String,
      default: ""
    },

    upsSoftwareVersion: {
      type: String,
      default: ""
    },

    rectifier1Version: {
      type: String,
      default: ""
    },

    rectifier1SrNo: {
      type: String,
      default: ""
    },

    rectifier2Version: {
      type: String,
      default: ""
    },

    rectifier2SrNo: {
      type: String,
      default: ""
    },

    solarMpptVersion: {
      type: String,
      default: ""
    },

    solarMpptSrNo: {
      type: String,
      default: ""
    },

    inverterSrNo: {
      type: String,
      default: ""
    },

    upsBatterySrNo: {
      type: String,
      default: ""
    },

    modifyTimeTicks: {
      type: Number,
      default: 0
    },

    modifyField: {
      type: String,
      default: ""
    }
  }
);

module.exports = mongoose.model('Device', deviceSchema);
