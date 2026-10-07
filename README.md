# Commit–reveal e-voting: final codebase (measurements, tests, figures)

This folder contains ONLY source code. No results and no figures are included: every result
file (`*.json`) and every figure (`figures/`) is created on YOUR machine by the commands below.
The figure script reads only those result files; nothing in it is hard-coded.

Contracts (`contracts/`):
- `AdvancedVoting.sol`   naive baseline (per-voter registration, separate fields)
- `AdvancedVotingV2.sol` PROPOSED contract (one packed slot per voter + Merkle-root eligibility)
- `AdvancedVotingV1.sol` 2x2 cell: packed slot, per-voter registration (measurement only)
- `AdvancedVotingV3.sol` 2x2 cell: unpacked state, Merkle eligibility (measurement only)
- `PrecompileBench.sol`  ZKP / ring-signature / mixnet primitive benchmarks (BN254 precompiles)

Gas and calldata results are deterministic (fixed accounts and secrets): you get exactly the
numbers listed below. Latency (milliseconds) depends on your computer.

## 0. One-time setup
1. Install Node.js LTS (20 or 22) from https://nodejs.org; check with `node -v`.
2. Unzip, open the folder in VS Code (File > Open Folder), open the terminal (Ctrl+`).
3. `npm install`
   - Ignore the "vulnerabilities" warning. NEVER run `npm audit fix` (it breaks ganache).
   - The message "µWS is not compatible ... Falling back to a NodeJS implementation" is harmless.

## 1. Compile (first; everything else needs these files)
| Command | Creates |
|---|---|
| `npm run compile` | `compiled.json` |
| `npm run compile-bench` | `compiled_bench.json` (a "state mutability" warning is harmless) |
| `npm run compile-variants` | `compiled_AdvancedVotingV1.json`, `compiled_AdvancedVotingV2.json` |
| `npm run compile-ablation` | `compiled_AdvancedVotingV3.json` |

## 2. Measurements (run in this order; times measured on a typical machine)
| Command | Creates | Paper | Expected (exact) | Time |
|---|---|---|---|---|
| `npm run candidate` | `candidate_results.json` | Table III (candidate reg.) | baseline 96,041; proposed 96,019 | seconds |
| `npm run measure-variants` | `variant_results.json` | Table III, Sec. IV-B, Table IV | N=100: baseline 167,612/voter, proposed 99,646/voter (−40.5%) | ~3 min |
| `npm run v2-n1000` | `v2_n1000_result.json` | Table IV / Fig. 3 (N=1000) | total 101,776,504 | ~1 min |
| `npm run scale` | `gas_scale_results.json` | Table IV / Fig. 3 (baseline) | 1,787,449 ... 167,565,517 | ~2 min |
| `npm run ablation` | `ablation_results.json` | Sec. IV-B 2x2 | N=100: packed only 140,122; Merkle only 146,180 | ~3 min |
| `npm run bench` | `precompile_bench_results.json` | Sec. IV-C, Table IV | ZKP 223,800; ring n=20 325,774; mixnet n=1000 `EXCEEDS BLOCK GAS LIMIT` | ~2–3 min |
| `npm run calldata` | `calldata_size_results.json` | Sec. IV-E, Fig. 4 | baseline 168; ZKP 388; ring 740 | seconds |
| `npm run calldata-v2` | `calldata_v2_results.json` | Sec. IV-E, Fig. 4 | commit 228 ... 420; total 456 at N=100 | seconds |
| `npm run test-security` | `test_results.json` | Sec. III-E | `TOTAL: 103/103 passed` | seconds |
| `npm run latency-v2` | `latency_v2_results.json` | Fig. 5 (proposed) | machine-dependent | ~2 min |
| `npm run latency-cr` | `latency_results.json` (baseline part) | Fig. 5 | machine-dependent | ~2 min |
| `npm run latency-ec` | `latency_results.json` (ring + ZKP part) | Fig. 5 | machine-dependent | ~2–3 min |
| `npm run latency-mix` | `latency_results.json` (mixnet part) | Fig. 5 | machine-dependent | ~1 min |

`npm run latency` runs latency-cr + latency-ec + latency-mix in one go (~6 min).
Optional: `npm run measure` -> `gas_results.json` (older 60-voter sample; not used in the paper).

## 3. Figures and paper numbers (last)
`npm run figures` reads the result files above and creates the folder `figures/`:
| File | What it is |
|---|---|
| `fig3_total_gas.svg` / `.csv` | Fig. 3: total gas vs. N (baseline, proposed, ZKP x N, ring x N) |
| `fig4_calldata.svg` / `.csv` | Fig. 4: calldata per voter |
| `fig5_latency.svg` / `.csv` | Fig. 5: emulated latency vs. N (from YOUR latency runs) |
| `pgfplots_coordinates.tex` | coordinates you can paste into the paper's pgfplots figures |
| `paper_numbers.md` | Tables III–IV, 2x2 ablation, Eq. (4) fit, primitive benchmarks, calldata, latency, tests — all recomputed from the results |

If a result file is missing, `npm run figures` skips the affected output and prints the command to run.
Open the `.svg` files in VS Code (or any browser).

## 4. Pack all results into one zip (very last)
`npm run results-zip` regenerates `figures/` from your result files and creates
`finalResults_bc.zip`, containing:
- every result `*.json` listed above,
- the whole `figures/` folder (SVG, CSV, `pgfplots_coordinates.tex`, `paper_numbers.md`),
- `manifest.json`: your Node/OS/CPU, the solc/ganache/ethers versions, SHA-256 of each contract
  and compiled bytecode, and a list of any result file that is missing (with the command that creates it).

It only reads and copies files; it does not run any measurement or change any result.
Send `finalResults_bc.zip` to have the numbers checked against the paper.

## Files created after running everything
compiled.json, compiled_bench.json, compiled_AdvancedVotingV1.json, compiled_AdvancedVotingV2.json,
compiled_AdvancedVotingV3.json, candidate_results.json, variant_results.json, v2_n1000_result.json,
gas_scale_results.json, ablation_results.json, precompile_bench_results.json,
calldata_size_results.json, calldata_v2_results.json, test_results.json, latency_v2_results.json,
latency_results.json, figures/ (and gas_results.json if you run `measure`), finalResults_bc.zip.

`.gitignore` excludes all generated files, `figures/` and `node_modules/` if you push to GitHub.
