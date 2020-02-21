const express = require("express");
const router = new express.Router();
const chalk = require("chalk");
const {
  getFavicons,
  getFavicon
} = require("../controllers/FaviconsController");

router.get("/favicons", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const data = await getFavicons();

    res.send(data);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

router.get("/favicons/:id", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const data = await getFavicon(req.params.id);

    res.send(data);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    res.status(500).send();
  }
});

module.exports = router;
