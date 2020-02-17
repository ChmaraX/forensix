const getDbTable = require("./db_operations");
const getTopSites = require("./TopSitesController");
const _ = require("lodash");
const parse = require("url-parse");

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

const QUALIFIERS = {
  0x01000000: "FORWARD_BACK",
  0x02000000: "FROM_ADDRESS_BAR",
  0x04000000: "HOME_PAGE",
  0x10000000: "CHAIN_START",
  0x20000000: "CHAIN_END",
  0x40000000: "CLIENT_REDIRECT",
  0x80000000: "SERVER_REDIRECT",
  0xc0000000: "IS_REDIRECT_MASK"
};

const QUAL_MASK = 0xffffff00;
const TRANS_MASK = 0xff;

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
      transition:
        TRANSITIONS[("0x" + record.transition.toString(16)) & TRANS_MASK]
    };
  });

  return history;
};

const getAvgDuration = async urls => {
  let avgDurations = [];

  return new Promise((resolve, reject) => {
    urls.map(site => {
      getDbTable({
        db_name: "History",
        row:
          "urls.url, AVG(visits.visit_duration/1000000) as avg_visit_duration",
        table: "urls, visits",
        where: `urls.id = visits.url AND visits.visit_duration > 0 AND urls.url LIKE '%${
          parse(site.url).hostname
        }%' `
      }).then(data => {
        avgDurations.push(data.results[0]);

        if (avgDurations.length === urls.length) {
          avgDurations = avgDurations.map(site => {
            return {
              url: parse(site.url).hostname,
              avg_visit_duration: Math.round(site.avg_visit_duration)
            };
          });
          resolve(avgDurations);
        }
      });
    });
  });
};

module.exports = {
  classifyUrls,
  getHistoryActivity,
  getHistory,
  getAvgDuration
};
