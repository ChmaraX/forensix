const express = require("express");
const https = require("https");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(express.static(path.join(__dirname, "build")));

app.get("/api*", function(req, res) {
  const apiPath = req.path.split("/api/").pop();
  var newurl = `https://${process.env.API_HOST}:3001/` + apiPath;

  res.redirect(newurl);
});

app.get("/*", function(req, res) {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const httpsServer = https.createServer(
  {
    key: fs.readFileSync("./certificates/server.key"),
    cert: fs.readFileSync("./certificates/server.cert")
  },
  app
);

httpsServer.listen(PORT, HOST, function() {
  console.log("Production UI server is listening on %s:%s", HOST, PORT);
});
