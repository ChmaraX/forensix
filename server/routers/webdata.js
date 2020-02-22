const express = require("express");
const router = new express.Router();
const chalk = require("chalk");
const {
  getAutofill,
  findPhoneNumbers,
  findGeolocationData
} = require("../controllers/WebDataController.js");

router.get("/webdata/autofills", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const data = await getAutofill();

    res.send(data);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

router.get("/webdata/phonenums", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const data = findPhoneNumbers(await getAutofill());

    res.send(data);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

router.get("/webdata/geo", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const data = findGeolocationData(await getAutofill());

    res.send(data);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

module.exports = router;
