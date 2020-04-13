const express = require("express");
require("./db/mongoose");

const {
  setVolumeInfo,
  setVolumePath,
} = require("./controllers/VolumesController");
const historyRouter = require("./routers/history");
const cacheRouter = require("./routers/cache");
const userRouter = require("./routers/user");
const volumeRouter = require("./routers/volumes");
const loginDataRouter = require("./routers/logindata");
const profileRouter = require("./routers/profile");
const topSitesRouter = require("./routers/topsites");
const faviconsRouter = require("./routers/favicons");
const webDataRouter = require("./routers/webdata");
const bookmarksRouter = require("./routers/bookmarks");
const evidenceRouter = require("./routers/evidence");

const auth = require("./middleware/auth");

const cors = require("cors");

const app = express();
app.use(cors());

// registering middlewares
app.all("/bookmarks", auth);
app.all("/cache*", auth);
app.all("/favicons", auth);
app.all("/history*", auth);
app.all("/logindata*", auth);
app.all("/profile*", auth);
app.all("/topsites*", auth);
app.all("/volumes*", auth);
app.all("/webdata*", auth);

// registering routers
app.use(express.json());
app.use(
  historyRouter,
  cacheRouter,
  userRouter,
  volumeRouter,
  loginDataRouter,
  profileRouter,
  topSitesRouter,
  faviconsRouter,
  webDataRouter,
  bookmarksRouter,
  evidenceRouter
);

// setting global variable with location of data
setVolumePath();

// get info about mounted volume
setVolumeInfo();

module.exports = app;
