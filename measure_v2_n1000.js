const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

function hashPair(a, b) {
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}
function buildLayers(leaves) {
  const layers = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    level = next; layers.push(level);
  }
  return layers;
}
function getProof(layers, index) {
  const proof = []; let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const level = layers[l];
    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (pairIdx < level.length) proof.push(level[pairIdx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

async function main() {
  const N = 1000;
  const art = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled_AdvancedVotingV2.json"), "utf8"));
  const s = ganache.provider({ wallet: { totalAccounts: N + 5, deterministic: true }, chain: { hardfork: "shanghai" }, logging: { quiet: true }, miner: { blockGasLimit: 0x1fffffffffffff } });
  const provider = new ethers.BrowserProvider(s);
  const accounts = await provider.listAccounts();
  const admin = accounts[0];
  const voters = accounts.slice(1, 1 + N);

  const leaves = voters.map(v => ethers.keccak256(ethers.solidityPacked(["address"], [v.address])));
  const layers = buildLayers(leaves);
  const root = layers[layers.length - 1][0];

  const t0 = Date.now();
  const c = await new ethers.ContractFactory(art.abi, art.bytecode, admin).deploy();
  await c.deploymentTransaction().wait();
  await (await c.connect(admin).addCandidate("A")).wait();
  const rootGas = (await (await c.connect(admin).setMerkleRoot(root)).wait()).gasUsed;
  await (await c.connect(admin).startCommitPhase(3600, 3600)).wait();

  let commitGas = 0n, proofLenSum = 0, sampleCalldataLen = 0;
  for (let i = 0; i < N; i++) {
    const h = ethers.solidityPackedKeccak256(["uint256", "string"], [1, `secret-${i}`]);
    const proof = getProof(layers, i);
    proofLenSum += proof.length;
    if (i === 500) {
      const data = c.interface.encodeFunctionData("commitVote", [h, proof]);
      sampleCalldataLen = (data.length - 2) / 2;
    }
    commitGas += (await (await c.connect(voters[i]).commitVote(h, proof)).wait()).gasUsed;
  }
  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  await (await c.connect(admin).startRevealPhase()).wait();
  let revealGas = 0n;
  for (let i = 0; i < N; i++) revealGas += (await (await c.connect(voters[i]).revealVote(1, `secret-${i}`)).wait()).gasUsed;
  const wallMs = Date.now() - t0;

  const total = Number(BigInt(rootGas) + commitGas + revealGas);
  console.log(JSON.stringify({
    N, rootGas: Number(rootGas), commitGasTotal: Number(commitGas), revealGasTotal: Number(revealGas),
    total, avgPerVoter: total / N, avgProofLen: proofLenSum / N,
    commitCalldataBytesAtProofLen: sampleCalldataLen, wallClockMs: wallMs
  }, null, 2));
  fs.writeFileSync(path.join(__dirname, "v2_n1000_result.json"), JSON.stringify({
    N, rootGas: Number(rootGas), commitGasTotal: Number(commitGas), revealGasTotal: Number(revealGas),
    total, avgPerVoter: total / N, avgProofLen: proofLenSum / N,
    commitCalldataBytesAtProofLen: sampleCalldataLen, wallClockMs: wallMs
  }, null, 2));
  await s.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
