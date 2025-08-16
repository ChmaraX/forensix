const mongoose = require("mongoose");

process.env.MONGO_HOST = process.env.DEV ? "localhost" : "mongodb";

mongoose.set('strictQuery', false);

mongoose.connect(`mongodb://${process.env.MONGO_HOST}:27017/forensix-mongodb`, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on("open", () => {
  console.log("Successfully connected to mongodb");
});

mongoose.connection.on("error", (err) => {
  console.log("Error connecting to mongodb:", err);
});
