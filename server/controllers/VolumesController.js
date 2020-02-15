const { execSync } = require("child_process");
const { hashElement } = require("folder-hash");
const fs = require("fs");

const setVolumeInfo = () => {
  try {
    process.env.VOLUME_INFO = execSync("mount | grep /app/data").toString();
  } catch (e) {
    // dev only
    process.env.VOLUME_INFO =
      "/dev/sda2 on /app/data type ext4 (ro,relatime,errors=remount-ro,data=ordered)";
  }
};

const getVolumeInfo = () => {
  const volume = process.env.VOLUME_INFO.split(" ").filter(
    el => !["on", "type"].includes(el)
  );

  const volume_info = {
    location: volume[0],
    mount_point: volume[1],
    file_system: volume[2],
    mount_opts: volume[3],
    hash: process.env.DATA_CHECKSUM
  };

  return volume_info;
};

const setVolumePath = () => {
  if (process.env.DEV) {
    process.env.VOLUME_PATH = process.env.PWD + "/../data1";
  } else {
    process.env.VOLUME_PATH = "./data";
  }
};

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
  setVolumeInfo,
  setVolumePath,
  generateChecksum,
  compareChecksums,
  getVolumeInfo
};
