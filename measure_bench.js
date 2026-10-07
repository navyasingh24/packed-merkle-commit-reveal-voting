const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

async function freshContract(abi, bytecode, admin) {
  const factory = new ethers.ContractFactory(abi, bytecode, admin);
  const contract = await factory.deploy();
  await contract.deploymentTransaction().wait();
  return contract;
}

async function main() {
  const { abi, bytecode } = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled_bench.json"), "utf8"));

  const server = ganache.provider({
    wallet: { totalAccounts: 5 },
    chain: { hardfork: "shanghai" },
    logging: { quiet: true }
  });
  const provider = new ethers.BrowserProvider(server);
  const accounts = await provider.listAccounts();
  const admin = accounts[0];

  const results = {};

  // ---- Ring signature verification, various ring sizes (fresh contract each time) ----
  results.ringVerify = {};
  for (const n of [2, 5, 10, 15, 20, 25, 30]) {
    const c = await freshContract(abi, bytecode, admin);
    const tx = await c.ringVerify(n);
    const r = await tx.wait();
    results.ringVerify[n] = Number(r.gasUsed);
    console.log(`ringVerify(n=${n}): ${r.gasUsed.toString()} gas`);
  }

  // ---- Stability: independent voters each with a FRESH contract, same ring size ----
  results.stabilityCheck = { ringVerify_n10_x5_freshEach: [], zkpVerify_l2_x5_freshEach: [] };
  for (let i = 0; i < 5; i++) {
    const c = await freshContract(abi, bytecode, admin);
    const tx = await c.ringVerify(10);
    const r = await tx.wait();
    results.stabilityCheck.ringVerify_n10_x5_freshEach.push(Number(r.gasUsed));
  }
  console.log("Stability (ring n=10, fresh contract x5):", results.stabilityCheck.ringVerify_n10_x5_freshEach);

  // ---- ZKP (Groth16-style) verification, various public-input counts ----
  results.zkpVerify = {};
  for (const l of [1, 2, 5]) {
    const c = await freshContract(abi, bytecode, admin);
    const tx = await c.zkpVerify(l);
    const r = await tx.wait();
    results.zkpVerify[l] = Number(r.gasUsed);
    console.log(`zkpVerify(publicInputs=${l}): ${r.gasUsed.toString()} gas`);
  }
  for (let i = 0; i < 5; i++) {
    const c = await freshContract(abi, bytecode, admin);
    const tx = await c.zkpVerify(2);
    const r = await tx.wait();
    results.stabilityCheck.zkpVerify_l2_x5_freshEach.push(Number(r.gasUsed));
  }
  console.log("Stability (zkp l=2, fresh contract x5):", results.stabilityCheck.zkpVerify_l2_x5_freshEach);

  // ---- Mixnet round, various ciphertext batch sizes (fresh contract each time -> genuinely cold writes) ----
  results.mixnetRound = {};
  for (const n of [10, 50, 100, 500, 1000]) {
    try {
      const c = await freshContract(abi, bytecode, admin);
      const tx = await c.mixnetRound(n);
      const r = await tx.wait();
      results.mixnetRound[n] = Number(r.gasUsed);
      console.log(`mixnetRound(nCiphertexts=${n}): ${r.gasUsed.toString()} gas`);
    } catch (e) {
      results.mixnetRound[n] = "EXCEEDS_BLOCK_GAS_LIMIT";
      console.log(`mixnetRound(nCiphertexts=${n}): EXCEEDS BLOCK GAS LIMIT (${e.shortMessage || e.message})`);
    }
  }

  fs.writeFileSync(path.join(__dirname, "precompile_bench_results.json"), JSON.stringify(results, null, 2));
  console.log("\nSaved precompile_bench_results.json");

  await server.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
