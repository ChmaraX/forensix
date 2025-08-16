const Promise = require("bluebird");
const fs = Promise.promisifyAll(require("fs"));
const path = require("path");
const anyBase = require("any-base");
const hex2bin = anyBase(anyBase.HEX, anyBase.BIN);
const bin2hex = anyBase(anyBase.BIN, anyBase.HEX);
const zlib = require("zlib");

const INDEX_HEADER_LENGTH = 256 * 2;
const LRU_LENGTH = 112 * 2;
const ZERO_PADDING_LENGTH = 208 * 2;

const hex_to_ascii = (hexString) => {
  var output = Buffer.from(hexString, "hex");
  return output.toString("ascii");
};

//  1 | 010 | 00 | 00 | 0000 0001 | 0000 0101 0011 1011
//  flag | file type | reserved | block count | file number | block number
//
//  Block Offset = 8192 + (Block Number * Block Size)
//
//  Block Offset = 8192 + (1339 * 256) = 350 976 = 0x55B00
//  Block is located in data_1 at offset 0x55B00

const getCacheFileType = (binAddr) => {
  let fileType = binAddr.substr(1, 3);

  if (fileType === "000") {
    var fileNum = bin2hex(binAddr.substr(4, 28));

    while (fileNum.length !== 6) {
      fileNum = "0" + fileNum;
    }
  }

  switch (fileType) {
    case "000":
      return {
        file_type: 0,
        cache_file: `f_${fileNum}`,
        size: 16,
      };
    case "001":
      return {
        file_type: 1,
        cache_file: "data_0",
        size: 36,
      };
    case "010":
      return {
        file_type: 2,
        cache_file: "data_1",
        size: 256,
      };
    case "011":
      return {
        file_type: 3,
        cache_file: "data_2",
        size: 1024,
      };
    case "100":
      return {
        file_type: 4,
        cache_file: "data_3",
        size: 4096,
      };
  }
};

const changeEndianness = (string) => {
  const result = [];
  let len = string.length - 2;
  while (len >= 0) {
    result.push(string.substr(len, 2));
    len -= 2;
  }
  return result.join("");
};

const getAddressesFromTable = (indexTable) => {
  let cacheAddrs = [];
  for (let i = 0; i < indexTable.length; i += 8) {
    let entry = indexTable.substr(i, 8);
    if (entry !== "00000000") {
      cacheAddrs.push(changeEndianness(entry));
    }
  }
  return cacheAddrs;
};

const parseIndexHeader = (buff) => {
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
    ),
  };
};

const parseLRU = (buff) => {
  return {
    filledFlag: parseInt(buff.substr(16, 8), 16),
    arrOfSizes: buff.substr(24, 40),
    arrOfHeadAddr: buff.substr(64, 40),
    arrOfTailAddr: buff.substr(104, 40),
    transactionAddr: buff.substr(142, 8),
  };
};

const getBlocksFromAddr = (blockAddresses) => {
  const blocks = blockAddresses.map((addr) => {
    // Try multiple cache directories (prioritize working formats)
    const cacheDirs = [
      "/Cache/",                          // Original Chrome cache
      "/Application Cache/Cache/",        // Alternative Chrome cache
      "/GPUCache/",                       // GPU cache
      "/DawnWebGPUCache/",                // Dawn WebGPU cache
      "/DawnGraphiteCache/",              // Dawn Graphite cache
    ];

    let filePath = null;
    for (const dir of cacheDirs) {
      const testPath = path.join(process.env.VOLUME_PATH, dir + addr.file_type["cache_file"]);
      if (fs.existsSync(testPath)) {
        filePath = testPath;
        break;
      }
    }

    if (!filePath) {
      console.log(`Cache file not found: ${addr.file_type["cache_file"]}`);
      return ""; // Return empty block
    }

    try {
      const file = fs.readFileSync(filePath);
      const buff = Buffer.from(file, "ascii");

      const block = buff.toString(
        "hex",
        addr.block_offset,
        addr.block_offset + addr.file_type.size
      );

      return block;
    } catch (error) {
      console.log(`Error reading cache file: ${error.message}`);
      return ""; // Return empty block on error
    }
  });

  return blocks.filter(block => block !== ""); // Filter out empty blocks
};

