const Promise = require("bluebird");
const fs = Promise.promisifyAll(require("fs"));
const path = require("path");
const hexdump = require("hexdump-nodejs");
const anyBase = require("any-base");
const hex2bin = anyBase(anyBase.HEX, anyBase.BIN);
const bin2hex = anyBase(anyBase.BIN, anyBase.HEX);

const INDEX_HEADER_LENGTH = 256 * 2;
const LRU_LENGTH = 112 * 2;
const ZERO_PADDING_LENGTH = 208 * 2;

const hex_to_ascii = hexString => {
  var str = "";
  for (let n = 0; n < hexString.length; n += 2) {
    str += String.fromCharCode(parseInt(hexString.substr(n, 2), 16));
  }
  return str;
};

//  1 | 010 | 00 | 00 | 0000 0001 | 0000 0101 0011 1011
//  flag | file type | reserved | block count | file number | block number
//
//  Block Offset = 8192 + (Block Number * Block Size)
//
//  Block Offset = 8192 + (1339 * 256) = 350 976 = 0x55B00
//  Block is located in data_1 at offset 0x55B00

const getCacheFileType = binAddr => {
  let fileType = binAddr.substr(1, 3);

  if (fileType === "0") {
    var fileNum = bin2hex(binAddr.substr(4, 28));
  }

  switch (fileType) {
    case "000":
      return {
        file_type: 0,
        cache_file: `f_${fileNum}`,
        size: 16
      };
    case "001":
      return {
        file_type: 1,
        cache_file: "data_0",
        size: 36
      };
    case "010":
      return {
        file_type: 2,
        cache_file: "data_1",
        size: 256
      };
    case "011":
      return {
        file_type: 3,
        cache_file: "data_2",
        size: 1024
      };
    case "100":
      return {
        file_type: 4,
        cache_file: "data_3",
        size: 4096
      };
  }
};

const changeEndianness = string => {
  const result = [];
  let len = string.length - 2;
  while (len >= 0) {
    result.push(string.substr(len, 2));
    len -= 2;
  }
  return result.join("");
};

const getAddressesFromTable = indexTable => {
  let cacheAddrs = [];
  for (let i = 0; i < indexTable.length; i += 8) {
    let entry = indexTable.substr(i, 8);
    if (entry !== "00000000") {
      cacheAddrs.push(changeEndianness(entry));
    }
  }
  return cacheAddrs;
};

const parseIndexHeader = buff => {
  return {
    signature: parseInt(buff.substr(0, 8), 16),
    minorVersion: parseInt(buff.substr(8, 4), 16),
    majorVersion: parseInt(buff.substr(12, 4), 16),
    numberOfEntries: parseInt(changeEndianness(buff.substr(16, 8)), 16),
    storedDataSize: parseInt(buff.substr(24, 8), 16),
    lastCreatedFileNum: changeEndianness(buff.substr(32, 8)),
    dirtyFlag: parseInt(buff.substr(40, 8), 16),
    tableSize: parseInt(changeEndianness(buff.substr(56, 8)), 16),
    creationTime: converWebkitTimestamp(
      parseInt(changeEndianness(buff.substr(80, 16)), 16)
    )
  };
};

const parseLRU = buff => {
  return {
    filledFlag: parseInt(buff.substr(16, 8), 16),
    arrOfSizes: buff.substr(24, 40),
    arrOfHeadAddr: buff.substr(64, 40),
    arrOfTailAddr: buff.substr(104, 40),
    transactionAddr: buff.substr(142, 8)
  };
};

const getBlocksFromAddr = blockAddresses => {
  const blocks = blockAddresses.map(addr => {
    const filePath = path.join(
      process.env.VOLUME_PATH,
      "/Cache/" + addr.file_type["cache_file"]
    );

    const file = fs.readFileSync(filePath);
    const buff = Buffer.from(file, "ascii");

    // Offset | Field                     | Size (bytes)
    // 0x0020 | Key Data Size(URL Length) | 4
    // 96 bytes (block header) + keyDataSize
    const keyDataSize = parseInt(
      changeEndianness(
        buff.toString("hex", addr.block_offset + 32, addr.block_offset + 36)
      ),
      16
    );
    const block = buff.toString(
      "hex",
      addr.block_offset,
      addr.block_offset + 96 + keyDataSize
    );

    return block;
  });

  return blocks;
};

