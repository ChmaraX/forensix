const express = require("express");
const https = require("https");
const path = require("path");

const app = express();

app.use(express.static(path.join(__dirname, "build")));

app.get("/*", function(req, res) {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, function() {
  console.log("Server is listening on port %s", PORT);
});
