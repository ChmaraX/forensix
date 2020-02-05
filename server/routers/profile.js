const express = require("express");
const router = new express.Router();
const {
  estimateFullname,
  estimateNation,
  getAvatars,
  systemSpecs
} = require("../controllers/SuspectProfile");
const chalk = require("chalk");

router.get("/estimated-profile", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const fullname = await estimateFullname();
    const nation = await estimateNation();
    const avatars = getAvatars();
    const address = "not found";
    const credit_card = "not found";

    res.send({ fullname, nation, avatars, address, credit_card });
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    console.log(e);
    res.status(500).send();
  }
});

router.get("/system-specs", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const specs = await systemSpecs();

    res.send({ specs });
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    console.log(e);
    res.status(500).send();
  }
});

module.exports = router;
