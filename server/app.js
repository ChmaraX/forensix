const express = require("express");
// require("./db/mongoose");

const {
  setVolumeInfo,
  setVolumePath
} = require("./controllers/VolumesController");
const historyRouter = require("./routers/history");
const cacheRouter = require("./routers/cache");
const userRouter = require("./routers/user");
const volumeRouter = require("./routers/volumes");
const loginDataRouter = require("./routers/logindata");
const profileRouter = require("./routers/profile");

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
app.use(
  historyRouter,
  cacheRouter,
  userRouter,
  volumeRouter,
  loginDataRouter,
  profileRouter
);

// setting global variable with location of data
setVolumePath();

// get info about mounted volume
setVolumeInfo();

module.exports = app;