const gunzip = (block) => {
  let decompressedBlock = zlib.gunzipSync(Buffer.from(block, "hex"));
  return decompressedBlock.toString("hex");
};

const brunzip = (block) => {
  let decompressedBlock = zlib.brotliDecompressSync(Buffer.from(block, "hex"));
  return decompressedBlock.toString("hex");
};

const decompress = (block) => {
  const GZIP_SIGN = "1f8b08";
  const BR_ENCODING = "f158";

  if (block.startsWith(GZIP_SIGN)) {
    return gunzip(block)
  }
  if (block.startsWith(BR_ENCODING)) {
    return brunzip(block)
  }
  return block
}

const getPayloadBlock = (blockAddresses, size) => {
  const blocks = blockAddresses.map((addr) => {
    // Try multiple cache directories (prioritize working formats)
    const cacheDirs = [
      "/Cache/",                          // Original Chrome cache
      "/Application Cache/Cache/",        // Alternative Chrome cache
      "/GPUCache/",                       // GPU cache
      "/DawnWebGPUCache/",                // Dawn WebGPU cache
      "/DawnGraphiteCache/",              // Dawn Graphite cache
    ];

    let filePath = null;
    for (const dir of cacheDirs) {
      const testPath = path.join(process.env.VOLUME_PATH, dir + addr.file_type["cache_file"]);
      if (fs.existsSync(testPath)) {
        filePath = testPath;
        break;
      }
    }

    if (!filePath) {
      console.log(`Payload cache file not found: ${addr.file_type["cache_file"]}`);
      return ""; // Return empty payload
    }

    try {
      const file = fs.readFileSync(filePath);
      const buff = Buffer.from(file);

      const block = buff.toString(
        "hex",
        addr.file_type.file_type === 0 ? 0 : addr.block_offset,
        addr.file_type.file_type === 0 ? parseInt(size) : addr.block_offset + parseInt(size)
      );

      const PNG_SIGN = "89504e470d0a1a0a";
      const JPEG_SIGN = "ffd8ff";
      const decompressedBlock = decompress(block);

      if (decompressedBlock.startsWith(PNG_SIGN) || decompressedBlock.startsWith(JPEG_SIGN)) {
        return Buffer.from(decompressedBlock, "hex").toString('base64')
      } else {
        return Buffer(decompressedBlock, "hex").toString('utf8')
      }
    } catch (error) {
      console.log(`Error reading payload cache file: ${error.message}`);
      return ""; // Return empty payload on error
    }
  });

  return blocks.filter(block => block !== ""); // Filter out empty blocks
};

