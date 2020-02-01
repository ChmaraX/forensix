const express = require("express");
const router = new express.Router();
const chalk = require("chalk");
const { compareChecksums, generateChecksum } = require("../utils/checksum");

router.get("/verify", async (req, res) => {
  try {
    process.stdout.write(`[VERIFY] veryfing integrity ... `);
    const sum = await generateChecksum(process.env.DATA);

    if (compareChecksums(sum, process.env.DATA_CHECKSUM)) {
      console.log(chalk.green(" [ OK ]"));
      res.status(200).send({ status: "verified", hash: sum });
    } else {
      console.log(chalk.red(" [ COMPROMISED ]"));
      res.status(200).send({
        status: "compromised",
        hashNew: sum,
        hashOld: process.env.DATA_CHECKSUM
      });
    }
  } catch (e) {
    console.log(e);
    res.status(500).send("Error veryfiing.");
  }
});

module.exports = router;
