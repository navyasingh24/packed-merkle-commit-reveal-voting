const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

async function main() {
  const { abi, bytecode } = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled.json"), "utf8"));

  const NUM_VOTERS = 60; // per-voter ops are O(1) and independent of N, so this sample gives a stable average
  const server = ganache.provider({
    wallet: { totalAccounts: NUM_VOTERS + 5, deterministic: true },
    chain: { hardfork: "shanghai" },
    logging: { quiet: true }
  });
  const provider = new ethers.BrowserProvider(server);

  const accounts = await provider.listAccounts();
  const admin = accounts[0];
  const voters = accounts.slice(1, 1 + NUM_VOTERS);

  const factory = new ethers.ContractFactory(abi, bytecode, admin);
  const contract = await factory.deploy();
  const deployReceipt = await contract.deploymentTransaction().wait();
  const deployGas = deployReceipt.gasUsed;

  const addr = await contract.getAddress();

  // ---- Candidate registration (one-time cost) ----
  const cand1Tx = await contract.connect(admin).addCandidate("Candidate A");
  const cand1Receipt = await cand1Tx.wait();
  const cand2Tx = await contract.connect(admin).addCandidate("Candidate B");
  const cand2Receipt = await cand2Tx.wait();

  // ---- Voter registration ----
  const regGas = [];
  for (const v of voters) {
    const tx = await contract.connect(admin).registerVoter(v.address);
    const r = await tx.wait();
    regGas.push(Number(r.gasUsed));
  }

  // ---- Start commit phase ----
  const startCommitTx = await contract.connect(admin).startCommitPhase(3600, 3600);
  const startCommitReceipt = await startCommitTx.wait();

  // ---- Commit votes ----
  const secrets = [];
  const commitGas = [];
  for (let i = 0; i < voters.length; i++) {
    const v = voters[i];
    const candidateId = (i % 2) + 1;
    const secret = `secret-${i}`;
    secrets.push({ candidateId, secret });
    const hash = ethers.solidityPackedKeccak256(["uint256", "string"], [candidateId, secret]);
    const tx = await contract.connect(v).commitVote(hash);
    const r = await tx.wait();
    commitGas.push(Number(r.gasUsed));
  }

  // ---- Advance time & start reveal ----
  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  const startRevealTx = await contract.connect(admin).startRevealPhase();
  await startRevealTx.wait();

  // ---- Reveal votes ----
  const revealGas = [];
  for (let i = 0; i < voters.length; i++) {
    const v = voters[i];
    const { candidateId, secret } = secrets[i];
    const tx = await contract.connect(v).revealVote(candidateId, secret);
    const r = await tx.wait();
    revealGas.push(Number(r.gasUsed));
  }

  // ---- End voting ----
  await provider.send("evm_increaseTime", [3601]);
  await provider.send("evm_mine");
  const endTx = await contract.connect(admin).endVoting();
  const endReceipt = await endTx.wait();

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const result = {
    solcVersion: "0.8.20 (optimizer, 200 runs)",
    sampleVoters: NUM_VOTERS,
    deploymentGas: Number(deployGas),
    candidateRegistrationGas_1st: Number(cand1Receipt.gasUsed),
    candidateRegistrationGas_2nd: Number(cand2Receipt.gasUsed),
    voterRegistration: { avg: avg(regGas), min: Math.min(...regGas), max: Math.max(...regGas) },
    commitVote: { avg: avg(commitGas), min: Math.min(...commitGas), max: Math.max(...commitGas) },
    revealVote: { avg: avg(revealGas), min: Math.min(...revealGas), max: Math.max(...revealGas) },
    startCommitPhaseGas: Number(startCommitReceipt.gasUsed),
    endVotingTallyGas: Number(endReceipt.gasUsed),
  };
  result.perVoterTotal_RegCommitReveal = result.voterRegistration.avg + result.commitVote.avg + result.revealVote.avg;
  result.perVoterTotal_plusOneTimeCandidateReg = result.perVoterTotal_RegCommitReveal + result.candidateRegistrationGas_1st;

  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(__dirname, "gas_results.json"), JSON.stringify(result, null, 2));

  await server.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
