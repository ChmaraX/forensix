const getDbTable = require("./db_operations");

const classifyUrls = async () => {
  const data = await getDbTable({
    db_name: "History",
    table: "urls",
    row: "url"
  });

  const urls = data.results;

  return new Promise((resolve, reject) => {
    const spawn = require("child_process").spawn;
    const pythonProcess = spawn("python3", [
      "./utils/predictor/url-class.py",
      JSON.stringify(urls)
    ]);

    pythonProcess.stdout.on("data", function(data) {
      try {
        let url_categorized = JSON.parse(data.toString());
        resolve(url_categorized);
      } catch (e) {
        console.log(e);
      }
    });
  });
};

const getHistoryActivity = async () => {
  const data = await getDbTable({
    db_name: "History",
    row:
      "urls.url, datetime((visit_time/1000000)-11644473600, 'unixepoch', 'localtime') AS visit_date",
    table: "urls, visits",
    where: "urls.id = visits.url"
  });

  return data;
};

module.exports = {
  classifyUrls,
  getHistoryActivity
};
