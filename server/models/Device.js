const mongoose = require('mongoose');
const deviceSchema = new mongoose.Schema({
  mac: {type: String, unique: true, required: true},
  locationId: String,
  address: String,
  latitude: Number,
  longitude: Number,
  ipCamera: {
    type: {
      type: String,
      required: true
    },
    ip: {
      type: String,
      required: true
    }
  }  // ✅ New field
});

module.exports = mongoose.model('Device', deviceSchema);
