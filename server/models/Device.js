const mongoose = require('mongoose');
const deviceSchema = new mongoose.Schema({
  mac: {
    type: String,
    unique: true,
    required: true
  },
  locationId: String,
  address: String,
  latitude: Number,
  longitude: Number,
  ipCamera: {
    type: {
      type: String,
      required: false
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
});

module.exports = mongoose.model('Device', deviceSchema);
