const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    data: { type: Object, required: true },
    description: { type: String, required: true, trim: true },
    fullname: { type: String, required: true },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User"
    }
  },
  {
    timestamps: true
  }
);

const Evidence = mongoose.model("Evidence", schema);

module.exports = Evidence;
