// Compiles the 2x2-ablation cell AdvancedVotingV3 (unpacked state + Merkle eligibility).
// New file; does not modify compile.js / compile_variants.js.
const fs = require("fs"), path = require("path"), solc = require("solc");
const name = "AdvancedVotingV3";
const src = fs.readFileSync(path.join(__dirname, "contracts", `${name}.sol`), "utf8");
const input = { language: "Solidity", sources: { [`${name}.sol`]: { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors) { out.errors.forEach(e => console.log(e.formattedMessage)); if (out.errors.some(e => e.severity === "error")) process.exit(1); }
const c = out.contracts[`${name}.sol`][name];
fs.writeFileSync(path.join(__dirname, `compiled_${name}.json`), JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
console.log(`Compiled ${name} OK. solc version: ${solc.version()}`);
