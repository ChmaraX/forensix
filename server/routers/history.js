const express = require("express");
const router = new express.Router();
const getDbTable = require("../controllers/db_operations");
const chalk = require("chalk");

router.get("/history/:table", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.params.table} ... `);
    const data = await getDbTable({
      db_name: "History",
      table: req.params.table,
      limit: req.query.limit
    });

    res.send(data);
    console.log(data.count + chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

module.exports = router;
