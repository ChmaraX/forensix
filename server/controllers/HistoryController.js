const getDbTable = require("./db_operations");
const _ = require("lodash");

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

  let month = new Array();
  month[0] = "Jan";
  month[1] = "Feb";
  month[2] = "Mar";
  month[3] = "Apr";
  month[4] = "May";
  month[5] = "Jun";
  month[6] = "Jul";
  month[7] = "Aug";
  month[8] = "Sep";
  month[9] = "Oct";
  month[10] = "Nov";
  month[11] = "Dec";

  data.results.some((e, i) => {
    data.results[i].visit_date = e.visit_date.split(" ")[0];
    data.results[i].visit_month = month[new Date(e.visit_date).getMonth()];
  });

  const byMonth = _.chain(data.results)
    .groupBy("visit_month")
    .map((value, key) => ({ month: key, visits: value.length }))
    .value();

  const byDate = _.chain(data.results)
    .groupBy("visit_date")
    .map((value, key) => ({ date: key, visits: value.length }))
    .value();

  return { all: data.results, byMonth, byDate };
};

const TRANSITIONS = [
  "link",
  "typed",
  "auto_bookmark",
  "auto_subframe",
  "manual_subframe",
  "generated",
  "auto_toplevel",
  "form_submit",
  "reload",
  "keyword",
  "keyword_generated"
];

const getHistory = async () => {
  const data = await getDbTable({
    db_name: "History",
    row:
      "urls.url, urls.title, urls.visit_count, urls.typed_count, datetime((urls.last_visit_time/1000000)-11644473600, 'unixepoch', 'localtime') AS last_visit_time, datetime((visits.visit_time/1000000)-11644473600, 'unixepoch', 'localtime') AS visit_time, visits.from_visit, (visits.visit_duration/1000000) as visit_duration, visits.transition",
    table: "urls, visits",
    where: "urls.id = visits.url"
  });

  const history = data.results.map(record => {
    return {
      ...record,
      transition: TRANSITIONS[("0x" + record.transition.toString(16)) & 0xff]
    };
  });

  return history;
};

module.exports = {
  classifyUrls,
  getHistoryActivity,
  getHistory
};