const parseIndexFile = index => {
  const indexFile = fs.readFileSync(index);
  const buff = Buffer.from(indexFile, "ascii");

  const indexHeader = buff.toString("hex", 0, INDEX_HEADER_LENGTH);
  const indexLRU = buff.toString(
    "hex",
    INDEX_HEADER_LENGTH,
    INDEX_HEADER_LENGTH + LRU_LENGTH
  );

  const parsedIndexHeader = parseIndexHeader(indexHeader);
  const parsedLRU = parseLRU(indexLRU);
  console.log(parsedIndexHeader);

  //const INDEX_TABLE_LENGTH = parsedIndexHeader.tableSize;
  const INDEX_TABLE_LENGTH =
    buff.length - INDEX_HEADER_LENGTH + ZERO_PADDING_LENGTH + LRU_LENGTH;

  const indexTable = buff.toString(
    "hex",
    INDEX_HEADER_LENGTH + ZERO_PADDING_LENGTH + LRU_LENGTH,
    INDEX_HEADER_LENGTH + ZERO_PADDING_LENGTH + LRU_LENGTH + INDEX_TABLE_LENGTH
  );

  return { parsedIndexHeader, parsedLRU, indexTable };
};

const parseCacheAddresses = cacheAddresses => {
  const blockAddresses = cacheAddresses.map(addr => {
    return {
      flag: addr[0],
      file_type: getCacheFileType(addr),
      reserved: addr.substr(4, 2),
      block_count: parseInt(addr.substr(6, 2), 2),
      file_number: parseInt(addr.substr(8, 8), 2),
      block_number: parseInt(addr.substr(16, 16), 2),
      block_offset:
        8192 + parseInt(addr.substr(16, 16), 2) * getCacheFileType(addr).size
    };
  });

  return blockAddresses;
};

const converWebkitTimestamp = webkitTimestamp => {
  const dateInSeconds = Math.round(webkitTimestamp / 1000000) - 11644473600;
  return new Date(dateInSeconds * 1000);
};

const getCacheEntries = () => {
  const indexFile = path.join(process.env.VOLUME_PATH, "/Cache/" + "index");
  const { indexTable } = parseIndexFile(indexFile);
  const cacheAddresses = getAddressesFromTable(indexTable).map(addr =>
    hex2bin(addr)
  );

  const blockAddresses = parseCacheAddresses(cacheAddresses);
  const blocks = getBlocksFromAddr(blockAddresses);
  const { parsedBlocks, toBeParsedAddrs } = parseCacheBlocks(blocks);

  let nextToBeParsedAddrs = toBeParsedAddrs;

  // get next cache addresses till end of list
  while (nextToBeParsedAddrs.length > 0) {
    const nextBlockAddresses = parseCacheAddresses(nextToBeParsedAddrs);
    const nextBlocks = getBlocksFromAddr(nextBlockAddresses);
    const nextParsedBlocks = parseCacheBlocks(nextBlocks).parsedBlocks;
    parsedBlocks.push(nextParsedBlocks);
    nextToBeParsedAddrs = parseCacheBlocks(nextBlocks).toBeParsedAddrs;
  }

  return { parsedBlocks, blockAddresses };
};

const parseCacheBlocks = blocks => {
  let toBeParsedAddrs = [];

  const parsedBlocks = blocks.map(block => {
    if (parseInt(block.substr(8, 8)) !== 0) {
      toBeParsedAddrs.push(hex2bin(changeEndianness(block.substr(8, 8))));
    }

    return {
      hashNumber: block.substr(0, 8),
      nextCacheAddr: block.substr(8, 8),
      cacheEntryState: parseInt(block.substr(40, 8), 16),
      creationTime: converWebkitTimestamp(
        parseInt(changeEndianness(block.substr(48, 16)), 16)
      ),
      keyDataSize: parseInt(changeEndianness(block.substr(64, 8)), 16) * 2,
      longKeyDataAddr: block.substr(72, 8),
      dataStreamSizeArr: block.substr(80, 32),
      dataStreamCaheArr: block.substr(112, 32),
      keyData: hex_to_ascii(
        block.substr(192, parseInt(block.substr(64, 8), 16))
      ),
      rawBlock: block
    };
  });

  return { parsedBlocks, toBeParsedAddrs };
};

module.exports = {
  getCacheEntries
};
