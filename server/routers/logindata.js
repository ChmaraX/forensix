const express = require("express");
const router = new express.Router();
const getDbTable = require("../controllers/db_operations");
const { getLoginCredentials } = require("../controllers/LoginDataController");

const chalk = require("chalk");

router.get("/logindata/table/:table", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const data = await getDbTable({
      db_name: "Login Data",
      table: req.params.table,
      limit: req.query.limit
    });

    res.send(data);
    console.log(data.results.length + chalk.green(" [ OK ]"));
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
