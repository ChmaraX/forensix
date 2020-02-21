const getDbTable = require("../controllers/db_operations");

const validateEmail = email => {
  var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
};

const divide = (arr, condition) => {
  const emails = arr.filter(el => condition(el.username_value));
  const usernames = arr.filter(el => !condition(el.username_value));
  return { emails, usernames };
};

/* 
    returns most used emails and usernames along with 
    their respective total count
*/
const getLoginCredentials = async () => {
  const credentials = await getDbTable({
    db_name: "Login Data",
    table: "logins",
    where: 'username_value IS NOT "" ',
    row: "username_value, count(*) as count",
    groupBy: "username_value",
    orderBy: "count DESC"
  });

  const { emails, usernames } = divide(credentials.results, validateEmail);

  const totalEmails = emails.map(el => el.count).reduce((a, b) => a + b, 0);
  const totalUsernames = usernames
    .map(el => el.count)
    .reduce((a, b) => a + b, 0);

  return {
    emails,
    usernames,
    totalEmails,
    totalUsernames,
    all: credentials.results
  };
};

const getLoginData = async () => {
  const loginData = await getDbTable({
    db_name: "Login Data",
    table: "logins",
    row:
      "*, hex(password_value) AS password_value, datetime((date_created/1000000)-11644473600, 'unixepoch', 'localtime') AS date_created, datetime((date_last_used/1000000)-11644473600, 'unixepoch', 'localtime') AS date_last_used"
  });

  return loginData.results;
};

module.exports = {
  getLoginCredentials,
  getLoginData
};
