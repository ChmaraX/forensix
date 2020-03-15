const express = require("express");
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(express.static(path.join(__dirname, "build")));

app.get("/*", function(req, res) {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

fs.readdir("./certificates", function(err, files) {
  if (files.length <= 1) {
    const httpServer = http.createServer(app);

    httpServer.listen(PORT, HOST, function() {
      console.log(
        "Production UI server (http) is listening on %s:%s",
        HOST,
        PORT
      );
    });
  } else {
    const httpsServer = https.createServer(
      {
        key: fs.readFileSync("./certificates/server.key"),
        cert: fs.readFileSync("./certificates/server.cert")
      },
      app
    );
    httpsServer.listen(PORT, HOST, function() {
      console.log(
        "Production UI server (https) is listening on %s:%s",
        HOST,
        PORT
      );
    });
  }
});
