// Measures the one-time candidate-registration gas (first addCandidate call) for each contract,
// using the same candidate name as scale.js ("Candidate A"), so Table III / Table IV / Eq. (4)
// in the paper can be reproduced from measured values only.
// Needs: npm run compile, npm run compile-variants, npm run compile-ablation
// Output: candidate_results.json
const fs = require("fs"), path = require("path"), ganache = require("ganache"), { ethers } = require("ethers");

const contracts = {
  baseline: "compiled.json",
  v1: "compiled_AdvancedVotingV1.json",
  v2: "compiled_AdvancedVotingV2.json",
  v3: "compiled_AdvancedVotingV3.json",
};

(async () => {
  const out = { candidateName: "Candidate A" };
  for (const [cell, file] of Object.entries(contracts)) {
    const p = path.join(__dirname, file);
    if (!fs.existsSync(p)) { console.log(`skip ${cell}: ${file} not found (compile it first)`); continue; }
    const { abi, bytecode } = JSON.parse(fs.readFileSync(p, "utf8"));
    const s = ganache.provider({ wallet: { totalAccounts: 3, deterministic: true }, chain: { hardfork: "shanghai" }, logging: { quiet: true } });
    const provider = new ethers.BrowserProvider(s);
    const admin = (await provider.listAccounts())[0];
    const c = await new ethers.ContractFactory(abi, bytecode, admin).deploy();
    await c.deploymentTransaction().wait();
    const r = await (await c.addCandidate(out.candidateName)).wait();
    out[cell] = Number(r.gasUsed);
    console.log(`${cell}: first addCandidate("${out.candidateName}") = ${out[cell]} gas`);
    await s.disconnect();
  }
  fs.writeFileSync(path.join(__dirname, "candidate_results.json"), JSON.stringify(out, null, 2));
  console.log("Saved candidate_results.json");
})().catch((e) => { console.error(e); process.exit(1); });
