const app = require("./app");
const https = require("https");
const http = require("http");
const fs = require("fs");
const { generateChecksum } = require("./controllers/VolumesController");

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

// first generate SHA1 hash out of data medium
console.log(
  "Generating initial SHA1 hash over the folder: %s",
  process.env.VOLUME_PATH
);

generateChecksum(process.env.VOLUME_PATH).then(checksum => {
  process.env.VOLUME_CHECKSUM = checksum;
  console.log("SHA1 hash of medium: %s", checksum);

  // if certificates are present run as https
  fs.readdir("./certificates", function(err, files) {
    if (files.length <= 1) {
      const httpServer = http.createServer(app);
      httpServer.listen(PORT, HOST, () => {
        console.log("Server (http) is listening on %s:%s", HOST, PORT);
      });
    } else {
      const httpsServer = https.createServer(
        {
          key: fs.readFileSync("./certificates/server.key"),
          cert: fs.readFileSync("./certificates/server.cert")
        },
        app
      );
      httpsServer.listen(PORT, HOST, () => {
        console.log("Server (https) is listening on %s:%s", HOST, PORT);
      });
    }
  });
});

module.exports = app;
