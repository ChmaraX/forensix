const { hashElement } = require("folder-hash");
const fs = require("fs");

const generateChecksum = dir => {
  return new Promise((resolve, reject) => {
    hashElement(dir)
      .then(hash => {
        const hashFile = "sha1_data.json";
        const dataHash = hash.hash;

        fs.writeFileSync(hashFile, JSON.stringify(hash, null, 2));
        resolve(dataHash);
      })
      .catch(error => {
        reject();
        return console.error("hashing failed:", error);
      });
  });
};

const compareChecksums = (sum1, sum2) => sum1 === sum2;

module.exports = {
  generateChecksum,
  compareChecksums
};
