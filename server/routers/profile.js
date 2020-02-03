const express = require("express");
const router = new express.Router();
const {
  estimateFullname,
  estimateNation,
  getAvatars
} = require("../controllers/SuspectProfile");
const chalk = require("chalk");

router.get("/profile", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const fullname = await estimateFullname();
    const nation = await estimateNation();
    const avatars = getAvatars();

    res.send({ fullname, nation, avatars });
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    console.log(e);
    res.status(500).send();
  }
});

module.exports = router;
