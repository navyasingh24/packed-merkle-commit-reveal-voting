const fs = require("fs");
const path = require("path");
const solc = require("solc");

function compile(name) {
  const source = fs.readFileSync(path.join(__dirname, "contracts", `${name}.sol`), "utf8");
  const input = {
    language: "Solidity",
    sources: { [`${name}.sol`]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    const fatal = output.errors.filter(e => e.severity === "error");
    output.errors.forEach(e => console.log(e.formattedMessage));
    if (fatal.length) process.exit(1);
  }
  const c = output.contracts[`${name}.sol`][name];
  fs.writeFileSync(path.join(__dirname, `compiled_${name}.json`), JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
  console.log(`Compiled ${name} OK.`);
}
compile("AdvancedVotingV1");
compile("AdvancedVotingV2");
console.log("solc version:", solc.version());
