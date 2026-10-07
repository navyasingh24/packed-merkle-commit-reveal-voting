const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

const N_VALUES = [10, 50, 100, 500, 1000];

async function runForN(N, abi, bytecode) {
  const server = ganache.provider({
    wallet: { totalAccounts: N + 5, deterministic: true },
    chain: { hardfork: "shanghai" },
    logging: { quiet: true },
    miner: { blockGasLimit: 0x1fffffffffffff } // large enough; each tx still mined individually
  });
  const provider = new ethers.BrowserProvider(server);
  const accounts = await provider.listAccounts();
  const admin = accounts[0];
  const voters = accounts.slice(1, 1 + N);

  const factory = new ethers.ContractFactory(abi, bytecode, admin);
  const contract = await factory.deploy();
  const deployReceipt = await contract.deploymentTransaction().wait();

  const candTx = await contract.connect(admin).addCandidate("Candidate A");
  const candReceipt = await candTx.wait();

  let regGasTotal = 0n;
  for (const v of voters) {
    const tx = await contract.connect(admin).registerVoter(v.address);
    const r = await tx.wait();
    regGasTotal += r.gasUsed;
  }

  const startCommitTx = await contract.connect(admin).startCommitPhase(3600, 3600);
  await startCommitTx.wait();

  const secrets = [];
  let commitGasTotal = 0n;
  for (let i = 0; i < voters.length; i++) {
    const candidateId = 1;
    const secret = `secret-${i}`;
    secrets.push(secret);
    const hash = ethers.solidityPackedKeccak256(["uint256", "string"], [candidateId, secret]);
    const tx = await contract.connect(voters[i]).commitVote(hash);
    const r = await tx.wait();
    commitGasTotal += r.gasUsed;
  }

  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  const startRevealTx = await contract.connect(admin).startRevealPhase();
  await startRevealTx.wait();

  let revealGasTotal = 0n;
  for (let i = 0; i < voters.length; i++) {
    const tx = await contract.connect(voters[i]).revealVote(1, secrets[i]);
    const r = await tx.wait();
    revealGasTotal += r.gasUsed;
  }

  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  const endTx = await contract.connect(admin).endVoting();
  const endReceipt = await endTx.wait();

  const totalVotingGas = regGasTotal + commitGasTotal + revealGasTotal; // recurring, N-dependent
  const fixedGas = deployReceipt.gasUsed + candReceipt.gasUsed + startCommitTx ? 0n : 0n; // deploy/candidate are one-time setup, reported separately
  const totalIncludingOneTimeCandidateReg = totalVotingGas + candReceipt.gasUsed;

  await server.disconnect();

  return {
    N,
    deploymentGas: Number(deployReceipt.gasUsed),
    candidateRegistrationGas: Number(candReceipt.gasUsed),
    registerVoterGasTotal: Number(regGasTotal),
    commitVoteGasTotal: Number(commitGasTotal),
    revealVoteGasTotal: Number(revealGasTotal),
    totalVotingGas_RegCommitReveal: Number(totalVotingGas),
    totalIncludingOneTimeCandidateReg: Number(totalIncludingOneTimeCandidateReg),
    avgPerVoter: Number(totalVotingGas) / N,
  };
}

async function main() {
  const { abi, bytecode } = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled.json"), "utf8"));
  const results = [];
  for (const N of N_VALUES) {
    const t0 = Date.now();
    const r = await runForN(N, abi, bytecode);
    r.wallClockMs = Date.now() - t0;
    results.push(r);
    console.log(`N=${N} done in ${r.wallClockMs}ms -> total (incl. candidate reg) = ${r.totalIncludingOneTimeCandidateReg.toLocaleString()} gas (${(r.totalIncludingOneTimeCandidateReg/1e6).toFixed(2)}M)`);
  }
  fs.writeFileSync(path.join(__dirname, "gas_scale_results.json"), JSON.stringify(results, null, 2));
  console.log("\nSaved gas_scale_results.json");
  console.table(results.map(r => ({
    N: r.N,
    "Total (incl. cand. reg)": r.totalIncludingOneTimeCandidateReg,
    "In Millions": (r.totalIncludingOneTimeCandidateReg / 1e6).toFixed(2) + "M",
    "Avg gas/voter": r.avgPerVoter.toFixed(1),
  })));
}

main().catch((e) => { console.error(e); process.exit(1); });
