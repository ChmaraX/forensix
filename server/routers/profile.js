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
const {
  getAutofill,
  findPhoneNumbers,
  findGeolocationData
} = require("../controllers/WebDataController");
const chalk = require("chalk");

router.get("/profile/estimate", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const fullname = await estimateFullname();
    const nation = await estimateNation();
    const avatars = getAvatars();
    const birthday = getBirthday();
    const { probableAddress, probableCity } = findGeolocationData(
      await getAutofill()
    );

    res.send({
      fullname,
      nation,
      birthday,
      probableAddress,
      probableCity,
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
