const mongoose = require("mongoose");

const alarmSchema = new mongoose.Schema(
  {
    alert_id: {
      type: String,
      unique: true,
      required: true
    },

    device_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true
    },

    device_ip: {
      type: String,
      required: true
    },

    // true = device alarm (offline/down)
    // false = service/metric alarm
    alert_type: {
      type: Boolean,
      default: false
    },

    alert_severity: {
      type: String,
      enum: ["critical", "major", "minor"],
      required: true
    },

    created_at: {
      type: Date,
      default: Date.now
    },

    last_hard_state_change: {
      type: Date,
      default: Date.now
    },

    resolved_at: {
      type: Date,
      default: null
    },

    value: {
      type: String,
      default: ""
    },

    reason: {
      type: String,
      default: ""
    },

    acknowledgement_status: {
      type: Boolean,
      default: false
    },

    service_name: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Fast lookup of active alarms for a device
alarmSchema.index({
  device_id: 1,
  resolved_at: 1
});

alarmSchema.index({
  service_name: 1,
  device_id: 1,
  resolved_at: 1
});

alarmSchema.index({
  created_at: -1
});

module.exports = mongoose.model("Alarm", alarmSchema);