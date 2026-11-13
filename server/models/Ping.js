const mongoose = require("mongoose");

const pingSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
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

pingSchema.index({
  deviceId: 1,
  sendTimeTicks: 1,
});

module.exports = mongoose.models.Ping || mongoose.model("Ping", pingSchema);
