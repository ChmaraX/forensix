const express = require("express");
const router = new express.Router();
const findInCache = require("../controllers/cache_operations");
const chalk = require("chalk");

router.get("/cache", async (req, res) => {
  try {
    process.stdout.write(`[SCAN] ${req.query.keyword} ... `);
    const data = await findInCache(req.query.keyword, req.query.limit);

    res.send(data);
    console.log("Found in " + data.foundIn.length + chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

module.exports = router;
