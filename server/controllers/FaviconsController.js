const getDbTable = require("./db_operations");
const _ = require("lodash");
const parse = require("url-parse");

const getFavicons = async () => {
  const favicons = await getDbTable({
    db_name: "Favicons",
    table: "favicons"
  });

  return favicons.results;
};

const getFavicon = async id => {
  const favicon = await getDbTable({
    db_name: "Favicons",
    table: "icon_mapping",
    where: `icon_id = ${id}`
  });

  return favicon.results;
};

module.exports = { getFavicons, getFavicon };
