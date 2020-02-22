const { getLoginCredentials } = require("./LoginDataController");
const { findPhoneNumbers, getAutofill } = require("./WebDataController");
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
  const data = findPhoneNumbers(await getAutofill());
  let country;

  if (data.length < 1) {
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

    country = getMostFrequent(tldCountries);
  } else {
    country = getCountry(
      getMostFrequent(
        data.map(e => {
          return e.parsedNum.country;
        })
      )
    );
  }

  return { country: country, tld: getTLD(country) };
};

const getAvatars = () => {
  const directoryPath = path.join(
    process.env.VOLUME_PATH,
    "/Accounts/Avatar Images"
  );
  const files = fs.readdirSync(directoryPath);

  const avatars = files.map(file => {
    const data = fs.readFileSync(path.join(directoryPath, file));
    const base64Image = new Buffer(data, "binary").toString("base64");

    return base64Image;
  });

  return avatars;
};

const getBirthday = () => {
  const preferencesJSON = fs.readFileSync(
    path.join(process.env.VOLUME_PATH, "Preferences")
  );

  const preferences = JSON.parse(preferencesJSON);
  let birthday,
    birthyear,
    gender = "undefined";

  try {
    birthday = preferences.sync.birthday;
    birthyear = preferences.sync.demographics.birth_year;
    gender = preferences.sync.demographics.gender;
  } catch (e) {
    console.log(e);
  }

  return { birthday, birthyear, gender };
};

const getAccounts = () => {
  const preferencesJSON = fs.readFileSync(
    path.join(process.env.VOLUME_PATH, "Preferences")
  );

  const preferences = JSON.parse(preferencesJSON);
  const accounts = preferences.account_info;

  return accounts;
};

const getDeviceProtocols = async () => {
  const urls = await getDbTable({
    db_name: "Login Data",
    table: "logins",
    row: "origin_url"
  });

  const deviceProtocols = ["android", "ios"];

  const deviceNativeRequests = urls.results.filter(url => {
    const protocol = parse(url.origin_url).protocol.split(":")[0];
    return deviceProtocols.includes(protocol);
  });

  const devices = deviceNativeRequests.map(
    req => parse(req.origin_url).protocol.split(":")[0]
  );

  return _.uniq(devices);
};

// C:\user\$USER\AppData\Local\Google\Chrome\User
// Data\Default\
// /Users/$USER/Library/ApplicationSupport/Google/
// Chrome/Default/
// /home/$USER/.config/google-chrome/Default/

const getOperatingSystems = async () => {
  const osDefaultPath = {
    mac: "/Users/",
    linux: "/home/",
    windows: "C:\\Users\\"
  };

  const downloads = await getDbTable({
    db_name: "History",
    table: "downloads",
    row: "target_path"
  });

  let os = [];
  downloads.results.forEach(path => {
    Object.keys(osDefaultPath).forEach(key => {
      if (path.target_path.startsWith(osDefaultPath[key])) {
        if (!os.includes(key)) {
          os.push(key);
        }
      }
    });
  });

  return os;
};

const systemSpecs = async () => {
  const preferencesJSON = fs.readFileSync(
    path.join(process.env.VOLUME_PATH, "Preferences")
  );

  const preferences = JSON.parse(preferencesJSON);

  const chromeVersion = preferences.extensions.last_chrome_version;
  const { bottom, right } = preferences.browser.window_placement;

  return {
    chromeVersion,
    resolution: { bottom, right },
    mobileDevices: await getDeviceProtocols(),
    os: await getOperatingSystems()
  };
};

module.exports = {
  estimateFullname,
  estimateNation,
  getAvatars,
  getBirthday,
  getAccounts,
  systemSpecs
};
