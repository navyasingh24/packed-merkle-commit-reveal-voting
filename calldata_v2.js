const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function hashPair(a, b) { const [x,y] = BigInt(a) < BigInt(b) ? [a,b] : [b,a]; return ethers.keccak256(ethers.concat([x,y])); }
function buildLayers(leaves) {
  const layers = [leaves]; let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i=0;i<level.length;i+=2) next.push(i+1<level.length ? hashPair(level[i],level[i+1]) : level[i]);
    level = next; layers.push(level);
  }
  return layers;
}
function getProof(layers, index) {
  const proof = []; let idx = index;
  for (let l=0;l<layers.length-1;l++) {
    const level = layers[l]; const pairIdx = idx%2===0?idx+1:idx-1;
    if (pairIdx < level.length) proof.push(level[pairIdx]);
    idx = Math.floor(idx/2);
  }
  return proof;
}

const art = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled_AdvancedVotingV2.json"), "utf8"));
const iface = new ethers.Interface(art.abi);
const results = {};
for (const N of [10, 50, 100, 500, 1000]) {
  const addrs = Array.from({length:N}, (_,i) => ethers.getAddress("0x" + (i+1).toString(16).padStart(40,"0")));
  const leaves = addrs.map(a => ethers.keccak256(ethers.solidityPacked(["address"],[a])));
  const layers = buildLayers(leaves);
  const proof = getProof(layers, 0);
  const h = ethers.keccak256(ethers.toUtf8Bytes("dummy"));
  const data = iface.encodeFunctionData("commitVote", [h, proof]);
  results[N] = { proofLen: proof.length, commitVoteCalldataBytes: (data.length-2)/2 };
}
const revealCalldata = iface.encodeFunctionData("revealVote", [1, "secret-0"]);
results.revealVote_bytes = (revealCalldata.length-2)/2;
const rootCalldata = iface.encodeFunctionData("setMerkleRoot", [ethers.keccak256(ethers.toUtf8Bytes("root"))]);
results.setMerkleRoot_bytes = (rootCalldata.length-2)/2;
console.log(JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(__dirname,"calldata_v2_results.json"), JSON.stringify(results,null,2));
