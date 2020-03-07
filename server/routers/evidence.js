const express = require("express");
const router = new express.Router();
const Evidence = require("../models/evidence");
const auth = require("../middleware/auth");
const chalk = require("chalk");

router.post("/evidences", auth, async (req, res) => {
  process.stdout.write(`[EVIDENCE] adding ... `);
  const evidence = new Evidence({
    ...req.body,
    reporter: req.user._id,
    fullname: req.user.firstName + " " + req.user.lastName
  });

  try {
    await evidence.save();
    res.status(201).send(evidence);
  } catch (e) {
    res.status(400).send(e);
  }
  console.log(chalk.green(" [ OK ]"));
});

router.get("/evidences", auth, async (req, res) => {
  try {
    const evidences = await Evidence.find().select();
    res.status(201).send(evidences);
  } catch (e) {
    res.status(400).send(e);
  }
});

module.exports = router;
