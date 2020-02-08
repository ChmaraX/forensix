const express = require("express");
const router = new express.Router();
const {
  estimateFullname,
  estimateNation,
  getAvatars,
  systemSpecs,
  getAccounts,
  getBirthday
} = require("../controllers/SuspectProfile");
const chalk = require("chalk");

router.get("/profile/estimate", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const fullname = await estimateFullname();
    const nation = await estimateNation();
    const avatars = getAvatars();
    const birthday = getBirthday();
    const address = "not found";
    const credit_card = "not found";

    res.send({
      fullname,
      nation,
      birthday,
      address,
      credit_card,
      avatars
    });
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    console.log(e);
    res.status(500).send();
  }
});

router.get("/profile/accounts", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const accounts = getAccounts();

    res.send(accounts);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    console.log(e);
    res.status(500).send();
  }
});

router.get("/profile/system-specs", async (req, res) => {
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
