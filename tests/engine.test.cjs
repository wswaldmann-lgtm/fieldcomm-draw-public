// Checks for the browser engine (docs/engine.js). Run: node tests/engine.test.cjs
const fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.join(__dirname, "..");
global.window = global;
global.polygonClipping = require(path.join(root, "docs/vendor/polygon-clipping.umd.min.js"));
global.jsyaml = require(path.join(root, "docs/vendor/js-yaml.min.js"));
require(path.join(root, "docs/engine.js"));
const D = global.FCDraw;
const load = (f) => D.parse(fs.readFileSync(path.join(root, "examples/spec", f), "utf8"));
const area = (mp) => mp.reduce((A, poly) => A + poly.reduce((a, ring, k) => {
  let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a + (k ? -1 : 1) * Math.abs(s / 2);
}, 0), 0);

(async () => {
  // 1. Same spec -> same fingerprint, every time
  for (const f of ["demo_cottage.yaml", "gate_test_adu.yaml"]) {
    const prints = new Set();
    for (let i = 0; i < 5; i++) prints.add(await D.fingerprint(D.buildWalls(load(f)).walls));
    assert.strictEqual(prints.size, 1, `${f}: fingerprint drifted`);
    console.log(`PASS  deterministic   ${f}  ${[...prints][0].slice(0, 16)}`);
  }
  // 2. Wall area matches the full engine's reference values (sq ft)
  for (const [f, ref] of [["demo_cottage.yaml", 117.121284], ["gate_test_adu.yaml", 50.146424]]) {
    const a = area(D.buildWalls(load(f)).walls);
    assert.ok(Math.abs(a - ref) < 1e-4, `${f}: wall area ${a} != ${ref}`);
    console.log(`PASS  wall area       ${f}  ${a.toFixed(6)} sf`);
  }
  // 3. Gate: the cottage releases at Tier 2, the non-compliant ADU is held
  assert.ok(D.validate(load("demo_cottage.yaml"), 2).released);
  assert.ok(!D.validate(load("gate_test_adu.yaml"), 2).released);
  console.log("PASS  gate            cottage released, ADU held");
  // 4. Dimension strings: a chain that doesn't add up is refused
  const s = load("demo_cottage.yaml");
  assert.ok(D.checkChains(s).every((c) => c.closes));
  s.dim_chains[0].segments = [12, 8, 17];
  assert.ok(!D.checkChains(s)[0].closes);
  console.log("PASS  dim strings     12+8+18=38 drawn, 12+8+17 refused");
  console.log("\nALL CHECKS PASS");
})().catch((e) => { console.error("FAIL ", e.message); process.exit(1); });
