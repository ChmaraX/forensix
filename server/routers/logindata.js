const express = require("express");
const router = new express.Router();
const {
  getLoginCredentials,
  getLoginData
} = require("../controllers/LoginDataController");

const chalk = require("chalk");

router.get("/logindata", async (req, res) => {
  try {
    process.stdout.write(`\n[GET] ${req.path} ... `);
    const data = await getLoginData();

    res.send(data);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

router.get("/logindata/credentials", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const data = await getLoginCredentials();

    res.send(data);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

module.exports = router;
