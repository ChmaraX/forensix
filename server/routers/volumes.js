const express = require("express");
const router = new express.Router();
const chalk = require("chalk");
const {
  getVolumeInfo,
  generateChecksum,
  compareChecksums,
  getVolumeDirTree
} = require("../controllers/VolumesController");

router.get("/volumes", async (req, res) => {
  try {
    const volume = getVolumeInfo();

    res.status(200).send(volume);
  } catch (e) {
    res.status(400).send(e);
  }
});

router.get("/volumes/tree", async (req, res) => {
  try {
    const tree = getVolumeDirTree();

    res.status(200).send(tree);
  } catch (e) {
    res.status(400).send(e);
  }
});

router.get("/volumes/verify", async (req, res) => {
  try {
    process.stdout.write(`[VERIFY] veryfing integrity ... `);
    const sum = await generateChecksum(process.env.VOLUME_PATH);

    if (compareChecksums(sum, process.env.VOLUME_CHECKSUM)) {
      console.log(chalk.green(" [ OK ]"));
      res.status(200).send({ status: "verified", hash: sum });
    } else {
      console.log(chalk.red(" [ COMPROMISED ]"));
      res.status(200).send({
        status: "compromised",
        hashNew: sum,
        hashOld: process.env.VOLUME_CHECKSUM
      });
    }
  } catch (e) {
    console.log(e);
    res.status(500).send("Error veryfiing.");
  }
});

module.exports = router;
