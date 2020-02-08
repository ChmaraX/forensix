const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const getDatabase = path => {
  return new sqlite3.Database(path, err => {
    if (err) {
      console.log("Cant open database.");
    }
  });
};

const queryBuilder = ({ ...params }) => {
  let query = "SELECT * FROM " + params.table;

  if (params.row) {
    query = query.replace("*", params.row);
  }
  if (params.where) {
    query = query + " WHERE " + params.where;
  }
  if (params.groupBy) {
    query = query + " GROUP BY " + params.groupBy;
  }
  if (params.orderBy) {
    query = query + " ORDER BY " + params.orderBy;
  }
  if (params.limit) {
    query = query + " LIMIT " + params.limit;
  }

  return query;
};

const getDbTable = async ({
  db_name,
  table,
  limit,
  row,
  where,
  groupBy,
  orderBy
}) => {
  let results = [];

  const dbPath = path.join(process.env.VOLUME_PATH, db_name);
  const db = getDatabase(dbPath);
  const query = queryBuilder({
    db_name,
    table,
    limit,
    row,
    where,
    groupBy,
    orderBy
  });

  return new Promise(resolve => {
    db.each(
      query,
      (err, row) => {
        if (err) {
          console.log(err);
        }
        results.push(row);
      },
      err => {
        if (err) {
          console.log(err);
        }
        resolve({ results });
      }
    );
  });
};

module.exports = getDbTable;
