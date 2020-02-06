const app = require("./app");
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

  // then make server available
  app.listen(PORT, HOST, () => {
    console.log("Server is listening on %s:%s", HOST, PORT);
  });
});

module.exports = app;
