const { getLoginCredentials } = require("./LoginDataController");
const _ = require("lodash");
const getDbTable = require("./db_operations");
const parse = require("url-parse");
const { getCountry, getTLD } = require("tld-countries");
const fs = require("fs");
const path = require("path");

const getMostFrequent = arr => {
  return _.head(
    _(arr)
      .countBy()
      .entries()
      .maxBy(_.last)
  );
};

const estimateFullname = async () => {
  const { all } = await getLoginCredentials();
  estimateNation();

  let parsed = all.map(el => {
    return el.username_value
      .split("@")[0] // Split email usernames
      .replace(/([A-Z])/g, " $1") // Split string to words by uppercase letter
      .replace(/[^A-Za-z]/g, " ") // Remove every non-letter symbols
      .trim();
  });

  // Leave only ones containing space
  let potentialFullnames = parsed.filter(el => el.includes(" "));

  // Capitalize first letter of each word
  potentialFullnames = potentialFullnames.map(name => {
    return name.replace(/\w\S*/g, word => {
      return word.charAt(0).toUpperCase() + word.substr(1).toLowerCase();
    });
  });

  return getMostFrequent(potentialFullnames);
};

const estimateNation = async () => {
  const urls = await getDbTable({
    db_name: "History",
    table: "urls",
    row: "url"
  });

  const tlds = urls.results.map(url => {
    return parse(url.url)
      .hostname.split(".")
      .pop();
  });

  const tldCountries = tlds
    .map(t => getCountry(t))
    .filter(a => a !== undefined);
  const country = getMostFrequent(tldCountries);

  return { country: country, tld: getTLD(country) };
};

const getAvatars = () => {
  const directoryPath = path.join(process.env.DATA, "/Accounts/Avatar Images");
  const files = fs.readdirSync(directoryPath);

  const avatars = files.map(file => {
    const data = fs.readFileSync(path.join(directoryPath, file));
    const base64Image = new Buffer(data, "binary").toString("base64");

    return base64Image;
  });

  return avatars;
};

module.exports = { estimateFullname, estimateNation, getAvatars };
