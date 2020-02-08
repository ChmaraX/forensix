const Promise = require("bluebird");
const fs = Promise.promisifyAll(require("fs"));
const path = require("path");

const findInCache = async (keyword, limit = 5) => {
  const directoryPath = path.join(process.env.VOLUME_PATH, "/Cache");
  const cacheFiles = await readCache(directoryPath);

  console.log("Total cache files found: ", cacheFiles.length);
  return findInRecords(directoryPath, cacheFiles, keyword, limit).then(res => {
    foundIn = [];

    res.forEach(dump => {
      if (dump.includes(keyword)) {
        foundIn.push(dump);
      }
    });

    console.log(foundIn);

    return { foundIn };
  });
};

async function readCache(directoryPath) {
  return new Promise(resolve => {
    fs.readdir(directoryPath, function(err, files) {
      if (err) {
        return console.log("Unable to scan directory: " + err);
      }
      resolve(files);
    });
  });
}

function findInRecords(directoryPath, cacheFiles, keyword, limit) {
  let results = [];

  cacheFiles.shift();
  cacheFiles.map((file, i) => {
    if (i < limit) {
      results.push(readFile(path.join(directoryPath, file)));
    }
  });

  return Promise.all(results);
}

async function readFile(file) {
  let data = await fs.readFileAsync(file, "utf8");
  const buff = Buffer.from(data, "ascii");
  return hexdump(buff);
}

function hexdump(buffer) {
  let lines = [];

  for (let i = 0; i < buffer.length; i += 16) {
    let address = i.toString(16).padStart(8, "0"); // address
    let block = buffer.slice(i, i + 16); // cut buffer into blocks of 16
    let hexArray = [];
    let asciiArray = [];
    let padding = "";

    for (let value of block) {
      hexArray.push(value.toString(16).padStart(2, "0"));
      asciiArray.push(
        value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : "."
      );
    }

    // if block is less than 16 bytes, calculate remaining space
    if (hexArray.length < 16) {
      let space = 16 - hexArray.length;
      padding = " ".repeat(space * 2 + space + (hexArray.length < 9 ? 1 : 0)); // calculate extra space if 8 or less
    }

    let hexString =
      hexArray.length > 8
        ? hexArray.slice(0, 8).join(" ") + "  " + hexArray.slice(8).join(" ")
        : hexArray.join(" ");

    let asciiString = asciiArray.join("");
    let line = `${address}  ${hexString}  ${padding}|${asciiString}|`;

    lines.push(line);
  }

  return lines.join("\n");
}

module.exports = findInCache;
