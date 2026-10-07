// 2x2 ablation: {unpacked, packed} state x {per-voter registration, Merkle-root eligibility}.
//   baseline = AdvancedVoting (unpacked, registry)     V1 = AdvancedVotingV1 (packed, registry, single registerVoter)
//   V3       = AdvancedVotingV3 (unpacked, Merkle)      V2 = AdvancedVotingV2 (packed, Merkle)  [proposed]
// Same flow as measure_variants.js (deterministic accounts, secrets "secret-i", 3600 s phases).
// Usage: node measure_ablation.js [N ...]   (default 10 50 100 500) -> ablation_results.json (merged)
const fs = require("fs"), path = require("path"), ganache = require("ganache"), { ethers } = require("ethers");
const art = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
function hp(a, b) { const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a]; return ethers.keccak256(ethers.concat([x, y])); }
function layers(l) { const L = [l]; let v = l; while (v.length > 1) { const n = []; for (let i = 0; i < v.length; i += 2) n.push(i + 1 < v.length ? hp(v[i], v[i + 1]) : v[i]); v = n; L.push(v); } return L; }
function proof(L, i) { const p = []; let x = i; for (let k = 0; k < L.length - 1; k++) { const j = x % 2 === 0 ? x + 1 : x - 1; if (j < L[k].length) p.push(L[k][j]); x = Math.floor(x / 2); } return p; }
const H = (i) => ethers.solidityPackedKeccak256(["uint256", "string"], [1, `secret-${i}`]);

async function run(N, cell) {
  const s = ganache.provider({ wallet: { totalAccounts: N + 5, deterministic: true }, chain: { hardfork: "shanghai" }, logging: { quiet: true }, miner: { blockGasLimit: 0x1fffffffffffff } });
  const p = new ethers.BrowserProvider(s); const acc = await p.listAccounts(); const admin = acc[0], voters = acc.slice(1, 1 + N), outsider = acc[N + 2];
  const file = { baseline: "compiled.json", v1: "compiled_AdvancedVotingV1.json", v3: "compiled_AdvancedVotingV3.json", v2: "compiled_AdvancedVotingV2.json" }[cell];
  const { abi, bytecode } = art(file); const c = await new ethers.ContractFactory(abi, bytecode, admin).deploy(); await c.deploymentTransaction().wait();
  const merkle = cell === "v2" || cell === "v3";
  const candGas = (await (await c.addCandidate("A")).wait()).gasUsed;
  let reg = 0n, L = null;
  if (merkle) { L = layers(voters.map((v) => ethers.keccak256(ethers.solidityPacked(["address"], [v.address])))); reg = (await (await c.setMerkleRoot(L[L.length - 1][0])).wait()).gasUsed; }
  else for (const v of voters) reg += (await (await c.registerVoter(v.address)).wait()).gasUsed;
  await (await c.startCommitPhase(3600, 3600)).wait();
  let com = 0n;
  for (let i = 0; i < N; i++) com += (await (await (merkle ? c.connect(voters[i]).commitVote(H(i), proof(L, i)) : c.connect(voters[i]).commitVote(H(i)))).wait()).gasUsed;
  let outsiderRejected = false;   // sanity: an ineligible address cannot commit
  try { merkle ? await c.connect(outsider).commitVote.staticCall(H(999), proof(L, 0)) : await c.connect(outsider).commitVote.staticCall(H(999)); } catch (e) { outsiderRejected = true; }
  await p.send("evm_increaseTime", [3601]); await p.send("evm_mine");
  await (await c.startRevealPhase()).wait();
  let rev = 0n; for (let i = 0; i < N; i++) rev += (await (await c.connect(voters[i]).revealVote(1, `secret-${i}`)).wait()).gasUsed;
  const tallyOk = (await c.candidates(1)).voteCount === BigInt(N);   // sanity: every vote counted
  await s.disconnect();
  return { regGas: Number(reg), commitGas: Number(com), revealGas: Number(rev), total: Number(reg + com + rev), candidateRegGas: Number(candGas), sanity: { outsiderRejected, tallyOk } };
}
(async () => {
  const Ns = process.argv.slice(2).map(Number); const list = Ns.length ? Ns : [10, 50, 100, 500];
  const outFile = path.join(__dirname, "ablation_results.json"); const res = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
  for (const N of list) {
    res[N] = {};
    for (const cell of ["baseline", "v1", "v3", "v2"]) { res[N][cell] = await run(N, cell); const r = res[N][cell];
      console.log(`N=${N} ${cell.padEnd(8)} per-voter ${(r.total / N).toFixed(1)}  (reg ${(r.regGas / N).toFixed(1)}, commit ${(r.commitGas / N).toFixed(1)}, reveal ${(r.revealGas / N).toFixed(1)})  sanity ${JSON.stringify(r.sanity)}`); }
    fs.writeFileSync(outFile, JSON.stringify(res, null, 2));
  }
  console.log("Saved ablation_results.json");
})().catch((e) => { console.error(e); process.exit(1); });
