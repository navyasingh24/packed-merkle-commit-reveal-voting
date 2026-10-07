// Builds the paper's result figures (Fig. 3 total gas, Fig. 4 calldata, Fig. 5 latency) and a
// report of every reported number, using ONLY the result JSON files produced by the other
// scripts. Nothing is hard-coded: if a result file is missing, that output is skipped and the
// command that creates it is printed.
//
// Run after the measurement commands:   npm run figures
// Output folder figures/:
//   fig3_total_gas.svg / .csv     fig4_calldata.svg / .csv     fig5_latency.svg / .csv
//   pgfplots_coordinates.tex      (coordinates for the paper's pgfplots figures)
//   paper_numbers.md              (Tables III-IV, 2x2 ablation, Eq. (4) fit, calldata, latency, tests)
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "figures");
fs.mkdirSync(OUT, { recursive: true });
const load = (f) => {
  const p = path.join(__dirname, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};
const need = {
  "variant_results.json": "npm run measure-variants",
  "v2_n1000_result.json": "npm run v2-n1000",
  "gas_scale_results.json": "npm run scale",
  "candidate_results.json": "npm run candidate",
  "precompile_bench_results.json": "npm run bench",
  "calldata_size_results.json": "npm run calldata",
  "calldata_v2_results.json": "npm run calldata-v2",
  "latency_results.json": "npm run latency (or latency-cr / latency-ec / latency-mix)",
  "latency_v2_results.json": "npm run latency-v2",
  "ablation_results.json": "npm run ablation",
  "test_results.json": "npm run test-security",
};
const D = {};
for (const f of Object.keys(need)) D[f] = load(f);
const has = (...fs_) => fs_.every((f) => D[f] !== null);
const missingMsg = (...fs_) => fs_.filter((f) => !D[f]).map((f) => `${f} (run: ${need[f]})`).join(", ");

const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const keysN = (o) => Object.keys(o).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ------------------------------------------------------------------ SVG helpers
const FONT = 'font-family="Times New Roman, Times, serif" font-weight="bold"';
function niceStep(range, target = 5) {
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
}
function marker(shape, x, y, color) {
  const s = 5;
  if (shape === "square") return `<rect x="${x - s}" y="${y - s}" width="${2 * s}" height="${2 * s}" fill="${color}"/>`;
  if (shape === "triangle") return `<polygon points="${x},${y - s - 1} ${x - s - 1},${y + s} ${x + s + 1},${y + s}" fill="${color}"/>`;
  if (shape === "diamond") return `<polygon points="${x},${y - s - 2} ${x + s + 1},${y} ${x},${y + s + 2} ${x - s - 1},${y}" fill="${color}"/>`;
  if (shape === "open") return `<circle cx="${x}" cy="${y}" r="${s}" fill="white" stroke="${color}" stroke-width="2"/>`;
  return `<circle cx="${x}" cy="${y}" r="${s}" fill="${color}"/>`;
}
function legend(items, W, yTop) {
  // items: {name,color,shape,dash,line}
  const perRow = 3, colW = (W - 60) / perRow;
  return items.map((it, i) => {
    const x = 40 + (i % perRow) * colW, y = yTop + Math.floor(i / perRow) * 24;
    const line = it.line === false ? "" :
      `<line x1="${x}" y1="${y}" x2="${x + 34}" y2="${y}" stroke="${it.color}" stroke-width="2.5"${it.dash ? ' stroke-dasharray="6,4"' : ""}/>`;
    return `${line}${marker(it.shape, x + 17, y, it.color)}<text x="${x + 44}" y="${y + 5}" font-size="15" ${FONT}>${esc(it.name)}</text>`;
  }).join("\n");
}
function lineChart({ xLabel, yLabel, series, logY }) {
  const W = 760, H = 500, L = 100, R = 30, T = 30, B = 150;
  const pts = series.flatMap((s) => s.points);
  const xmaxRaw = Math.max(...pts.map((p) => p[0]));
  const xs = niceStep(xmaxRaw), xmax = Math.ceil(xmaxRaw / xs) * xs;
  const X = (x) => L + (x / xmax) * (W - L - R);
  let Y, yticks;
  if (logY) {
    const lo = Math.floor(Math.log10(Math.min(...pts.map((p) => p[1])))), hi = Math.ceil(Math.log10(Math.max(...pts.map((p) => p[1]))));
    Y = (v) => H - B - ((Math.log10(v) - lo) / (hi - lo)) * (H - B - T);
    yticks = []; for (let k = lo; k <= hi; k++) yticks.push({ v: Math.pow(10, k), exp: k });
  } else {
    const ymaxRaw = Math.max(...pts.map((p) => p[1])), st = niceStep(ymaxRaw), ymax = Math.ceil(ymaxRaw / st) * st;
    Y = (v) => H - B - (v / ymax) * (H - B - T);
    yticks = []; for (let v = 0; v <= ymax + 1e-9; v += st) yticks.push({ v, label: fmt(v) });
  }
  let g = "";
  for (const t of yticks) {
    g += `<line x1="${L}" y1="${Y(t.v)}" x2="${W - R}" y2="${Y(t.v)}" stroke="#ddd"/>`;
    g += t.exp === undefined
      ? `<text x="${L - 10}" y="${Y(t.v) + 5}" text-anchor="end" font-size="15" ${FONT}>${t.label}</text>\n`
      : `<text x="${L - 24}" y="${Y(t.v) + 6}" text-anchor="end" font-size="15" ${FONT}>10</text><text x="${L - 22}" y="${Y(t.v) - 2}" text-anchor="start" font-size="11" ${FONT}>${t.exp}</text>\n`;
  }
  for (let x = 0; x <= xmax + 1e-9; x += xs) g += `<line x1="${X(x)}" y1="${T}" x2="${X(x)}" y2="${H - B}" stroke="#ddd"/><text x="${X(x)}" y="${H - B + 22}" text-anchor="middle" font-size="15" ${FONT}>${fmt(x)}</text>\n`;
  g += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - B - T}" fill="none" stroke="black" stroke-width="1.2"/>\n`;
  g += `<text x="${(L + W - R) / 2}" y="${H - B + 50}" text-anchor="middle" font-size="18" ${FONT}>${esc(xLabel)}</text>\n`;
  g += `<text transform="translate(28,${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="18" ${FONT}>${esc(yLabel)}</text>\n`;
  for (const s of series) {
    const p = s.points.slice().sort((a, b) => a[0] - b[0]);
    if (s.line !== false && p.length > 1)
      g += `<polyline points="${p.map((q) => `${X(q[0])},${Y(q[1])}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5"${s.dash ? ' stroke-dasharray="6,4"' : ""}/>\n`;
    for (const q of p) g += marker(s.shape, X(q[0]), Y(q[1]), s.color) + "\n";
  }
  g += legend(series, W, H - B + 82);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="white"/>\n${g}</svg>\n`;
}
function barChart({ yLabel, bars }) {
  const W = 760, H = 430, L = 100, R = 30, T = 40, B = 80;
  const ymaxRaw = Math.max(...bars.map((b) => b.value)) * 1.12, st = niceStep(ymaxRaw), ymax = Math.ceil(ymaxRaw / st) * st;
  const Y = (v) => H - B - (v / ymax) * (H - B - T), slot = (W - L - R) / bars.length, bw = slot * 0.42;
  let g = "";
  for (let v = 0; v <= ymax + 1e-9; v += st) g += `<line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" stroke="#ddd"/><text x="${L - 10}" y="${Y(v) + 5}" text-anchor="end" font-size="15" ${FONT}>${fmt(v)}</text>\n`;
  bars.forEach((b, i) => {
    const cx = L + slot * (i + 0.5);
    g += `<rect x="${cx - bw / 2}" y="${Y(b.value)}" width="${bw}" height="${H - B - Y(b.value)}" fill="#5bc0eb" stroke="#1b6f9a"/>\n`;
    g += `<text x="${cx}" y="${Y(b.value) - 8}" text-anchor="middle" font-size="16" ${FONT}>${fmt(b.value)}</text>\n`;
    g += `<text x="${cx}" y="${H - B + 24}" text-anchor="middle" font-size="15" ${FONT}>${esc(b.label)}</text>\n`;
  });
  g += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - B - T}" fill="none" stroke="black" stroke-width="1.2"/>\n`;
  g += `<text transform="translate(30,${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="18" ${FONT}>${esc(yLabel)}</text>\n`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="white"/>\n${g}</svg>\n`;
}
const write = (name, content) => { fs.writeFileSync(path.join(OUT, name), content); console.log(`  wrote figures/${name}`); };
const csv = (rows) => rows.map((r) => r.join(",")).join("\n") + "\n";
const pgf = (pts) => pts.map(([x, y]) => `(${x},${y})`).join("");

// ------------------------------------------------------------------ derived data (all from JSON)
const report = [];
const pgfLines = ["% Coordinates generated by make_figures.js from the result JSON files."];
let proposedTotals = null, proposedPerVoter = null;

if (has("variant_results.json", "v2_n1000_result.json", "candidate_results.json")) {
  const V = D["variant_results.json"], K = D["v2_n1000_result.json"], C = D["candidate_results.json"];
  proposedTotals = keysN(V).map((N) => [N, V[N].v2.total + C.v2]).concat([[K.N, K.total + C.v2]]);
  proposedPerVoter = keysN(V).map((N) => [N, V[N].v2.total / N]).concat([[K.N, K.total / K.N]]);
}

// ------------------------------------------------------------------ Fig. 3: total gas vs N
console.log("Fig. 3 (total gas vs. N)");
if (proposedTotals && has("gas_scale_results.json", "precompile_bench_results.json")) {
  const S = D["gas_scale_results.json"], P = D["precompile_bench_results.json"];
  const zkp = P.zkpVerify["2"], ring = P.ringVerify["20"];
  const baseline = S.map((r) => [r.N, r.totalIncludingOneTimeCandidateReg]);
  const Ns = [...new Set(baseline.map((p) => p[0]).concat(proposedTotals.map((p) => p[0])))].sort((a, b) => a - b);
  const series = [
    { name: "Baseline CR", color: "#666", shape: "open", dash: true, points: baseline },
    { name: "Proposed CR", color: "#1f4fd1", shape: "circle", points: proposedTotals },
    { name: "ZKP (primitive)", color: "#d62728", shape: "square", points: Ns.map((N) => [N, zkp * N]) },
    { name: "Ring (primitive)", color: "#2a8a2a", shape: "triangle", points: Ns.map((N) => [N, ring * N]) },
  ];
  write("fig3_total_gas.svg", lineChart({ xLabel: "Number of Voters", yLabel: "Total Gas (log scale)", series, logY: true }));
  write("fig3_total_gas.csv", csv([["N", "baseline_total_gas", "proposed_total_gas", "zkp_l2_x_N", "ring_n20_x_N"],
    ...Ns.map((N) => [N, (baseline.find((p) => p[0] === N) || [, ""])[1], (proposedTotals.find((p) => p[0] === N) || [, ""])[1], zkp * N, ring * N])]));
  series.forEach((s) => pgfLines.push(`% Fig. 3 ${s.name}\n\\addplot coordinates {${pgf(s.points)}};`));
} else console.log("  skipped - missing: " + missingMsg("variant_results.json", "v2_n1000_result.json", "candidate_results.json", "gas_scale_results.json", "precompile_bench_results.json"));

// ------------------------------------------------------------------ Fig. 4: calldata per voter
console.log("Fig. 4 (calldata per voter)");
if (has("calldata_size_results.json", "calldata_v2_results.json")) {
  const C = D["calldata_size_results.json"], C2 = D["calldata_v2_results.json"];
  const prop = (N) => C2[N].commitVoteCalldataBytes + C2.revealVote_bytes;
  const bars = [
    { label: "Baseline", value: C.commitReveal_totalPerVoter_bytes, src: "commitVote + revealVote (actual ABI)" },
    { label: "Proposed", value: prop(100), src: "N=100: commitVote(c, proof) + revealVote (actual ABI)" },
    { label: "ZKP", value: C.zkpVerifyProof_bytes, src: "Groth16 proof + 2 public inputs (representative call)" },
    { label: "Ring", value: C.ringVerify_n20_bytes, src: "AOS signature, n=20 (representative call)" },
    { label: "Mixnet", value: Math.round(C.mixnetTotal_n100_bytes / 100), src: "ballot + shuffle payload amortized over n=100" },
  ];
  write("fig4_calldata.svg", barChart({ yLabel: "Bytes/voter", bars }));
  write("fig4_calldata.csv", csv([["scheme", "bytes_per_voter", "source"], ...bars.map((b) => [b.label, b.value, `"${b.src}"`])]));
  pgfLines.push(`% Fig. 4 bars\n\\addplot coordinates {${bars.map((b) => `(${b.label},${b.value})`).join(" ")}};`);
} else console.log("  skipped - missing: " + missingMsg("calldata_size_results.json", "calldata_v2_results.json"));

// ------------------------------------------------------------------ Fig. 5: latency
console.log("Fig. 5 (emulated latency)");
if (has("latency_results.json", "latency_v2_results.json")) {
  const Lt = D["latency_results.json"], L2 = D["latency_v2_results.json"];
  const toPts = (o) => (o ? keysN(o).filter((N) => typeof o[N] === "number").map((N) => [N, o[N]]) : []);
  const series = [
    { name: "Baseline CR", color: "#666", shape: "open", dash: true, points: toPts(Lt.commitReveal_ms) },
    { name: "Proposed CR", color: "#1f4fd1", shape: "circle", points: toPts(L2) },
    { name: "Ring (primitive)", color: "#c2185b", shape: "triangle", points: toPts(Lt.ringVerify_n20_ms) },
    { name: "Mixnet (1 round)", color: "#00897b", shape: "square", points: toPts(Lt.mixnetRound_ms) },
    { name: "ZKP (primitive)", color: "#d62728", shape: "diamond", line: false, points: toPts(Lt.zkpVerify_l2_ms) },
  ].filter((s) => s.points.length);
  write("fig5_latency.svg", lineChart({ xLabel: "Number of voters (N)", yLabel: "Latency (ms, log scale)", series, logY: true }));
  write("fig5_latency.csv", csv([["series", "N", "ms"], ...series.flatMap((s) => s.points.map((p) => [`"${s.name}"`, p[0], p[1]]))]));
  series.forEach((s) => pgfLines.push(`% Fig. 5 ${s.name}\n\\addplot coordinates {${pgf(s.points)}};`));
} else console.log("  skipped - missing: " + missingMsg("latency_results.json", "latency_v2_results.json"));

write("pgfplots_coordinates.tex", pgfLines.join("\n") + "\n");

// ------------------------------------------------------------------ paper_numbers.md
const r = (s) => report.push(s);
r("# Numbers recomputed from the result files\n");
r("Every value below is computed from the JSON result files in this folder (nothing hard-coded).\n");

if (has("variant_results.json", "candidate_results.json")) {
  const V = D["variant_results.json"], C = D["candidate_results.json"], b = V[100].baseline, p = V[100].v2, N = 100;
  r("## Table III (N=100, gas per voter unless noted)");
  r("| Component | Baseline | Proposed |\n|---|---|---|");
  r(`| Candidate reg. (once) | ${fmt(C.baseline)} | ${fmt(C.v2)} |`);
  r(`| Registration/eligibility | ${fmt(b.regGas / N)} per voter | ${fmt(p.regGas)} once (root) |`);
  r(`| Commit (avg) | ${fmt(b.commitGas / N)} | ${fmt(p.commitGas / N)} |`);
  r(`| Reveal (avg) | ${fmt(b.revealGas / N)} | ${fmt(p.revealGas / N)} |`);
  r(`| Per-voter total | ${fmt(b.total / N)} | ${fmt(p.total / N)} (${(100 * (p.total / b.total - 1)).toFixed(1)}%) |\n`);
  r(`Eq. (1): ${fmt(p.commitGas / N)} + ${fmt(p.revealGas / N)} = ${fmt(p.commitGas / N + p.revealGas / N)}  `);
  r(`Eq. (2): ${fmt(p.regGas)}/100 + ${fmt(p.commitGas / N + p.revealGas / N)} = ${fmt(p.regGas / N + p.commitGas / N + p.revealGas / N)}  `);
  const red = keysN(V).map((n) => 100 * (1 - V[n].v2.total / V[n].baseline.total));
  r(`Reduction across N=${keysN(V).join(",")}: ${Math.min(...red).toFixed(1)}-${Math.max(...red).toFixed(1)}%\n`);
}
if (has("ablation_results.json")) {
  const A = D["ablation_results.json"][100], N = 100, B = A.baseline.total / N, P = A.v1.total / N, M = A.v3.total / N, X = A.v2.total / N;
  r("## 2x2 ablation (N=100, per voter)");
  r(`baseline ${fmt(B)} | packed only ${fmt(P)} | Merkle only ${fmt(M)} | both ${fmt(X)}  `);
  r(`packing alone saves ${fmt(B - P)} (${(100 * (B - P) / B).toFixed(1)}%); Merkle alone saves ${fmt(B - M)} (${(100 * (B - M) / B).toFixed(1)}%); both save ${fmt(B - X)} (${(100 * (B - X) / B).toFixed(1)}%); interaction ${fmt((B - X) - (B - P) - (B - M))}  `);
  r(`commit: Merkle only ${fmt(A.v3.commitGas / N)}, both ${fmt(A.v2.commitGas / N)}; reveal change with packing ${(100 * (A.v1.revealGas / A.baseline.revealGas - 1)).toFixed(1)}%  `);
  r(`sanity checks all passed: ${Object.values(D["ablation_results.json"]).every((c) => Object.values(c).every((x) => x.sanity.outsiderRejected && x.sanity.tallyOk))}\n`);
}
if (proposedTotals && has("gas_scale_results.json", "precompile_bench_results.json")) {
  const S = D["gas_scale_results.json"], P = D["precompile_bench_results.json"], zkp = P.zkpVerify["2"], ring = P.ringVerify["20"];
  const M = (x) => (x / 1e6).toFixed(2) + "M";
  r("## Table IV (total gas incl. one-time setup)");
  r("| N | Baseline | Proposed | ZKP | Ring |\n|---|---|---|---|---|");
  for (const [N, t] of proposedTotals) { const bs = S.find((x) => x.N === N); r(`| ${N} | ${bs ? M(bs.totalIncludingOneTimeCandidateReg) : "-"} | ${M(t)} | ${M(zkp * N)} | ${M(ring * N)} |`); }
  const fitPts = proposedTotals.filter(([N]) => N >= 50), n = fitPts.length;
  const sx = fitPts.reduce((a, [x]) => a + x, 0), sy = fitPts.reduce((a, [, y]) => a + y, 0);
  const sxx = fitPts.reduce((a, [x]) => a + x * x, 0), sxy = fitPts.reduce((a, [x, y]) => a + x * y, 0);
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx), b0 = (sy - a * sx) / n;
  const devExact = Math.max(...fitPts.map(([x, y]) => Math.abs((a * x + b0 - y) / y)));
  const devShown = Math.max(...fitPts.map(([x, y]) => { const shown = Math.round(y / 1e4) * 1e4; return Math.abs((Math.round(a) * x + Math.round(b0) - shown) / shown); }));
  r(`\nEq. (4) least-squares fit (N>=50): G(N) = ${fmt(a, 2)}N ${b0 < 0 ? "-" : "+"} ${fmt(Math.abs(b0), 1)}; max deviation ${(100 * devExact).toFixed(2)}% (exact), ${(100 * devShown).toFixed(2)}% (vs. table values rounded to 0.01M)  `);
  if (proposedPerVoter) r(`Per-voter cost (excl. candidate reg.) range: ${fmt(Math.min(...proposedPerVoter.map((p) => p[1])))}-${fmt(Math.max(...proposedPerVoter.map((p) => p[1])))}  `);
  if (has("candidate_results.json", "variant_results.json")) r(`One-time setup (candidate reg. + Merkle root): ${fmt(D["candidate_results.json"].v2 + D["variant_results.json"][100].v2.regGas)}  `);
  const rn = keysN(P.ringVerify), rv = (k) => P.ringVerify[k];
  r(`\n## Primitive benchmarks\nZKP (l=2): ${fmt(zkp)} | ring n=${rn[0]}..${rn[rn.length - 1]}: ${fmt(rv(rn[0]))}..${fmt(rv(rn[rn.length - 1]))}, slope ${fmt((rv(rn[rn.length - 1]) - rv(rn[0])) / (rn[rn.length - 1] - rn[0]))} gas/member  `);
  if (proposedPerVoter) r(`ring(n=20)/proposed per-voter (N=100): ${(ring / proposedPerVoter.find((p) => p[0] === 100)[1]).toFixed(2)}x  `);
  const mx = P.mixnetRound, mk = keysN(mx).filter((k) => typeof mx[k] === "number");
  r(`mixnet round: ${mk.map((k) => `n=${k}: ${fmt(mx[k])}`).join(", ")}; per ciphertext at n=${mk[mk.length - 1]}: ${fmt(mx[mk[mk.length - 1]] / mk[mk.length - 1])}  `);
  if (mk.length >= 2) { const [k1, k2] = mk.slice(-2), sl = (mx[k2] - mx[k1]) / (k2 - k1); r(`n=1000 extrapolated from n=${k1}->${k2} slope: ${fmt(mx[k2] + (1000 - k2) * sl)} gas; n=1000 measured entry: ${mx[1000] ?? "-"}  `); }
}
if (has("calldata_size_results.json", "calldata_v2_results.json")) {
  const C = D["calldata_size_results.json"], C2 = D["calldata_v2_results.json"];
  r(`\n## Calldata (bytes)\nbaseline: commit ${C.commitVote_bytes} + reveal ${C.revealVote_bytes} = ${C.commitReveal_totalPerVoter_bytes} | ZKP ${C.zkpVerifyProof_bytes} | ring n=20 ${C.ringVerify_n20_bytes} | mixnet n=100 amortized ${(C.mixnetTotal_n100_bytes / 100).toFixed(1)}  `);
  r(`proposed: ${keysN(C2).map((N) => `N=${N}: proof ${C2[N].proofLen} hashes, commit ${C2[N].commitVoteCalldataBytes}, total ${C2[N].commitVoteCalldataBytes + C2.revealVote_bytes}`).join("; ")}  `);
}
if (has("latency_results.json", "latency_v2_results.json")) {
  const Lt = D["latency_results.json"], L2 = D["latency_v2_results.json"], cr = Lt.commitReveal_ms;
  r(`\n## Latency (machine-dependent)`);
  if (cr && cr[1000] && L2[1000]) r(`N=1000: proposed ${(L2[1000] / 1000).toFixed(1)} s, baseline ${(cr[1000] / 1000).toFixed(1)} s -> proposed ${(100 * (1 - L2[1000] / cr[1000])).toFixed(1)}% faster  `);
  if (Lt.ringVerify_n20_ms && Lt.ringVerify_n20_ms[100]) r(`ring (n=20): ${fmt(Lt.ringVerify_n20_ms[100] / 100)} ms/vote at N=100  `);
  if (Lt.zkpVerify_l2_ms && Lt.zkpVerify_l2_ms[10]) r(`ZKP (l=2): ${(Lt.zkpVerify_l2_ms[10] / 10 / 1000).toFixed(2)} s/vote at N=10  `);
}
if (has("test_results.json")) {
  const T = D["test_results.json"];
  r(`\n## Functional tests\n${T.passed}/${T.total} passed; ${Object.entries(T.bySuite).map(([k, v]) => `${k}: ${v.passed}`).join("; ")}`);
}
const missingAll = Object.keys(need).filter((f) => !D[f]);
if (missingAll.length) r(`\n## Not available yet\n${missingAll.map((f) => `- ${f}: run \`${need[f]}\``).join("\n")}`);
write("paper_numbers.md", report.join("\n") + "\n");
console.log("Done.");
