const express = require("express");
const router = new express.Router();

router.get("/volumes", async (req, res) => {
  try {
    const volume = process.env.VOLUME_INFO.split(" ").filter(
      el => !["on", "type"].includes(el)
    );

    const volume_info = {
      location: volume[0],
      mount_point: volume[1],
      file_system: volume[2],
      mount_opts: volume[3],
      hash: process.env.DATA_CHECKSUM
    };

    res.status(200).send({ volume_info });
  } catch (e) {
    res.status(400).send(e);
  }
});

module.exports = router;
