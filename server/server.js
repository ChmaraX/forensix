const app = require("./app");
const https = require("https");
const http = require("http");
const fs = require("fs");
const { generateChecksum } = require("./controllers/VolumesController");

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

const httpsServer = https.createServer(
  {
    key: fs.readFileSync("./certificates/server.key"),
    cert: fs.readFileSync("./certificates/server.cert")
  },
  app
);

const httpServer = http.createServer(app);

// first generate SHA1 hash out of data medium
console.log(
  "Generating initial SHA1 hash over the folder: %s",
  process.env.VOLUME_PATH
);

generateChecksum(process.env.VOLUME_PATH).then(checksum => {
  process.env.VOLUME_CHECKSUM = checksum;
  console.log("SHA1 hash of medium: %s", checksum);

  // then make server available
  if (process.env.DEV) {
    httpServer.listen(PORT, HOST, () => {
      console.log("Server (http) is listening on %s:%s", HOST, PORT);
    });
  } else {
    httpsServer.listen(PORT, HOST, () => {
      console.log("Server (https) is listening on %s:%s", HOST, PORT);
    });
  }
});

module.exports = app;
