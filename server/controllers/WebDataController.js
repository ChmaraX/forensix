const getDbTable = require("../controllers/db_operations");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const _ = require("lodash");

const getAutofill = async () => {
  const autofills = await getDbTable({
    db_name: "Web Data",
    table: "autofill",
    row:
      "*, datetime(date_created, 'unixepoch', 'localtime') as date_created, datetime(date_last_used, 'unixepoch', 'localtime') AS date_last_used",
    orderBy: "count DESC"
  });

  return autofills.results;
};

const findPhoneNumbers = data => {
  const phoneNums = data.reduce((nums, e) => {
    let parsedNum = parsePhoneNumberFromString(e.value);
    if (parsedNum) {
      delete parsedNum.metadata;
      nums.push({
        phoneNum: e.value,
        parsedNum: parsedNum
      });
    }
    return nums;
  }, []);

  return phoneNums;
};

const findGeolocationData = data => {
  const CITY_MATCHERS = ["city", "zip", "postal"];
  const ADDRESS_MATCHERS = ["address", "street"];

  const cities = data.reduce((cities, e) => {
    if (new RegExp(CITY_MATCHERS.join("|")).test(e.name)) {
      cities.push(e.value);
    }
    return cities;
  }, []);

  const addresses = data.reduce((addresses, e) => {
    if (
      new RegExp(ADDRESS_MATCHERS.join("|")).test(e.name) &&
      !/^\d+$/.test(e.value)
    ) {
      addresses.push(e.value);
    }
    return addresses;
  }, []);

  const probableAddress = _.head(
    _(addresses)
      .countBy()
      .entries()
      .maxBy(_.last)
  );

  const probableCity = _.head(
    _(cities)
      .countBy()
      .entries()
      .maxBy(_.last)
  );

  return { cities, addresses, probableAddress, probableCity };
};

module.exports = {
  getAutofill,
  findPhoneNumbers,
  findGeolocationData
};
