const Database = require("better-sqlite3");
const path = require("path");

const getDatabase = dbPath => {
  try {
    return new Database(dbPath, { readonly: true });
  } catch (err) {
    console.log("Cant open database.");
    throw err;
  }
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
  const dbPath = path.join(process.env.VOLUME_PATH, db_name);
  let db;
  
  try {
    db = getDatabase(dbPath);
    const query = queryBuilder({
      db_name,
      table,
      limit,
      row,
      where,
      groupBy,
      orderBy
    });

    const results = db.prepare(query).all();
    return { results };
  } catch (err) {
    console.error("Database query error:", err.message);
    return { results: [] };
  } finally {
    if (db) {
      db.close();
    }
  }
};

module.exports = getDbTable;
