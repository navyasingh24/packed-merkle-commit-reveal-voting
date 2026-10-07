const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

// ---------------------------------------------------------------------------
// Wall-clock latency: how long the local EVM takes to PROCESS N votes under each
// scheme, all measured by this script, in the same process, on the same machine
// (nothing is hard-coded). Absolute milliseconds depend on your hardware; the
// RELATIVE ordering between schemes is the meaningful result.
//
// Usage:  node latency_scale.js [all|cr|ec|mix]     (default: all)
//   cr  : Commit-Reveal, N = 10,50,100,500,1000 (full lifecycle)
//   ec  : Ring (n=20) N = 10,50,100 ; ZKP (2 public inputs) N = 10
//   mix : Mixnet single round, n = 10,50,100,500 ciphertexts
// ECC precompiles are emulated in pure JS by Ganache, so pairing checks are
// slow (~4s each); the ZKP/ring grids are kept small for that reason.
// ---------------------------------------------------------------------------

const PART = (process.argv[2] || "all").toLowerCase();
const OUT = path.join(__dirname, "latency_results.json");

function server(n) {
  return ganache.provider({
    wallet: { totalAccounts: n, deterministic: true },
    chain: { hardfork: "shanghai" },
    logging: { quiet: true },
    miner: { blockGasLimit: 0x1fffffffffffff }
  });
}

async function timeCommitReveal(N, abi, bytecode) {
  const s = server(N + 5);
  const provider = new ethers.BrowserProvider(s);
  const accounts = await provider.listAccounts();
  const admin = accounts[0];
  const voters = accounts.slice(1, 1 + N);
  const c = await new ethers.ContractFactory(abi, bytecode, admin).deploy();
  await c.deploymentTransaction().wait();

  const t0 = Date.now();
  await (await c.connect(admin).addCandidate("A")).wait();
  for (const v of voters) await (await c.connect(admin).registerVoter(v.address)).wait();
  await (await c.connect(admin).startCommitPhase(3600, 3600)).wait();
  for (let i = 0; i < N; i++) {
    const h = ethers.solidityPackedKeccak256(["uint256", "string"], [1, `secret-${i}`]);
    await (await c.connect(voters[i]).commitVote(h)).wait();
  }
  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  await (await c.connect(admin).startRevealPhase()).wait();
  for (let i = 0; i < N; i++) await (await c.connect(voters[i]).revealVote(1, `secret-${i}`)).wait();
  const ms = Date.now() - t0;
  await s.disconnect();
  return ms;
}

async function timeRepeated(N, fn, args, abi, bytecode) {
  const s = server(5);
  const provider = new ethers.BrowserProvider(s);
  const admin = (await provider.listAccounts())[0];
  const c = await new ethers.ContractFactory(abi, bytecode, admin).deploy();
  await c.deploymentTransaction().wait();
  const t0 = Date.now();
  for (let i = 0; i < N; i++) await (await c[fn](...args)).wait();
  const ms = Date.now() - t0;
  await s.disconnect();
  return ms;
}

async function main() {
  const votingArt = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled.json"), "utf8"));
  const benchArt = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled_bench.json"), "utf8"));
  const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

  if (PART === "all" || PART === "cr") {
    results.commitReveal_ms = {};
    for (const N of [10, 50, 100, 500, 1000]) {
      const ms = await timeCommitReveal(N, votingArt.abi, votingArt.bytecode);
      results.commitReveal_ms[N] = ms; save();
      console.log(`Commit-Reveal  N=${N}: ${ms} ms`);
    }
  }
  if (PART === "all" || PART === "ec") {
    results.ringVerify_n20_ms = {};
    for (const N of [10, 50, 100]) {
      const ms = await timeRepeated(N, "ringVerify", [20], benchArt.abi, benchArt.bytecode);
      results.ringVerify_n20_ms[N] = ms; save();
      console.log(`Ring (n=20)    x${N}: ${ms} ms`);
    }
    results.zkpVerify_l2_ms = {};
    for (const N of [10]) {
      const ms = await timeRepeated(N, "zkpVerify", [2], benchArt.abi, benchArt.bytecode);
      results.zkpVerify_l2_ms[N] = ms; save();
      console.log(`ZKP (l=2)      x${N}: ${ms} ms`);
    }
  }
  if (PART === "all" || PART === "mix") {
    results.mixnetRound_ms = {};
    for (const n of [10, 50, 100, 500]) {
      const ms = await timeRepeated(1, "mixnetRound", [n], benchArt.abi, benchArt.bytecode);
      results.mixnetRound_ms[n] = ms; save();
      console.log(`Mixnet round   n=${n}: ${ms} ms`);
    }
  }
  console.log("\nSaved latency_results.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
