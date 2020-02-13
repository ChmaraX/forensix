const express = require("express");
const router = new express.Router();
const chalk = require("chalk");
const getTopSites = require("../controllers/TopSitesController");

router.get("/topsites", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const data = await getTopSites();

    res.send(data);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

module.exports = router;
