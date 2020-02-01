const express = require("express");
const { execSync } = require("child_process");
// require("./db/mongoose");

const historyRouter = require("./routers/history");
const cacheRouter = require("./routers/cache");
const verifyRouter = require("./routers/verify");
const userRouter = require("./routers/user");
const volumeRouter = require("./routers/volumes");

const log = require("./middleware/database-logger");
const auth = require("./middleware/auth");

const cors = require("cors");

const app = express();

// registering middlewares
// app.all("/history*", auth, log);
// app.all("/cache*", auth, log);
// app.all("/cache*", auth, log);
// app.all("/volume*", auth, log);

// registering routers
app.use(express.json());
app.use(historyRouter, cacheRouter, verifyRouter, userRouter, volumeRouter);

// setting global variable with location of data
if (process.env.DEV) {
  process.env.DATA = process.env.PWD + "/../data";
} else {
  process.env.DATA = "./data";
}

// get info about mounted volume
try {
  process.env.VOLUME_INFO = execSync("mount | grep /app/data").toString();
  console.log(process.env.VOLUME_INFO);
} catch (e) {
  // dev only
  process.env.VOLUME_INFO =
    "/dev/sda2 on /app/data type ext4 (ro,relatime,errors=remount-ro,data=ordered)";
}

module.exports = app;
