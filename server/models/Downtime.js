const mongoose = require("mongoose");

const downtimeSchema = new mongoose.Schema(
    {
        device_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Device",
            required: true
        },

        downtime_start: {
            type: Date,
            required: true
        },

        downtime_end: {
            type: Date,
            required: true
        },

        reason: {
            type: String,
            default: ""
        },

        initiated_by: {
            type: String,
            default: ""
        },

        created_by: {
            type: String,
            default: ""
        },

        notes: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true
    }
);

downtimeSchema.index({
    device_id: 1,
    downtime_start: 1,
    downtime_end: 1
});

module.exports = mongoose.model("Downtime", downtimeSchema);