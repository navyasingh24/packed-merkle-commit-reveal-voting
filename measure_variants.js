const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

// ---- Standard sorted-pair Merkle tree (OpenZeppelin-style), matching V2's
// on-chain _verify. Leaves = keccak256(abi.encodePacked(address)).
function hashPair(a, b) {
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}
function buildLayers(leaves) {
  const layers = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    }
    level = next;
    layers.push(level);
  }
  return layers;
}
function getProof(layers, index) {
  const proof = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const level = layers[l];
    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (pairIdx < level.length) proof.push(level[pairIdx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

function server(n) {
  return ganache.provider({
    wallet: { totalAccounts: n, deterministic: true },
    chain: { hardfork: "shanghai" },
    logging: { quiet: true },
    miner: { blockGasLimit: 0x1fffffffffffff }
  });
}

async function runBaseline(N) {
  const art = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled.json"), "utf8"));
  const s = server(N + 5);
  const provider = new ethers.BrowserProvider(s);
  const accounts = await provider.listAccounts();
  const admin = accounts[0];
  const voters = accounts.slice(1, 1 + N);
  const c = await new ethers.ContractFactory(art.abi, art.bytecode, admin).deploy();
  await c.deploymentTransaction().wait();
  await (await c.connect(admin).addCandidate("A")).wait();

  let regGas = 0n;
  for (const v of voters) regGas += (await (await c.connect(admin).registerVoter(v.address)).wait()).gasUsed;

  await (await c.connect(admin).startCommitPhase(3600, 3600)).wait();
  let commitGas = 0n;
  for (let i = 0; i < N; i++) {
    const h = ethers.solidityPackedKeccak256(["uint256", "string"], [1, `secret-${i}`]);
    commitGas += (await (await c.connect(voters[i]).commitVote(h)).wait()).gasUsed;
  }
  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  await (await c.connect(admin).startRevealPhase()).wait();
  let revealGas = 0n;
  for (let i = 0; i < N; i++) {
    revealGas += (await (await c.connect(voters[i]).revealVote(1, `secret-${i}`)).wait()).gasUsed;
  }
  await s.disconnect();
  return { regGas: Number(regGas), commitGas: Number(commitGas), revealGas: Number(revealGas),
           total: Number(regGas + commitGas + revealGas) };
}

async function runV1(N, batchRegister) {
  const art = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled_AdvancedVotingV1.json"), "utf8"));
  const s = server(N + 5);
  const provider = new ethers.BrowserProvider(s);
  const accounts = await provider.listAccounts();
  const admin = accounts[0];
  const voters = accounts.slice(1, 1 + N);
  const c = await new ethers.ContractFactory(art.abi, art.bytecode, admin).deploy();
  await c.deploymentTransaction().wait();
  await (await c.connect(admin).addCandidate("A")).wait();

  let regGas = 0n;
  if (batchRegister) {
    const addrs = voters.map(v => v.address);
    regGas = (await (await c.connect(admin).registerVoters(addrs)).wait()).gasUsed;
  } else {
    for (const v of voters) regGas += (await (await c.connect(admin).registerVoter(v.address)).wait()).gasUsed;
  }

  await (await c.connect(admin).startCommitPhase(3600, 3600)).wait();
  let commitGas = 0n;
  for (let i = 0; i < N; i++) {
    const h = ethers.solidityPackedKeccak256(["uint256", "string"], [1, `secret-${i}`]);
    commitGas += (await (await c.connect(voters[i]).commitVote(h)).wait()).gasUsed;
  }
  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  await (await c.connect(admin).startRevealPhase()).wait();
  let revealGas = 0n;
  for (let i = 0; i < N; i++) {
    revealGas += (await (await c.connect(voters[i]).revealVote(1, `secret-${i}`)).wait()).gasUsed;
  }
  await s.disconnect();
  return { regGas: Number(regGas), commitGas: Number(commitGas), revealGas: Number(revealGas),
           total: Number(regGas + commitGas + revealGas), batched: !!batchRegister };
}

async function runV2(N) {
  const art = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled_AdvancedVotingV2.json"), "utf8"));
  const s = server(N + 5);
  const provider = new ethers.BrowserProvider(s);
  const accounts = await provider.listAccounts();
  const admin = accounts[0];
  const voters = accounts.slice(1, 1 + N);

  const leaves = voters.map(v => ethers.keccak256(ethers.solidityPacked(["address"], [v.address])));
  const layers = buildLayers(leaves);
  const root = layers[layers.length - 1][0];

  const c = await new ethers.ContractFactory(art.abi, art.bytecode, admin).deploy();
  await c.deploymentTransaction().wait();
  await (await c.connect(admin).addCandidate("A")).wait();

  const rootGas = (await (await c.connect(admin).setMerkleRoot(root)).wait()).gasUsed;

  await (await c.connect(admin).startCommitPhase(3600, 3600)).wait();
  let commitGas = 0n;
  let proofLenSum = 0;
  for (let i = 0; i < N; i++) {
    const h = ethers.solidityPackedKeccak256(["uint256", "string"], [1, `secret-${i}`]);
    const proof = getProof(layers, i);
    proofLenSum += proof.length;
    commitGas += (await (await c.connect(voters[i]).commitVote(h, proof)).wait()).gasUsed;
  }
  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  await (await c.connect(admin).startRevealPhase()).wait();
  let revealGas = 0n;
  for (let i = 0; i < N; i++) {
    revealGas += (await (await c.connect(voters[i]).revealVote(1, `secret-${i}`)).wait()).gasUsed;
  }
  await s.disconnect();
  return { regGas: Number(rootGas), commitGas: Number(commitGas), revealGas: Number(revealGas),
           total: Number(BigInt(rootGas) + commitGas + revealGas), avgProofLen: proofLenSum / N };
}

async function main() {
  const results = {};
  for (const N of [10, 50, 100, 500]) {
    console.log(`\n=== N=${N} ===`);
    const base = await runBaseline(N);
    console.log("baseline      :", base);
    const v1single = await runV1(N, false);
    console.log("V1 (single reg):", v1single);
    const v1batch = await runV1(N, true);
    console.log("V1 (batch reg) :", v1batch);
    const v2 = await runV2(N);
    console.log("V2 (Merkle)    :", v2);
    results[N] = { baseline: base, v1_single: v1single, v1_batch: v1batch, v2 };
  }
  fs.writeFileSync(path.join(__dirname, "variant_results.json"), JSON.stringify(results, null, 2));
  console.log("\nSaved variant_results.json");
}
main().catch(e => { console.error(e); process.exit(1); });
