const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const schema = new mongoose.Schema(
  {
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    token: { type: String, required: false }
  },
  {
    timestamps: true
  }
);

schema.virtual("evidences", {
  ref: "Evidence",
  localField: "_id",
  foreignField: "reporter"
});

schema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.token;

  return userObject;
};

schema.statics.authenticate = async (username, password) => {
  const user = await User.findOne({ username });
  const isMatch = bcrypt.compareSync(password, user.password);

  if (user && isMatch) {
    const token = jwt.sign({ _id: user._id.toString() }, "secrettoken123");
    user.token = token;
    await user.save();

    return { user, token };
  } else {
    throw new Error("Unable to login");
  }
};

// Hashing plain text password before saving
schema.pre("save", async function(next) {
  const user = this;

  if (user.isModified("password")) {
    user.password = await bcrypt.hash(user.password, 8);
  }

  next();
});

const User = mongoose.model("User", schema);

module.exports = User;
