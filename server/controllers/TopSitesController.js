const getDbTable = require("../controllers/db_operations");

const getTopSites = async () => {
  const top_sites = await getDbTable({
    db_name: "Top Sites",
    table: "top_sites",
    orderBy: "url_rank ASC"
  });

  return top_sites.results;
};

module.exports = getTopSites;
