const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "../.env")
});

async function connectDatabase() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected");
}

module.exports = connectDatabase;