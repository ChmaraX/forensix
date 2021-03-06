const mongoose = require("mongoose");

process.env.MONGO_HOST = process.env.DEV ? "localhost" : "mongodb";

mongoose.connect(`mongodb://${process.env.MONGO_HOST}:27017/forensix-mongodb`, {
  useNewUrlParser: true,
  useCreateIndex: true,
  useUnifiedTopology: true
});

mongoose.connection.on("open", err => {
  if (err) {
    console.log("Error connecting to mongodb");
  }
  console.log("Successfully connected to mongodb");
});
