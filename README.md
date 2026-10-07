# Gas-Efficient Commit–Reveal E-Voting on Permissioned Blockchains

Code, measurements, tests and figure generation for the paper:

> **Gas-Efficient Commit–Reveal E-Voting on Permissioned Blockchains using Packed State and Merkle-Root Eligibility**

The proposed Solidity contract runs a commit–reveal election with two gas optimizations:
1. **Packed per-voter state.** Each voter has a single `bytes32` storage slot. `0` means no vote, a hash means a pending commitment, and a sentinel value means revealed. This replaces separate status, choice and flag fields.
2. **Merkle-root eligibility.** The administrator publishes one Merkle root for the whole voter list in a single transaction, instead of registering every voter on-chain. Each voter proves eligibility with a Merkle proof when committing.

It is compared, under identical conditions, with a **naive baseline** that runs the same protocol: per-voter registration transactions and separate storage fields.

> **Nothing is hard-coded.** This repository contains source code only. Every result file (`*.json`) and every figure (`figures/`) is created on your computer when you run the commands below. Gas and calldata results are deterministic (fixed accounts and secrets), so you get exactly the values listed in this README. Timings (milliseconds) depend on your computer.

---

## Contents
1. [Repository structure](#1-repository-structure)
2. [Requirements](#2-requirements)
3. [Setup in VS Code (step by step)](#3-setup-in-vs-code-step-by-step)
4. [Running everything: full command list](#4-running-everything-full-command-list)
5. [What each command does, which file it creates, expected results](#5-what-each-command-does-which-file-it-creates-expected-results)
6. [Figures and the paper-numbers report](#6-figures-and-the-paper-numbers-report)
7. [Packing all results into one zip](#7-packing-all-results-into-one-zip)
8. [Mapping: paper item → command → file](#8-mapping-paper-item--command--file)
9. [Measurement setup and reproducibility](#9-measurement-setup-and-reproducibility)
10. [Troubleshooting](#10-troubleshooting)
11. [Scope and limitations](#11-scope-and-limitations)

---

## 1. Repository structure

```
.
├── contracts/
│   ├── AdvancedVoting.sol       Naive BASELINE: per-voter registration, separate status/choice fields
│   ├── AdvancedVotingV2.sol     PROPOSED: one packed slot per voter + Merkle-root eligibility
│   ├── AdvancedVotingV1.sol     2x2 ablation cell: packed slot only (per-voter registration kept)
│   ├── AdvancedVotingV3.sol     2x2 ablation cell: Merkle eligibility only (unpacked state kept)
│   └── PrecompileBench.sol      ZKP / ring-signature / mixnet primitive benchmarks (BN254 precompiles)
│
├── compile.js                 compiles the baseline                    -> compiled.json
├── compile_bench.js           compiles the primitive benchmarks        -> compiled_bench.json
├── compile_variants.js        compiles V1 and V2 (proposed)            -> compiled_AdvancedVotingV1/V2.json
├── compile_ablation.js        compiles V3                              -> compiled_AdvancedVotingV3.json
│
├── measure_candidate.js       gas of candidate registration            -> candidate_results.json
├── measure_variants.js        baseline vs. proposed gas, N=10..500     -> variant_results.json
├── measure_v2_n1000.js        proposed contract at N=1000              -> v2_n1000_result.json
├── scale.js                   baseline at N=10..1000                   -> gas_scale_results.json
├── measure_ablation.js        2x2 ablation (baseline, V1, V3, V2)      -> ablation_results.json
├── measure_bench.js           ZKP / ring / mixnet primitive gas        -> precompile_bench_results.json
├── calldata_size.js           calldata of baseline, ZKP, ring, mixnet  -> calldata_size_results.json
├── calldata_v2.js             calldata of the proposed contract        -> calldata_v2_results.json
├── test_security.js           103 functional/security tests            -> test_results.json
├── latency_v2.js              timing of the proposed contract          -> latency_v2_results.json
├── latency_scale.js           timing of baseline, ring, ZKP, mixnet    -> latency_results.json
├── measure.js                 (optional) 60-voter sample, not in paper -> gas_results.json
│
├── make_figures.js            builds all figures + numbers report      -> figures/
├── pack_results.js            zips all results + figures               -> finalResults_bc.zip
│
├── package.json               dependencies and npm commands
├── .gitignore                 excludes node_modules, results, figures, zip
└── README.md
```

---

## 2. Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20 or newer (tested on 22 and 24) | https://nodejs.org (choose the LTS version) |
| npm | comes with Node.js | |
| VS Code | any recent version | any terminal also works |
| OS | macOS, Windows or Linux | commands are identical on all three |

Everything else is installed automatically by `npm install`:

| Package | Version | Role |
|---|---|---|
| `solc` | 0.8.20 (exact) | Solidity compiler (JavaScript build), optimizer on, 200 runs |
| `ganache` | 7.x (tested 7.9.2) | in-process local Ethereum chain (Shanghai hardfork, deterministic accounts) |
| `ethers` | 6.x (tested 6.17.0) | sends the transactions and reads gas used from receipts |

No internet connection is needed after `npm install`. No wallet, testnet or real Ether is used.

---

## 3. Setup in VS Code (step by step)

**Step 1: Install Node.js.**
Download the LTS installer from https://nodejs.org and run it. Then check it in a terminal:
```bash
node -v      # should print v20.x, v22.x or v24.x
npm -v
```

**Step 2: Get the code.**
Either clone it:
```bash
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>
```
or download the ZIP from GitHub (green **Code** button → **Download ZIP**) and unzip it.

**Step 3: Open the folder in VS Code.**
`File → Open Folder…` → select the project folder (the one containing `package.json`).

**Step 4: Open the terminal in VS Code.**
`Terminal → New Terminal` (or press <kbd>Ctrl</kbd>+<kbd>`</kbd>). Make sure the terminal is in the project folder; `ls` (macOS/Linux) or `dir` (Windows) should list `package.json`.

**Step 5: Install the dependencies.**
```bash
npm install
```
This creates a `node_modules/` folder.
- A message about "vulnerabilities" may appear. **Ignore it. Do NOT run `npm audit fix` or `npm audit fix --force`**: they downgrade ganache and break the project.
- A message like `µWS is not compatible with your Node.js build. Falling back to a NodeJS implementation` is harmless.

**Step 6: Check that the commands are available.**
```bash
npm run
```
This lists all commands (compile, candidate, measure-variants, …, figures, results-zip).

You are ready. Continue with Section 4.

---

## 4. Running everything: full command list

Run these **in this order**, one at a time, in the VS Code terminal. Wait for each to finish (the prompt comes back) before starting the next. Times are approximate for a typical laptop.

```bash
# --- A. Compile (always first) ------------------------------------------------
npm run compile              # seconds
npm run compile-bench        # seconds
npm run compile-variants     # seconds
npm run compile-ablation     # seconds

# --- B. Gas measurements --------------------------------------------------------
npm run candidate            # seconds
npm run measure-variants     # ~2-4 min
npm run v2-n1000             # ~1 min
npm run scale                # ~2-3 min
npm run ablation             # ~2-4 min
npm run bench                # ~1-3 min

# --- C. Calldata ------------------------------------------------------------------
npm run calldata             # seconds
npm run calldata-v2          # seconds

# --- D. Functional / security tests ----------------------------------------------
npm run test-security        # seconds

# --- E. Timing (machine-dependent) ------------------------------------------------
npm run latency-v2           # ~1-2 min
npm run latency              # ~3-6 min

# --- F. Figures, then pack everything ---------------------------------------------
npm run figures              # seconds
npm run results-zip          # seconds
```

Total: about 15–25 minutes. Each command can be re-run on its own at any time; it overwrites its own result file. The compile commands only need to be run again if you change a contract.

---

## 5. What each command does, which file it creates, expected results

All gas values are exact; you should get identical numbers. "Per voter" means register/eligibility + commit + reveal for one voter.

### A. Compile

| Command | What it does | Creates |
|---|---|---|
| `npm run compile` | Compiles the baseline `AdvancedVoting.sol` with solc 0.8.20 (optimizer, 200 runs) | `compiled.json` (ABI + bytecode) |
| `npm run compile-bench` | Compiles `PrecompileBench.sol` | `compiled_bench.json`. A "Warning: Function state mutability can be restricted to view" message is harmless. |
| `npm run compile-variants` | Compiles `AdvancedVotingV1.sol` and `AdvancedVotingV2.sol` (proposed) | `compiled_AdvancedVotingV1.json`, `compiled_AdvancedVotingV2.json` |
| `npm run compile-ablation` | Compiles `AdvancedVotingV3.sol` | `compiled_AdvancedVotingV3.json` |

If a later command fails with `ENOENT: no such file or directory, open '…/compiled….json'`, run the four compile commands first.

### B. Gas measurements

#### `npm run candidate` → `candidate_results.json`
Deploys each contract and measures the gas of the first `addCandidate("Candidate A")`.
```json
{ "candidateName": "Candidate A", "baseline": 96041, "v1": 96041, "v2": 96019, "v3": 96019 }
```
Used in: Table III (candidate registration: baseline 96,041, proposed 96,019).

#### `npm run measure-variants` → `variant_results.json`
Runs complete elections (deploy → candidates → registration/Merkle root → commit by every voter → reveal by every voter → tally) for N = 10, 50, 100, 500 with the baseline, V1 (single and batch registration) and V2 (proposed). Stores `regGas`, `commitGas`, `revealGas` and `total` for each.

Expected at N = 100:

| Contract | Registration/eligibility | Commit (total) | Reveal (total) | Total | Per voter |
|---|---|---|---|---|---|
| Baseline | 4,759,716 | 5,467,804 | 6,533,680 | 16,761,200 | **167,612** |
| Proposed (V2) | 47,312 (one Merkle root) | 5,834,396 | 4,082,880 | 9,964,588 | **99,646** |

Per-voter averages: commit 54,678 → 58,344; reveal 65,337 → 40,829; reduction **−40.5%**. Across N = 10–500 the reduction is 39.4–40.7%.
Used in: Table III, Eqs. (1)–(2), Sec. IV-B, Table IV, Fig. 3.

#### `npm run v2-n1000` → `v2_n1000_result.json`
The proposed contract at N = 1000 (kept separate because it is the longest gas run).
```json
{ "N": 1000, "rootGas": 47312, "commitGasTotal": 61042412, "revealGasTotal": 40686780,
  "total": 101776504, "avgPerVoter": 101776.504, "avgProofLen": 9.984,
  "commitCalldataBytesAtProofLen": 420, "wallClockMs": <your machine> }
```
Used in: Table IV and Fig. 3 (proposed, N = 1000: 101.87M including one-time setup).

#### `npm run scale` → `gas_scale_results.json`
The baseline at N = 10, 50, 100, 500, 1000: deployment, candidate registration, registration/commit/reveal totals, total and per-voter average.

| N | Total incl. one-time candidate reg. |
|---|---|
| 10 | 1,787,449 |
| 50 | 8,485,149 |
| 100 | 16,857,241 |
| 500 | 83,838,657 |
| 1000 | 167,565,517 |

Used in: Table IV and Fig. 3 (baseline column).

#### `npm run ablation` → `ablation_results.json`
The 2×2 ablation: each optimization alone and both together, for N = 10, 50, 100, 500, all under the same conditions. Each entry also has sanity checks (`outsiderRejected`: a non-eligible address cannot vote; `tallyOk`: the tally is correct); all must be `true`.

| Cell | Contract | Total gas at N = 100 | Per voter |
|---|---|---|---|
| Neither (baseline) | `AdvancedVoting.sol` | 16,761,200 | 167,612 |
| Packing only | `AdvancedVotingV1.sol` | 14,012,200 | 140,122 (−16.4%) |
| Merkle only | `AdvancedVotingV3.sol` | 14,617,988 | 146,180 (−12.8%) |
| Both (proposed) | `AdvancedVotingV2.sol` | 9,964,588 | 99,646 (−40.5%) |

Together the two save 67,966 gas/voter, which is 19,044 more than the sum of the separate savings. Without packing, the voter's flag slot is first written at commit (commit 80,504 gas with Merkle only vs. 58,344 with both).
Optional: `node measure_ablation.js 1000` adds N = 1000 to the same file.
Used in: Sec. IV-B (2×2 sentence).

#### `npm run bench` → `precompile_bench_results.json`
Execution-gas benchmarks of the cryptographic primitives, built from the EVM's BN254 precompiles (EIP-196/197/1108):

| Benchmark | Parameter | Gas |
|---|---|---|
| ZKP (Groth16-style verify: l scalar mults + one 4-pair pairing check) | l = 1 / 2 / 5 | 216,579 / **223,800** / 245,466 |
| Ring signature verify (Schnorr/AOS-style, per member: 2 ecMul + 1 ecAdd) | n = 2 / 5 / 10 / 15 / 20 / 25 / 30 | 72,033 / 114,288 / 184,744 / 255,240 / **325,774** / 396,348 / 466,960 |
| Mixnet single shuffle/re-encryption round | n = 10 / 50 / 100 / 500 | 505,423 / 1,690,831 / 3,174,568 / 15,123,575 |
| Mixnet round | n = 1000 | `"EXCEEDS_BLOCK_GAS_LIMIT"` (expected) |

`stabilityCheck` repeats ZKP (l = 2) and ring (n = 10) five times on fresh contracts; all five values must be identical.
Used in: Sec. IV-C, Eqs. (5)–(6), Table IV and Fig. 3 (ZKP × N, ring × N).

### C. Calldata

#### `npm run calldata` → `calldata_size_results.json`
Bytes of transaction input (ABI-encoded) per operation:

| Item | Bytes |
|---|---|
| Baseline `commitVote` / `revealVote` / `registerVoter` | 36 / 132 / 36 |
| Baseline per voter (commit + reveal) | **168** |
| ZKP `verifyProof` | **388** |
| Ring verify n = 2 / 5 / 10 / 20 / 30 | 164 / 260 / 420 / **740** / 1060 |
| Mixnet ballot / shuffle round (n = 100) / total (n = 100) | 132 / 6,788 / 19,988 (≈ 200 per voter) |

#### `npm run calldata-v2` → `calldata_v2_results.json`
The proposed contract's commit carries a Merkle proof (one 32-byte hash per tree level), so its size depends on N:

| N | Proof length (hashes) | Commit bytes | + Reveal (132) = per voter |
|---|---|---|---|
| 10 | 4 | 228 | 360 |
| 50 | 6 | 292 | 424 |
| 100 | 7 | 324 | **456** |
| 500 | 9 | 388 | 520 |
| 1000 | 10 | 420 | 552 |

`setMerkleRoot` is 36 bytes (sent once).
Used in: Sec. IV-E and Fig. 4.

### D. Tests

#### `npm run test-security` → `test_results.json`
103 functional/security checks, printed in the terminal one by one and saved with name and pass/fail:

| Suite | Checks |
|---|---|
| Proposed (packed slot + Merkle root) | 50 |
| Proposed: Merkle verifier over tree sizes | 16 |
| Baseline (per-voter registration) | 37 |
| **Total** | **103 / 103 passed** |

Covered: only the admin can add candidates, set the Merkle root, register voters (baseline) or change phases; phase order and commit/reveal deadlines are enforced; outsiders, tampered proofs, another member's proof and empty proofs are rejected; zero and sentinel commitments are rejected; no double commit; a reveal must match the commitment (wrong secret or wrong candidate rejected); invalid candidate IDs are rejected; no double reveal; the slot holds the sentinel after reveal; the tally and winner are correct; unrevealed commitments are not counted; Merkle proofs of every member are accepted and non-members rejected for tree sizes 1, 2, 3, 5, 8, 13, 31 and 64.
Used in: Sec. III (test-suite sentence).

### E. Timing (machine-dependent)

These record wall-clock milliseconds of the local emulation. Your numbers will differ from other machines; the **ordering** (proposed faster than baseline, ring/ZKP much slower) should hold.

#### `npm run latency-v2` → `latency_v2_results.json`
Time of the full proposed-contract election for N = 10, 50, 100, 500, 1000, e.g. `{ "10": …, "50": …, "100": …, "500": …, "1000": … }`.

#### `npm run latency` → `latency_results.json`
Runs three parts and merges them into one file:

| Key | Part (can be run separately) | Contents |
|---|---|---|
| `commitReveal_ms` | `npm run latency-cr` | baseline full election, N = 10…1000 |
| `ringVerify_n20_ms` | `npm run latency-ec` | N ring verifications (n = 20), N = 10, 50, 100 |
| `zkpVerify_l2_ms` | `npm run latency-ec` | N ZKP verifications (l = 2), N = 10 |
| `mixnetRound_ms` | `npm run latency-mix` | one mixnet round, n = 10…500 |

Example (Apple M1, 16 GB, Node 24): proposed 35.3 s vs. baseline 46.4 s at N = 1000 (24% faster); ring ≈ 333 ms/vote; ZKP ≈ 2.6 s/vote.
Used in: Sec. IV-E and Fig. 5.

### Optional

#### `npm run measure` → `gas_results.json`
An older 60-voter sample of the baseline (per-operation gas). **Not used in the paper**; kept for reference.

---

## 6. Figures and the paper-numbers report

```bash
npm run figures
```
Reads **only** the result files above and creates the folder `figures/`:

| File | Content |
|---|---|
| `fig3_total_gas.svg` / `.csv` | Fig. 3: total gas vs. N (baseline, proposed, ZKP × N, ring × N), log scale |
| `fig4_calldata.svg` / `.csv` | Fig. 4: calldata bytes per voter (baseline, proposed at N = 100, ZKP, ring, mixnet) |
| `fig5_latency.svg` / `.csv` | Fig. 5: emulated time vs. N from your timing runs |
| `pgfplots_coordinates.tex` | the same data as LaTeX/pgfplots coordinates, ready to paste into the paper |
| `paper_numbers.md` | every number in the paper recomputed from your results: Table III, Eqs. (1)–(2), 2×2 ablation, Table IV, the Eq. (4) least-squares fit, primitive benchmarks, calldata, timing, tests |

If a result file is missing, the affected figure is skipped and the terminal prints which command to run.

**How to view the figures:**
- **macOS:** in Finder, open `figures/`, select an `.svg`, press <kbd>Space</kbd> (Quick Look), or open it in Safari/Chrome.
- **Windows:** right-click the `.svg` → Open with → Edge/Chrome.
- **VS Code:** clicking an `.svg` shows its source code. Right-click it → **Reveal in Finder / Reveal in File Explorer** and open it from there, or install an SVG preview extension.
- `paper_numbers.md`: open in VS Code and press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> for the formatted preview.
- `.csv` files open in Excel, Numbers or Google Sheets.

---

## 7. Packing all results into one zip

```bash
npm run results-zip
```
Regenerates `figures/` and creates **`finalResults_bc.zip`** in the project folder, containing:

```
finalResults_bc/
├── candidate_results.json, variant_results.json, v2_n1000_result.json, gas_scale_results.json,
│   ablation_results.json, precompile_bench_results.json, calldata_size_results.json,
│   calldata_v2_results.json, test_results.json, latency_v2_results.json, latency_results.json
│   (and gas_results.json if you ran the optional `measure`)
├── figures/      all files from Section 6
└── manifest.json
```

`manifest.json` records:
- the machine (Node version, OS, CPU, memory) and package versions (solc, ganache, ethers);
- a SHA-256 fingerprint of every contract source and every compiled bytecode, which proves which code produced the results;
- every included file with its size and SHA-256;
- any result file that is missing, with the command that creates it.

This command only reads and copies files; it never runs a measurement or changes a result. Share this one zip to have the results checked.

---

## 8. Mapping: paper item → command → file

| Paper item | Command(s) | Result file(s) |
|---|---|---|
| Table III (per-operation gas, N = 100) | `candidate`, `measure-variants` | `candidate_results.json`, `variant_results.json` |
| Eqs. (1)–(2) | `measure-variants` | `variant_results.json` |
| 2×2 ablation (Sec. IV-B) | `ablation` | `ablation_results.json` |
| ZKP / ring / mixnet gas (Sec. IV-C, Eqs. 5–6) | `bench` | `precompile_bench_results.json` |
| Table IV, Fig. 3, Eq. (4) fit | `candidate`, `measure-variants`, `v2-n1000`, `scale`, `bench` | the five files above |
| Fig. 4, calldata (Sec. IV-E) | `calldata`, `calldata-v2` | `calldata_size_results.json`, `calldata_v2_results.json` |
| Fig. 5, timing (Sec. IV-E) | `latency-v2`, `latency` | `latency_v2_results.json`, `latency_results.json` |
| 103-check test suite (Sec. III) | `test-security` | `test_results.json` |
| All of the above, recomputed | `figures` | `figures/paper_numbers.md` |

---

## 9. Measurement setup and reproducibility

- **Chain:** Ganache 7 in-process (no separate node to start), Shanghai hardfork, deterministic wallet (same accounts every run), each transaction mined in its own block, raised block gas limit.
- **Compiler:** solc-js 0.8.20, optimizer enabled, 200 runs.
- **Gas** is read from each transaction receipt (`gasUsed`), which includes the 21,000 base cost and calldata cost.
- **Determinism:** voter secrets are fixed (`secret-<i>`) and accounts and candidate choices are the same on every run, so gas and calldata are exactly repeatable. Gas does not depend on the computer.
- **Commitment:** `keccak256(abi.encodePacked(uint256 candidateId, string secret))`.
- **Merkle tree:** sorted-pair hashing, leaf = `keccak256(abi.encodePacked(voterAddress))`; the tree is built off-chain in JavaScript and only the root is stored on-chain.
- **Timing** is wall-clock time of the JavaScript emulation on one machine. It is not network confirmation time, and native Ethereum clients execute the EC precompiles much faster.
- **Primitive benchmarks** measure verification execution cost only. They are not complete ZKP, ring-signature or mixnet voting systems.

---


## 11. Scope and limitations

- All measurements use a local in-process EVM. Throughput, confirmation time and congestion on a real multi-node PoA network were not evaluated.
- The protocol hides votes until reveal and makes the tally publicly recomputable. Reveals come from the voter's address, so it provides **no voter anonymity, unlinkability or receipt-freeness**. Voters who do not reveal are not counted.
- The administrator is trusted to build a correct eligibility tree and to run the phases; an honest validator majority is assumed.
- ZKP, ring-signature and mixnet results are primitive-level benchmarks for context, not complete or equivalent-privacy systems.
- `.gitignore` excludes `node_modules/`, all generated `*.json` results, `figures/` and `finalResults_bc.zip`, so the repository stays source-only.
