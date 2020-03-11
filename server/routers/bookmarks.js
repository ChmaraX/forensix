const express = require("express");
const router = new express.Router();
const chalk = require("chalk");
const fs = require("fs");
const path = require("path");
const _ = require("lodash");

const converWebkitTimestamp = webkitTimestamp => {
  const dateInSeconds = Math.round(webkitTimestamp / 1000000) - 11644473600;
  return new Date(dateInSeconds * 1000).toLocaleDateString();
};

router.get("/bookmarks", async (req, res) => {
  try {
    process.stdout.write(`[GET] ${req.path} ... `);
    const bookmarks = JSON.parse(
      fs.readFileSync(path.join(process.env.VOLUME_PATH, "Bookmarks"))
    );

    let bookmarksBar = bookmarks.roots.bookmark_bar.children;
    let bookmarksOther = bookmarks.roots.other.children;
    let bookmarksSynced = bookmarks.roots.synced.children;

    let bookmarksFlat = _.flatten(
      [...bookmarksBar, bookmarksOther, bookmarksSynced].map(b => {
        if (b.children) {
          return b.children;
        }
        return b;
      })
    );

    bookmarksFlat = bookmarksFlat.map(b => {
      return {
        ...b,
        date_added: converWebkitTimestamp(b.date_added),
        last_visited_desktop: b.meta_info
          ? converWebkitTimestamp(b.meta_info.last_visited_desktop)
          : null
      };
    });

    res.send(bookmarksFlat);
    console.log(chalk.green(" [ OK ]"));
  } catch (e) {
    console.log(e);
    res.status(500).send();
  }
});

module.exports = router;
