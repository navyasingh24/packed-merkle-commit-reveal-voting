// Packs every result file and the generated figures into finalResults_bc.zip, so the results of a
// run can be shared and checked against the paper. Regenerates figures/ from the current results
// first. Creates nothing else and changes no result file.
// No extra dependencies (uses Node's built-in zlib). Run LAST:   npm run results-zip
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const os = require("os");

const ROOT = __dirname;
const ZIP_NAME = "finalResults_bc";
const OUT = path.join(ROOT, `${ZIP_NAME}.zip`);

console.log("Regenerating figures/ from the current result files...");
try {
  require("./make_figures.js");
} catch (e) {
  console.log("make_figures.js failed: " + e.message + " (continuing with the result files only)");
}

// Every result file the measurement commands create, and the command that creates it.
const resultFiles = {
  "candidate_results.json": "npm run candidate",
  "variant_results.json": "npm run measure-variants",
  "v2_n1000_result.json": "npm run v2-n1000",
  "gas_scale_results.json": "npm run scale",
  "ablation_results.json": "npm run ablation",
  "precompile_bench_results.json": "npm run bench",
  "calldata_size_results.json": "npm run calldata",
  "calldata_v2_results.json": "npm run calldata-v2",
  "test_results.json": "npm run test-security",
  "latency_v2_results.json": "npm run latency-v2",
  "latency_results.json": "npm run latency (or latency-cr / latency-ec / latency-mix)",
  "gas_results.json": "npm run measure (optional, not used in the paper)",
};

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const entries = [];
const included = [];
const missing = [];

for (const [f, cmd] of Object.entries(resultFiles)) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) {
    const data = fs.readFileSync(p);
    entries.push({ name: `${ZIP_NAME}/${f}`, data });
    included.push({ file: f, bytes: data.length, sha256: sha256(data), modified: fs.statSync(p).mtime.toISOString() });
  } else {
    missing.push({ file: f, createdBy: cmd });
  }
}

const figDir = path.join(ROOT, "figures");
if (fs.existsSync(figDir)) {
  for (const f of fs.readdirSync(figDir).sort()) {
    const p = path.join(figDir, f);
    if (!fs.statSync(p).isFile()) continue;
    const data = fs.readFileSync(p);
    entries.push({ name: `${ZIP_NAME}/figures/${f}`, data });
    included.push({ file: `figures/${f}`, bytes: data.length, sha256: sha256(data) });
  }
}

// Environment and exact compiled bytecode, so results can be matched to the code that produced them.
const ver = (pkg) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", pkg, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
};
const bytecodeHashes = {};
for (const f of fs.readdirSync(ROOT).filter((x) => /^compiled.*\.json$/.test(x)).sort()) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
    bytecodeHashes[f] = j.bytecode ? sha256(Buffer.from(String(j.bytecode))) : "no bytecode field";
  } catch {
    bytecodeHashes[f] = "unreadable";
  }
}
const contractHashes = {};
const cDir = path.join(ROOT, "contracts");
if (fs.existsSync(cDir)) {
  for (const f of fs.readdirSync(cDir).filter((x) => x.endsWith(".sol")).sort()) {
    contractHashes[f] = sha256(fs.readFileSync(path.join(cDir, f)));
  }
}
const cpus = os.cpus() || [];
const manifest = {
  createdAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: (cpus[0] || {}).model || null,
    cpuCount: cpus.length,
    totalMemoryGB: +(os.totalmem() / 2 ** 30).toFixed(1),
  },
  packages: { solc: ver("solc"), ganache: ver("ganache"), ethers: ver("ethers") },
  contractSourceSha256: contractHashes,
  compiledBytecodeSha256: bytecodeHashes,
  included,
  missing,
};
entries.push({ name: `${ZIP_NAME}/manifest.json`, data: Buffer.from(JSON.stringify(manifest, null, 2)) });

// Minimal ZIP writer (deflate), readable by macOS Finder, Windows Explorer and `unzip`.
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const d = new Date();
const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

const parts = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name, "utf8");
  const comp = zlib.deflateRawSync(e.data);
  const crc = crc32(e.data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6); // UTF-8 names
  lh.writeUInt16LE(8, 8); // deflate
  lh.writeUInt16LE(dosTime, 10);
  lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(e.data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(0, 28);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(dosTime, 12);
  ch.writeUInt16LE(dosDate, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(e.data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(offset, 42);
  parts.push(lh, name, comp);
  central.push(ch, name);
  offset += 30 + name.length + comp.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
fs.writeFileSync(OUT, Buffer.concat([...parts, cd, end]));

const nResults = included.filter((x) => !x.file.startsWith("figures/")).length;
const nFigs = included.length - nResults;
console.log(`\nCreated ${ZIP_NAME}.zip: ${nResults} result files, ${nFigs} figure files, manifest.json`);
if (missing.length) {
  console.log("Not included (these commands have not been run yet):");
  missing.forEach((m) => console.log(`  - ${m.file}  ->  ${m.createdBy}`));
} else {
  console.log("All result files included.");
}
console.log(`Send this file: ${OUT}`);
