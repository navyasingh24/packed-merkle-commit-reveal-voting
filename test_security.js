// Functional / negative test suite for the baseline (AdvancedVoting) and proposed
// (AdvancedVotingV2: packed commitment slot + Merkle-root eligibility) contracts.
//
// Purpose: show that every mechanism listed in the paper's security table really
// rejects the corresponding misuse (and that the happy path works). This checks
// SPECIFIED BEHAVIOUR on an in-process EVM; it is not a formal verification or audit.
//
// Prerequisites:  npm run compile && npm run compile-variants
// Run:            npm run test-security
// Output:         pass/fail per test, a summary, and test_results.json

const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

// ---------- tiny test harness ----------
const results = [];
let currentSuite = "";
function check(name, ok) {
  results.push({ suite: currentSuite, name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  [${currentSuite}] ${name}`);
}
function reasonOf(e) {
  return [e.reason, e.shortMessage, e.message, e.info && JSON.stringify(e.info)].filter(Boolean).join(" | ");
}
async function expectRevert(name, fn, reason) {
  try {
    const tx = await fn();
    if (tx && tx.wait) await tx.wait();
    check(`${name} -> should revert with "${reason}" but succeeded`, false);
  } catch (e) {
    const got = reasonOf(e);
    const ok = got.includes(reason);
    check(`${name} -> reverts "${reason}"${ok ? "" : "  [got: " + got.slice(0, 160) + "]"}`, ok);
  }
}
async function expectOk(name, fn) {
  try {
    const tx = await fn();
    if (tx && tx.wait) await tx.wait();
    check(name, true);
  } catch (e) {
    check(`${name} (unexpected revert: ${reasonOf(e).slice(0, 120)})`, false);
  }
}

// ---------- Merkle helpers (sorted-pair, matches AdvancedVotingV2._verify) ----------
function hashPair(a, b) {
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}
function buildLayers(leaves) {
  const layers = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
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
const leafOf = (addr) => ethers.keccak256(ethers.solidityPacked(["address"], [addr]));
const commitHash = (cand, secret) => ethers.solidityPackedKeccak256(["uint256", "string"], [cand, secret]);

function newChain(accounts = 80) {
  const s = ganache.provider({
    wallet: { totalAccounts: accounts, deterministic: true },
    chain: { hardfork: "shanghai" },
    logging: { quiet: true },
    miner: { blockGasLimit: 0x1fffffffffffff }
  });
  return { s, provider: new ethers.BrowserProvider(s) };
}
async function advance(provider, secs) {
  await provider.send("evm_increaseTime", [secs]);
  await provider.send("evm_mine");
}
const art = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));

// ---------- suite 1: proposed contract (V2) ----------
async function proposedSuite() {
  currentSuite = "Proposed (packed slot + Merkle root)";
  const { abi, bytecode } = art("compiled_AdvancedVotingV2.json");
  const { s, provider } = newChain();
  const acc = await provider.listAccounts();
  const admin = acc[0], v = acc.slice(1, 9), outsider = acc[20];
  const layers = buildLayers(v.map((x) => leafOf(x.address)));
  const root = layers[layers.length - 1][0];
  const proofOf = (i) => getProof(layers, i);
  const c = await new ethers.ContractFactory(abi, bytecode, admin).deploy();
  await c.deploymentTransaction().wait();
  const as = (signer) => c.connect(signer);
  // expected-revert checks use eth_call (simulated tx on current state): identical revert
  // semantics, and avoids a Ganache quirk where a failed gas-estimation send poisons later sends.
  const rv = (name, signer, method, args, reason) => expectRevert(name, () => c.connect(signer)[method].staticCall(...args), reason);

  // registration phase
  await rv("start commit with no candidates", admin, "startCommitPhase", [3600, 3600], "No candidates");
  await rv("non-admin addCandidate", outsider, "addCandidate", ["X"], "Only admin");
  await expectOk("admin addCandidate A", () => as(admin).addCandidate("A"));
  await expectOk("admin addCandidate B", () => as(admin).addCandidate("B"));
  await rv("start commit before Merkle root is set", admin, "startCommitPhase", [3600, 3600], "No eligibility root");
  await rv("non-admin setMerkleRoot", outsider, "setMerkleRoot", [root], "Only admin");
  await expectOk("admin setMerkleRoot", () => as(admin).setMerkleRoot(root));
  await rv("non-admin startCommitPhase", outsider, "startCommitPhase", [3600, 3600], "Only admin");
  await rv("zero durations", admin, "startCommitPhase", [0, 3600], "Bad durations");
  await rv("commit before commit phase", v[0], "commitVote", [commitHash(1, "s0"), proofOf(0)], "Wrong phase");
  await expectOk("admin startCommitPhase", () => as(admin).startCommitPhase(3600, 3600));
  await rv("setMerkleRoot after commit phase started", admin, "setMerkleRoot", [root], "Wrong phase");
  await rv("addCandidate after commit phase started", admin, "addCandidate", ["late"], "Wrong phase");

  // commit phase: eligibility / integrity
  await rv("outsider with a member's proof", outsider, "commitVote", [commitHash(1, "x"), proofOf(0)], "Not eligible");
  const tampered = proofOf(0).slice(); tampered[0] = ethers.keccak256("0x1234");
  await rv("member with a tampered proof", v[0], "commitVote", [commitHash(1, "s0"), tampered], "Not eligible");
  await rv("member with another member's proof", v[0], "commitVote", [commitHash(1, "s0"), proofOf(1)], "Not eligible");
  await rv("member with an empty proof (tree has >1 leaf)", v[0], "commitVote", [commitHash(1, "s0"), []], "Not eligible");
  await rv("commitment = 0", v[0], "commitVote", [ethers.ZeroHash, proofOf(0)], "Bad commitment");
  await rv("commitment = reveal sentinel (1)", v[0], "commitVote", [ethers.zeroPadValue("0x01", 32), proofOf(0)], "Bad commitment");
  await expectOk("eligible v0 commits for candidate 1", () => as(v[0]).commitVote(commitHash(1, "s0"), proofOf(0)));
  check("stored commitment equals submitted hash", (await c.commitments(v[0].address)) === commitHash(1, "s0"));
  await rv("duplicate commit by v0", v[0], "commitVote", [commitHash(2, "s0b"), proofOf(0)], "Already committed");
  await expectOk("eligible v1 commits for candidate 2", () => as(v[1]).commitVote(commitHash(2, "s1"), proofOf(1)));
  await expectOk("eligible v2 commits for candidate 1", () => as(v[2]).commitVote(commitHash(1, "s2"), proofOf(2)));
  await expectOk("eligible v4 commits (will not reveal)", () => as(v[4]).commitVote(commitHash(1, "s4"), proofOf(4)));

  // phase control
  await rv("reveal during commit phase", v[0], "revealVote", [1, "s0"], "Wrong phase");
  await rv("startRevealPhase before commit deadline", admin, "startRevealPhase", [], "Commit still open");
  await advance(provider, 3601);
  await rv("commit after commit deadline", v[3], "commitVote", [commitHash(1, "s3"), proofOf(3)], "Commit over");
  await rv("non-admin startRevealPhase", outsider, "startRevealPhase", [], "Only admin");
  await expectOk("admin startRevealPhase", () => as(admin).startRevealPhase());
  await rv("commit during reveal phase", v[5], "commitVote", [commitHash(1, "s5"), proofOf(5)], "Wrong phase");

  // reveal phase: binding
  await rv("reveal by eligible address that never committed", v[3], "revealVote", [1, "s3"], "No commit");
  await rv("reveal by outsider", outsider, "revealVote", [1, "x"], "No commit");
  await rv("reveal with wrong secret", v[0], "revealVote", [1, "wrong"], "Hash mismatch");
  await rv("reveal with wrong candidate (committed 1, reveal 2)", v[0], "revealVote", [2, "s0"], "Hash mismatch");
  await rv("reveal invalid candidate id 0", v[0], "revealVote", [0, "s0"], "Invalid candidate");
  await rv("reveal invalid candidate id 99", v[0], "revealVote", [99, "s0"], "Invalid candidate");
  await expectOk("v0 reveals candidate 1", () => as(v[0]).revealVote(1, "s0"));
  await expectOk("v1 reveals candidate 2", () => as(v[1]).revealVote(2, "s1"));
  await expectOk("v2 reveals candidate 1", () => as(v[2]).revealVote(1, "s2"));
  await rv("double reveal by v0", v[0], "revealVote", [1, "s0"], "Already revealed");
  check("slot overwritten with sentinel after reveal", (await c.commitments(v[0].address)) === ethers.zeroPadValue("0x01", 32));
  check("tally after reveals: candidate1 = 2, candidate2 = 1",
    (await c.candidates(1)).voteCount === 2n && (await c.candidates(2)).voteCount === 1n);

  // end of voting
  await rv("endVoting before reveal deadline", admin, "endVoting", [], "Reveal still open");
  await advance(provider, 3601);
  await rv("reveal after reveal deadline (v4)", v[4], "revealVote", [1, "s4"], "Reveal over");
  await rv("non-admin endVoting", outsider, "endVoting", [], "Only admin");
  await expectOk("admin endVoting", () => as(admin).endVoting());
  const w = await c.getWinner();
  check("winner is candidate 1 with 2 votes", w[0] === 1n && w[2] === 2n);
  check("unrevealed commitment (v4) is not counted", (await c.candidates(1)).voteCount === 2n);
  await rv("reveal after voting ended", v[2], "revealVote", [1, "s2"], "Wrong phase");
  await s.disconnect();

  // Merkle verifier: all members accepted, a non-member rejected, for many tree shapes
  currentSuite = "Proposed: Merkle verifier over tree sizes";
  const sizes = [1, 2, 3, 5, 8, 13, 31, 64];
  for (const n of sizes) {
    const { s: s2, provider: p2 } = newChain();
    const a2 = await p2.listAccounts();
    const adm = a2[0], members = a2.slice(1, 1 + n), nonMember = a2[79];
    const lay = buildLayers(members.map((x) => leafOf(x.address)));
    const rt = lay[lay.length - 1][0];
    const k = await new ethers.ContractFactory(abi, bytecode, adm).deploy();
    await k.deploymentTransaction().wait();
    await (await k.addCandidate("A")).wait();
    await (await k.setMerkleRoot(rt)).wait();
    await (await k.startCommitPhase(3600, 3600)).wait();
    let allOk = true;
    for (let i = 0; i < n; i++) {
      try { await (await k.connect(members[i]).commitVote(commitHash(1, `m${i}`), getProof(lay, i))).wait(); }
      catch (e) { allOk = false; }
    }
    check(`tree size ${n}: all ${n} members' proofs accepted`, allOk);
    let rejected = false;
    try { await k.connect(nonMember).commitVote.staticCall(commitHash(1, "z"), getProof(lay, 0)); }
    catch (e) { rejected = reasonOf(e).includes("Not eligible"); }
    check(`tree size ${n}: non-member rejected`, rejected);
    await s2.disconnect();
  }
}

// ---------- suite 2: baseline contract ----------
async function baselineSuite() {
  currentSuite = "Baseline (per-voter registration)";
  const { abi, bytecode } = art("compiled.json");
  const { s, provider } = newChain();
  const acc = await provider.listAccounts();
  const admin = acc[0], v = acc.slice(1, 7), outsider = acc[20];
  const c = await new ethers.ContractFactory(abi, bytecode, admin).deploy();
  await c.deploymentTransaction().wait();
  const as = (signer) => c.connect(signer);
  // expected-revert checks use eth_call (simulated tx on current state): identical revert
  // semantics, and avoids a Ganache quirk where a failed gas-estimation send poisons later sends.
  const rv = (name, signer, method, args, reason) => expectRevert(name, () => c.connect(signer)[method].staticCall(...args), reason);

  await rv("start commit with no candidates", admin, "startCommitPhase", [3600, 3600], "No candidates");
  await rv("non-admin addCandidate", outsider, "addCandidate", ["X"], "Only admin");
  await expectOk("addCandidate A", () => as(admin).addCandidate("A"));
  await expectOk("addCandidate B", () => as(admin).addCandidate("B"));
  await rv("non-admin registerVoter", outsider, "registerVoter", [v[0].address], "Only admin");
  for (let i = 0; i < 5; i++) await expectOk(`register v${i}`, () => as(admin).registerVoter(v[i].address));
  await rv("register the same voter twice", admin, "registerVoter", [v[0].address], "Already registered");
  await rv("zero durations", admin, "startCommitPhase", [0, 3600], "Bad durations");
  await rv("commit before commit phase", v[0], "commitVote", [commitHash(1, "s0")], "Wrong phase");
  await expectOk("startCommitPhase", () => as(admin).startCommitPhase(3600, 3600));
  await rv("registerVoter after commit phase started", admin, "registerVoter", [v[5].address], "Wrong phase");
  await rv("unregistered address commits", outsider, "commitVote", [commitHash(1, "x")], "Not registered");
  await expectOk("v0 commits candidate 1", () => as(v[0]).commitVote(commitHash(1, "s0")));
  await rv("duplicate commit", v[0], "commitVote", [commitHash(2, "s0b")], "Already committed");
  await expectOk("v1 commits candidate 2", () => as(v[1]).commitVote(commitHash(2, "s1")));
  await expectOk("v2 commits candidate 1", () => as(v[2]).commitVote(commitHash(1, "s2")));
  await expectOk("v4 commits (will not reveal)", () => as(v[4]).commitVote(commitHash(1, "s4")));
  await rv("reveal during commit phase", v[0], "revealVote", [1, "s0"], "Wrong phase");
  await rv("startRevealPhase before deadline", admin, "startRevealPhase", [], "Commit still open");
  await advance(provider, 3601);
  await rv("commit after deadline (v3, registered)", v[3], "commitVote", [commitHash(1, "s3")], "Commit over");
  await expectOk("startRevealPhase", () => as(admin).startRevealPhase());
  await rv("reveal by registered address with no commit (v3)", v[3], "revealVote", [1, "s3"], "No commit");
  await rv("reveal by unregistered address", outsider, "revealVote", [1, "x"], "Not registered");
  await rv("reveal with wrong secret", v[0], "revealVote", [1, "wrong"], "Hash mismatch");
  await rv("reveal invalid candidate id 99", v[0], "revealVote", [99, "s0"], "Invalid candidate");
  await expectOk("v0 reveals", () => as(v[0]).revealVote(1, "s0"));
  await expectOk("v1 reveals", () => as(v[1]).revealVote(2, "s1"));
  await expectOk("v2 reveals", () => as(v[2]).revealVote(1, "s2"));
  await rv("double reveal", v[0], "revealVote", [1, "s0"], "Already revealed");
  await rv("endVoting before reveal deadline", admin, "endVoting", [], "Reveal still open");
  await advance(provider, 3601);
  await rv("reveal after deadline (v4)", v[4], "revealVote", [1, "s4"], "Reveal over");
  await expectOk("endVoting", () => as(admin).endVoting());
  const w = await c.getWinner();
  check("winner is candidate 1 with 2 votes", w[0] === 1n && w[2] === 2n);
  await s.disconnect();
}

(async () => {
  await proposedSuite();
  await baselineSuite();
  const bySuite = {};
  for (const r of results) {
    bySuite[r.suite] = bySuite[r.suite] || { passed: 0, failed: 0 };
    r.ok ? bySuite[r.suite].passed++ : bySuite[r.suite].failed++;
  }
  const total = results.length, passed = results.filter((r) => r.ok).length;
  console.log("\n================ SUMMARY ================");
  for (const [k, x] of Object.entries(bySuite)) console.log(`${k}: ${x.passed} passed, ${x.failed} failed`);
  console.log(`TOTAL: ${passed}/${total} passed`);
  fs.writeFileSync(path.join(__dirname, "test_results.json"), JSON.stringify({ total, passed, bySuite, results }, null, 2));
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
