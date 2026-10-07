const fs = require("fs");
const path = require("path");
const solc = require("solc");

const source = fs.readFileSync(path.join(__dirname, "contracts", "PrecompileBench.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "PrecompileBench.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  const fatal = output.errors.filter(e => e.severity === "error");
  output.errors.forEach(e => console.log(e.formattedMessage));
  if (fatal.length) process.exit(1);
}
const contract = output.contracts["PrecompileBench.sol"]["PrecompileBench"];
fs.writeFileSync(
  path.join(__dirname, "compiled_bench.json"),
  JSON.stringify({ abi: contract.abi, bytecode: "0x" + contract.evm.bytecode.object }, null, 2)
);
console.log("Compiled PrecompileBench OK. solc version:", solc.version());
