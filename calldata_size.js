const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// This measures on-chain CALLDATA size (bytes), a different resource from gas.
// Calldata cost matters separately because:
//  - L2 rollups price calldata (bytes) as a major cost component, independent
//    of execution gas.
//  - Our earlier PrecompileBench.sol used simplified functions like
//    ringVerify(uint256 n) and zkpVerify(uint256 l) to isolate EC-operation
//    GAS cost. Those are NOT realistic calldata shapes: a real ring signature
//    or ZKP verification call must carry the actual signature/proof bytes on
//    calldata, not just an integer. This script uses the REALISTIC function
//    signatures (standard shapes used in real deployments) to measure what a
//    genuine transaction would actually carry.
// ---------------------------------------------------------------------------

const { abi: votingAbi } = JSON.parse(fs.readFileSync(path.join(__dirname, "compiled.json"), "utf8"));

// Realistic baseline-scheme call shapes (standard in real implementations):
const zkpAbi = [
  // Standard snarkjs/Groth16 on-chain verifier signature (A, B, C points + public inputs)
  "function verifyProof(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[] input) external returns (bool)"
];
const ringAbi = [
  // AOS-style ring signature: one challenge + one response per ring member
  "function verifyRingSignature(uint256[] responses, uint256 challenge) external returns (bool)"
];
const mixnetAbi = [
  // Single voter's ElGamal-encrypted ballot (2 EC points = c1, c2)
  "function submitBallot(uint256 c1x, uint256 c1y, uint256 c2x, uint256 c2y) external",
  // A mix-server's shuffle round: n re-encrypted ciphertexts (2 arrays of n) + a fixed-size shuffle proof
  "function shuffleRound(uint256[] reencX, uint256[] reencY, uint256[8] proof) external"
];

function bytesOf(hexData) {
  return (hexData.length - 2) / 2; // strip "0x", 2 hex chars per byte
}

function main() {
  const votingIface = new ethers.Interface(votingAbi);
  const zkpIface = new ethers.Interface(zkpAbi);
  const ringIface = new ethers.Interface(ringAbi);
  const mixnetIface = new ethers.Interface(mixnetAbi);

  const results = {};

  // ---- Commit-Reveal (yours): real ABI, real parameter shapes ----
  const commitment = ethers.keccak256(ethers.toUtf8Bytes("dummy"));
  const commitCalldata = votingIface.encodeFunctionData("commitVote", [commitment]);
  results.commitVote_bytes = bytesOf(commitCalldata);

  const secret = "secret-0-abc123xy"; // representative length used in our own test runs
  const revealCalldata = votingIface.encodeFunctionData("revealVote", [1, secret]);
  results.revealVote_bytes = bytesOf(revealCalldata);

  results.registerVoter_bytes = bytesOf(
    votingIface.encodeFunctionData("registerVoter", ["0x1234567890123456789012345678901234567890"])
  );

  results.commitReveal_totalPerVoter_bytes = results.commitVote_bytes + results.revealVote_bytes;

  // ---- ZKP: realistic Groth16 proof submission, 2 public inputs ----
  const dummyProof = {
    a: [1n, 2n],
    b: [[1n, 2n], [3n, 4n]],
    c: [5n, 6n],
    input: [111n, 222n] // 2 public inputs
  };
  const zkpCalldata = zkpIface.encodeFunctionData("verifyProof", [dummyProof.a, dummyProof.b, dummyProof.c, dummyProof.input]);
  results.zkpVerifyProof_bytes = bytesOf(zkpCalldata);

  // ---- Ring signature: realistic responses+challenge submission, ring size 20 ----
  for (const n of [2, 5, 10, 20, 30]) {
    const responses = Array.from({ length: n }, (_, i) => BigInt(i + 1));
    const calldata = ringIface.encodeFunctionData("verifyRingSignature", [responses, 999n]);
    results[`ringVerify_n${n}_bytes`] = bytesOf(calldata);
  }

  // ---- Mixnet: realistic ballot submission (per voter) + shuffle round (per batch) ----
  results.mixnetBallot_bytes = bytesOf(
    mixnetIface.encodeFunctionData("submitBallot", [1n, 2n, 3n, 4n])
  );
  for (const n of [10, 50, 100, 500]) {
    const reencX = Array.from({ length: n }, (_, i) => BigInt(i + 1));
    const reencY = Array.from({ length: n }, (_, i) => BigInt(i + 2));
    const proof = Array.from({ length: 8 }, (_, i) => BigInt(i + 1));
    const calldata = mixnetIface.encodeFunctionData("shuffleRound", [reencX, reencY, proof]);
    results[`mixnetShuffleRound_n${n}_bytes`] = bytesOf(calldata);
  }
  // Total mixnet calldata for n voters = n ballot submissions + 1 shuffle round (per mix round)
  for (const n of [10, 50, 100, 500]) {
    results[`mixnetTotal_n${n}_bytes`] = n * results.mixnetBallot_bytes + results[`mixnetShuffleRound_n${n}_bytes`];
  }

  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(__dirname, "calldata_size_results.json"), JSON.stringify(results, null, 2));
  console.log("\nSaved calldata_size_results.json");
}

main();
