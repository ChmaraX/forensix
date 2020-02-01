const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const getDatabase = path => {
  return new sqlite3.Database(path, err => {
    if (err) {
      console.log("Cant open database.");
    }
  });
};

const getChromeHistoryData = async (table, entryCount = 5) => {
  let historyResults = [];

  const dbPath = path.join(process.env.DATA, "/History");
  const db = getDatabase(dbPath);

  return new Promise(resolve => {
    db.each(
      "SELECT * from " + table + " LIMIT " + entryCount,
      (err, row) => {
        if (err) {
          console.log(err);
        }
        historyResults.push(row);
      },
      (err, count) => {
        if (err) {
          console.log(err);
        }
        resolve({ count, historyResults });
      }
    );
  });
};

module.exports = getChromeHistoryData;
