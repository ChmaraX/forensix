const express = require("express");
const router = new express.Router();
const { getCacheEntries } = require("../controllers/CacheController");
const chalk = require("chalk");

router.get("/cache", async (req, res) => {
  try {
    process.stdout.write(`[SCAN] cache ... `);
    const {parsedBlocks, totalCount} = getCacheEntries(req.query.count);

    res.send({parsedBlocks, totalCount});
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    console.log(e);
    res.status(500).send();
  }
});

module.exports = router;