const parseIndexFile = (index) => {
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

const parseCacheAddresses = (cacheAddresses) => {
  const blockAddresses = cacheAddresses.map((addr) => {
    return {
      flag: addr[0],
      file_type: getCacheFileType(addr),
      reserved: addr.substr(4, 2),
      block_count: parseInt(addr.substr(6, 2), 2),
      file_number: parseInt(addr.substr(8, 8), 2),
      block_number: parseInt(addr.substr(16, 16), 2),
      block_offset:
        8192 + parseInt(addr.substr(16, 16), 2) * getCacheFileType(addr).size,
    };
  });

  return blockAddresses;
};

const converWebkitTimestamp = (webkitTimestamp) => {
  const dateInSeconds = Math.round(webkitTimestamp / 1000000) - 11644473600;
  return new Date(dateInSeconds * 1000).toLocaleDateString();
};

const getCacheEntries = (from = 0) => {
  // Try multiple cache locations in the data directory (prioritize working formats)
  const cacheLocations = [
    path.join(process.env.VOLUME_PATH, "/Cache/index"),                    // Original Chrome cache
    path.join(process.env.VOLUME_PATH, "/Application Cache/Cache/index"),  // Alternative Chrome cache
    path.join(process.env.VOLUME_PATH, "/GPUCache/index"),                 // GPU cache (classic format)
    path.join(process.env.VOLUME_PATH, "/DawnWebGPUCache/index"),          // Dawn WebGPU cache (classic format)
    path.join(process.env.VOLUME_PATH, "/DawnGraphiteCache/index"),        // Dawn Graphite cache (classic format)
  ];

  let indexFile = null;
  let cacheType = "unknown";

  // Find the first existing cache with proper format
  for (const location of cacheLocations) {
    if (fs.existsSync(location)) {
      // Check if it's a valid classic cache format
      try {
        const indexContent = fs.readFileSync(location);
        if (indexContent.length > 100) {
          const signature = indexContent.slice(0, 4).toString('hex');
          if (signature === 'c103cac3' || signature === 'c3ca03c1') {
            indexFile = location;
            if (location.includes("GPUCache")) cacheType = "GPU Cache";
            else if (location.includes("DawnWebGPUCache")) cacheType = "Dawn WebGPU Cache";
            else if (location.includes("DawnGraphiteCache")) cacheType = "Dawn Graphite Cache";
            else if (location.includes("Application Cache")) cacheType = "Application Cache";
            else cacheType = "Default Cache";
            
            console.log(`Found ${cacheType} at: ${location}`);
            break;
          }
        }
      } catch (error) {
        console.log(`Skipping invalid cache at ${location}: ${error.message}`);
      }
    }
  }

  // If no valid cache found, return empty data with helpful message
  if (!indexFile) {
    console.log("No valid cache index file found.");
    console.log("Modern browsers use a new cache format that ForensiX doesn't support yet.");
    console.log("ForensiX can analyze:");
    console.log("  ✅ Classic Chrome/Chromium cache (data_0, data_1, etc. + index)");
    console.log("  ✅ GPU cache (for graphics-related content)");
    console.log("  ❌ Modern HTTP cache (Cache_Data format) - not supported");
    console.log("");
    console.log("Available cache data in your data directory:");
    
    // Show what cache data is available - WITH PROPER ERROR HANDLING
    try {
      const cacheDataPath = path.join(process.env.VOLUME_PATH, "/Cache_Data");
      const gpuCachePath = path.join(process.env.VOLUME_PATH, "/GPUCache");
      
      if (fs.existsSync(cacheDataPath)) {
        try {
          // Use a safer approach to count files without opening all at once
          const stats = fs.statSync(cacheDataPath);
          if (stats.isDirectory()) {
            console.log(`  📁 Cache_Data: directory exists (modern format - not supported)`);
          }
        } catch (err) {
          console.log(`  📁 Cache_Data: exists but cannot read (${err.message})`);
        }
      }
      
      if (fs.existsSync(gpuCachePath)) {
        try {
          const files = fs.readdirSync(gpuCachePath);
          console.log(`  📁 GPUCache: ${files.length} files (classic format - supported)`);
        } catch (err) {
          console.log(`  📁 GPUCache: exists but cannot read (${err.message})`);
        }
      }
    } catch (error) {
      console.log(`Error checking cache directories: ${error.message}`);
    }
    
    return { parsedBlocks: [], totalCount: 0 };
  }

  // Continue with existing logic for valid cache files...
  const { indexTable } = parseIndexFile(indexFile);

  // index => index table => hex addrs => bin addrs
  const cacheAddresses = getAddressesFromTable(indexTable).map((addr) =>
    hex2bin(addr)
  );

  console.log(`Found ${cacheAddresses.length} cache addresses`);

  // bin addr => parsed block addr (filename, offset)
  const blockAddresses = parseCacheAddresses(cacheAddresses).slice(
    +from,
    +from + 20
  );

  // filename + offset => block chunk
  const blocks = getBlocksFromAddr(blockAddresses);

  // block chunk => parsed block
  let { parsedBlocks, toBeParsedAddrs } = parseCacheBlocks(blocks);

  let nextToBeParsedAddrs = toBeParsedAddrs;

  // get next cache addresses till end of list
  while (nextToBeParsedAddrs.length > 0) {
    const nextBlockAddresses = parseCacheAddresses(nextToBeParsedAddrs);
    const nextBlocks = getBlocksFromAddr(nextBlockAddresses);
    const nextParsedBlocks = parseCacheBlocks(nextBlocks).parsedBlocks;
    parsedBlocks.push(...nextParsedBlocks);
    nextToBeParsedAddrs = parseCacheBlocks(nextBlocks).toBeParsedAddrs;
  }

  return {parsedBlocks, totalCount: cacheAddresses.length};
};

const getRankings = (rankingsAddr) => {
  if (rankingsAddr) {
    let binAddr = hex2bin(rankingsAddr);
    let rankingAddressesParsed = parseCacheAddresses([binAddr]);
    let rankingBlock = getBlocksFromAddr(rankingAddressesParsed)[0];

    return {
      lastUsed: converWebkitTimestamp(
        parseInt(changeEndianness(rankingBlock.substr(0, 16)), 16)
      ),
      lastModified: converWebkitTimestamp(
        parseInt(changeEndianness(rankingBlock.substr(16, 16)), 16)
      ),
    };
  }
};

const getHTTPHeader = (headerAddr) => {
  if (parseInt(headerAddr, 16) !== 0) {
    let parsedHTTPAddr = parseCacheAddresses([hex2bin(headerAddr)]);
    let httpBlock = getBlocksFromAddr(parsedHTTPAddr);

    return httpBlock[0];
  }
};

const parseCacheEntryState = (state) => {
  switch (state) {
    case 0:
      return "ENTRY_NORMAL";
    case 1:
      return "ENTRY_EVICTED";
    case 2:
      return "ENTRY_DOOMED";
  }
};

const parseCacheEntryFlag = (flag) => {
  switch (flag) {
    case 1:
      return "PARENT_ENTRY";
    case 2:
      return "CHILD_ENTRY";
  }
};

const parseHttpHeader = (httpHeader) => {
  // e.g.: (C|content-T|type:(<space>|<nospace>)image/jpeg)
  let contentTypeRegExp = /(([A-Z]|[a-z])ontent-([A-Z]|[a-z])ype:)[ ]?([a-z]+\/[a-z]+)/g;
  // e.g.: (C|content-L|length:(<space>|<nospace>)[0-9]+)
  let contentLengthRegExp = /(([A-Z]|[a-z])ontent-([A-Z]|[a-z])ength:)[ ]?([0-9]+)/g;

  var contentTypeMatch = hex_to_ascii(httpHeader)
    .toString()
    .match(contentTypeRegExp);

  var contentLengthMatch = hex_to_ascii(httpHeader)
    .toString()
    .match(contentLengthRegExp);

  var contentType = contentTypeMatch
    ? contentTypeMatch[0].split(":")[1]
    : "unknown";

  var contentLength = contentLengthMatch
    ? contentLengthMatch[0].split(":")[1]
    : "unknown";

  return { contentType, contentLength };
};

const parseCacheBlocks = (blocks) => {
  let toBeParsedAddrs = [];

  const parsedBlocks = blocks.map((block) => {
    // if there is next cache addr to be parsed
    if (parseInt(block.substr(8, 8)) !== 0) {
      toBeParsedAddrs.push(hex2bin(changeEndianness(block.substr(8, 8))));
    }

    var dataStreamCacheArr = block
      .substr(112, 32)
      .match(/.{1,8}/g)
      .map((a) => changeEndianness(a));

    // parse header
    let httpHeader = getHTTPHeader(dataStreamCacheArr[0]);
    if (httpHeader) {
      var { contentType, contentLength } = parseHttpHeader(httpHeader);
    }

    // get and parse payload
    if (parseInt(dataStreamCacheArr[1], 16) !== 0) {
      let parsedPayloadAddr = parseCacheAddresses([
        hex2bin(dataStreamCacheArr[1]),
      ]);
      var payloadBlock = getPayloadBlock(parsedPayloadAddr, contentLength);
    }

    return {
      hashNumber: block.substr(0, 8),
      reuseCount: parseInt(changeEndianness(block.substr(24, 8)), 16),
      rankings: getRankings(changeEndianness(block.substr(16, 8))),
      refetchCount: parseInt(changeEndianness(block.substr(32, 8)), 16),
      cacheEntryState: parseCacheEntryState(
        parseInt(changeEndianness(block.substr(40, 8)), 16)
      ),
      creationTime: converWebkitTimestamp(
        parseInt(changeEndianness(block.substr(48, 16)), 16)
      ),
      keyDataSize: parseInt(changeEndianness(block.substr(64, 8)), 16) * 2,
      longKeyDataAddr: changeEndianness(block.substr(72, 8)),
      keyData: hex_to_ascii(
        block.substr(192, parseInt(block.substr(64, 8), 16))
      ).replace(/\0/g, ""),
      contentType: contentType,
      contentLength: contentLength,
      payload: payloadBlock ? payloadBlock[0] : "",
    };
  });

  return { parsedBlocks, toBeParsedAddrs };
};

module.exports = {
  getCacheEntries,
};
