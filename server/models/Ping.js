const mongoose = require("mongoose");

const pingSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    sendTimeTicks: {
      type: Number,
      required: true,
    },
    response: {
      type: Boolean,
      required: true,
    },
  },
  {
    collection: "Ping",
    versionKey: false,
  },
);

module.exports = mongoose.models.Ping || mongoose.model("Ping", pingSchema);
