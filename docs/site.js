/* FieldComm Draw demo — Test 4: site plan with live setbacks.
 * Every distance is measured edge to edge between real polygons (feet),
 * never center to center and never off the pixels. */
(function () {
  "use strict";
  const D = window.FCDraw, PC = window.polygonClipping;
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const svg = $("siteSvg");
  if (!svg) return;

  const SITE_TEXT = `# Example lot (fictional). Units: feet. Origin = SW lot corner, north up.
# Setback values are EXAMPLES - use your jurisdiction's numbers.
lot: [[0, 0], [220, 0], [220, 120], [150, 170], [0, 170]]
edges: [front, side, side, rear, side]      # one per lot line, in order
setbacks: {front: 25, side: 10, rear: 20}   # building setbacks
pond: [[175, 115], [200, 108], [212, 118], [195, 135], [178, 132]]
rules:
  well_to_drainfield: 75
  drainfield_to_water: 75
  drainfield_to_building: 5
  drainfield_to_line: 10
  well_to_line: 10
  no_drive_shoulder: 5     # keep vehicles this far off the drainfield
  well_keep_clear: 10      # radius around the well
items:
  - {id: house, kind: building,   label: "House",      x: 70,  y: 70,  w: 50, h: 35, rot: 0}
  - {id: df,    kind: drainfield, label: "Drainfield", x: 130, y: 30,  w: 40, h: 25, rot: 0}
  - {id: well,  kind: well,       label: "Well",       x: 30,  y: 140}
`;

  // ---------- geometry (feet) ----------
  const rad = (a) => (a * Math.PI) / 180;
  function itemPoly(it) {
    if (it.kind === "well") return [[it.x, it.y]];
    const c = Math.cos(rad(it.rot || 0)), s = Math.sin(rad(it.rot || 0)), hw = it.w / 2, hh = it.h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [it.x + c * u - s * v, it.y + s * u + c * v]);
  }
  function closestOnSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return [a[0] + t * dx, a[1] + t * dy];
  }
  function inside(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[j];
      if ((y1 > p[1]) !== (y2 > p[1]) && p[0] < ((x2 - x1) * (p[1] - y1)) / (y2 - y1) + x1) c = !c;
    }
    return c;
  }
  function segsCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  const edgesOf = (P) => (P.length === 1 ? [[P[0], P[0]]] : P.map((p, i) => [p, P[(i + 1) % P.length]]));
  // Edge-to-edge distance between two shapes (a point is a 1-vertex shape) + the two closest points.
  function shapeDist(A, B) {
    if (A.length > 2 && B.some((p) => inside(p, A))) return { d: 0, a: B.find((p) => inside(p, A)), b: B.find((p) => inside(p, A)), overlap: true };
    if (B.length > 2 && A.some((p) => inside(p, B))) return { d: 0, a: A.find((p) => inside(p, B)), b: A.find((p) => inside(p, B)), overlap: true };
    for (const [a, b] of edgesOf(A)) for (const [c, d] of edgesOf(B)) if (segsCross(a, b, c, d)) return { d: 0, a, b: a, overlap: true };
    let best = { d: Infinity };
    const test = (p, seg, flip) => {
      const q = closestOnSeg(p, seg[0], seg[1]), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < best.d) best = flip ? { d, a: q, b: p } : { d, a: p, b: q };
    };
    for (const p of A) for (const e of edgesOf(B)) test(p, e, false);
    for (const p of B) for (const e of edgesOf(A)) test(p, e, true);
    return best;
  }
  // Distance from a shape to the nearest lot line (negative if any part is outside the lot).
  function lineDist(P, lot, idxs) {
    const out = P.find((p) => !inside(p, lot));
    let best = { d: Infinity };
    lot.forEach((p, i) => {
      if (idxs && !idxs.includes(i)) return;
      const r = shapeDist(P, [p, lot[(i + 1) % lot.length]]);
      if (r.d < best.d) best = Object.assign(r, { edge: i });
    });
    if (out) best = Object.assign(best, { d: -best.d || -0.0001, outside: true });
    return best;
  }
  // Building envelope: the lot clipped by every line moved inward by its setback (convex lot).
  function envelope(site) {
    const L = site.lot, BIG = 1e4;
    let env = [[L.concat([L[0]])]];
    L.forEach((a, i) => {
      const b = L[(i + 1) % L.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      const u = [dx / len, dy / len], n = [-u[1], u[0]], d = site.setbacks[site.edges[i]] || 0;
      const p = [a[0] + n[0] * d, a[1] + n[1] * d];
      const q = [
        [p[0] - u[0] * BIG, p[1] - u[1] * BIG], [p[0] + u[0] * BIG, p[1] + u[1] * BIG],
        [p[0] + u[0] * BIG + n[0] * BIG, p[1] + u[1] * BIG + n[1] * BIG], [p[0] - u[0] * BIG + n[0] * BIG, p[1] - u[1] * BIG + n[1] * BIG],
      ];
      env = PC.intersection(env, [[q.concat([q[0]])]]);
    });
    return env;
  }

  // ---------- construction logistics (to scale, feet) ----------
  const LOGI = {
    parking: { name: "Crew parking", w: 9, h: 18, color: "#5aa0e6" },
    truck: { name: "Delivery truck", w: 8, h: 35, color: "#9aa7b3" },
    staging: { name: "Material staging", w: 20, h: 30, color: "#b9b2a6" },
    dumpster: { name: "Dumpster 20 yd", w: 8, h: 22, color: "#9a5a2a" },
    toilet: { name: "Porta-john", w: 4, h: 4, color: "#29a27c" },
  };
  function noDrive(site) {
    const Z = [], R = site.rules;
    for (const f of site.items.filter((i) => i.kind === "drainfield")) {
      const g = R.no_drive_shoulder == null ? 5 : R.no_drive_shoulder;
      Z.push({ name: `${f.label} + ${D.ftin(g)} shoulder`, poly: itemPoly({ x: f.x, y: f.y, w: f.w + 2 * g, h: f.h + 2 * g, rot: f.rot }) });
    }
    for (const w of site.items.filter((i) => i.kind === "well")) {
      const r = R.well_keep_clear == null ? 10 : R.well_keep_clear;
      Z.push({ name: `${w.label} ${D.ftin(r)} keep-clear`, poly: Array.from({ length: 32 }, (_, k) => [w.x + r * Math.cos((k * Math.PI) / 16), w.y + r * Math.sin((k * Math.PI) / 16)]) });
    }
    return Z;
  }
  function logisticsChecks(site) {
    const L = site.items.filter((i) => i.kind === "logistics"), zones = noDrive(site), out = [];
    const hits = (A, B) => shapeDist(A, B).overlap;
    L.forEach((it, k) => {
      const P = itemPoly(it), why = [];
      if (P.some((p) => !inside(p, site.lot))) why.push("outside the lot");
      for (const z of zones) if (hits(P, z.poly)) why.push(`on the no-drive zone (${z.name})`);
      if (site.pond && hits(P, site.pond)) why.push("in the pond");
      for (const b of site.items.filter((i) => i.kind === "building" || i.kind === "drainfield"))
        if (hits(P, itemPoly(b))) why.push(`on the ${b.label.toLowerCase()}`);
      L.forEach((o, j) => { if (j !== k && hits(P, itemPoly(o))) why.push(`overlaps ${o.label}`); });
      out.push({ id: "lg-" + it.id, a: it.id, label: it.label, logistics: true, why, pass: !why.length, r: {} });
    });
    return out;
  }

  // ---------- rules ----------
  function check(site) {
    const by = (k) => site.items.find((i) => i.kind === k);
    const H = by("building"), F = by("drainfield"), W = by("well");
    const P = (it) => (it ? itemPoly(it) : null), R = site.rules, out = [];
    if (H) {
      // building vs each lot line, each with its own setback
      let worst = null;
      site.lot.forEach((p, i) => {
        const need = site.setbacks[site.edges[i]] || 0, r = lineDist(P(H), site.lot, [i]);
        const margin = r.d - need;
        if (!worst || margin < worst.margin) worst = Object.assign(r, { need, margin, kind: site.edges[i] });
      });
      out.push({ id: "bset", a: H.id, b: "lot", label: `${H.label} → ${worst.kind} line`, min: worst.need, r: worst });
    }
    if (W && F) out.push({ id: "wdf", a: W.id, b: F.id, label: `${W.label} → ${F.label}`, min: R.well_to_drainfield, r: shapeDist(P(W), P(F)), cc: Math.hypot(W.x - F.x, W.y - F.y) });
    if (F && site.pond) out.push({ id: "dfw", a: F.id, b: "pond", label: `${F.label} → pond (surface water)`, min: R.drainfield_to_water, r: shapeDist(P(F), site.pond) });
    if (F && H) out.push({ id: "dfb", a: F.id, b: H.id, label: `${F.label} → ${H.label}`, min: R.drainfield_to_building, r: shapeDist(P(F), P(H)) });
    if (F) out.push({ id: "dfl", a: F.id, b: "lot", label: `${F.label} → property line`, min: R.drainfield_to_line, r: lineDist(P(F), site.lot) });
    if (W) out.push({ id: "wl", a: W.id, b: "lot", label: `${W.label} → property line`, min: R.well_to_line, r: lineDist(P(W), site.lot) });
    if (H && site.pond) out.push({ id: "bw", a: H.id, b: "pond", label: `${H.label} → pond`, min: 0.01, r: shapeDist(P(H), site.pond), noOverlapOnly: true });
    out.forEach((c) => { c.pass = !c.r.outside && !c.r.overlap && c.r.d + 1e-9 >= c.min; });
    return out.concat(logisticsChecks(site));
  }

  // ---------- spec <-> state ----------
  const r2 = (v) => Math.round(v * 100) / 100;
  function parse(text) {
    const s = window.jsyaml.load(text);
    if (!s || !Array.isArray(s.lot) || s.lot.length < 3) throw new Error("lot: needs at least 3 corner points.");
    if (!Array.isArray(s.edges) || s.edges.length !== s.lot.length) throw new Error("edges: needs one entry per lot line.");
    if (!Array.isArray(s.items)) throw new Error("items: list is missing.");
    s.items.forEach((it) => {
      ["x", "y"].forEach((k) => { if (typeof it[k] !== "number") throw new Error(`${it.label || it.id}: ${k} must be a number.`); });
      if (it.kind !== "well" && !(it.w > 0 && it.h > 0)) throw new Error(`${it.label || it.id}: w and h must be positive.`);
      if (it.kind === "logistics" && !LOGI[it.type]) throw new Error(`${it.label || it.id}: type must be one of ${Object.keys(LOGI).join(", ")}.`);
    });
    s.setbacks = s.setbacks || {}; s.rules = s.rules || {};
    return s;
  }
  const fl = (o) => "{" + Object.entries(o).map(([k, v]) => `${k}: ${typeof v === "string" ? (/^[a-z_]+$/i.test(v) ? v : JSON.stringify(v)) : v}`).join(", ") + "}";
  function toYAML(s) {
    const pts = (P) => "[" + P.map((p) => `[${r2(p[0])}, ${r2(p[1])}]`).join(", ") + "]";
    const L = ["# Example lot (fictional). Units: feet. Origin = SW lot corner, north up.", "# Setback values are EXAMPLES - use your jurisdiction's numbers."];
    L.push(`lot: ${pts(s.lot)}`, `edges: [${s.edges.join(", ")}]`, `setbacks: ${fl(s.setbacks)}`);
    if (s.pond) L.push(`pond: ${pts(s.pond)}`);
    L.push("rules:"); for (const k in s.rules) L.push(`  ${k}: ${s.rules[k]}`);
    L.push("items:");
    for (const it of s.items) {
      const o = { id: it.id, kind: it.kind };
      if (it.type) o.type = it.type;
      Object.assign(o, { label: it.label, x: r2(it.x), y: r2(it.y) });
      if (it.kind !== "well") Object.assign(o, { w: r2(it.w), h: r2(it.h), rot: r2(it.rot || 0) });
      L.push("  - " + fl(o));
    }
    return L.join("\n") + "\n";
  }

  // ---------- drawing ----------
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const pathOf = (P) => "M" + P.map((p) => `${p[0]} ${-p[1]}`).join("L") + "Z";
  let state = null, sel = "house", drag = null, vb = null, history = [];
  const ta = $("siteText");

  function viewBox(s) {
    const xs = s.lot.map((p) => p[0]), ys = s.lot.map((p) => p[1]), m = 22;
    return [Math.min(...xs) - m, -(Math.max(...ys) + m), Math.max(...xs) - Math.min(...xs) + 2 * m, Math.max(...ys) - Math.min(...ys) + 2 * m];
  }
  const KIND = {
    building: "fill:var(--bldg-fill);stroke:var(--wall)",
    drainfield: "fill:var(--df-fill);stroke:var(--df)",
  };
  // Rotate handle: a knob above the selected item's top edge, in the item's own frame.
  function rotHandle(s) {
    const it = s.items.find((i) => i.id === sel);
    if (!it || it.kind === "well" || !vb) return null;
    const a = rad(it.rot || 0), off = it.h / 2 + vb[2] / 22, r = vb[2] / 70;
    const top = [it.x - Math.sin(a) * (it.h / 2), it.y + Math.cos(a) * (it.h / 2)];
    return { it, r, top, p: [it.x - Math.sin(a) * off, it.y + Math.cos(a) * off] };
  }
  function draw(s, checks) {
    svg.innerHTML = "";
    if (!vb) vb = viewBox(s);
    svg.setAttribute("viewBox", vb.join(" "));
    const sw = vb[2] / 450, fs = vb[2] / 40;
    const text = (x, y, str, style, anchor = "middle") => { const t = el("text", { x, y: -y, "text-anchor": anchor, style: `font:500 ${fs}px var(--mono);${style}` }, svg); t.textContent = str; return t; };
    // street along the front line(s)
    s.lot.forEach((a, i) => {
      if (s.edges[i] !== "front") return;
      const b = s.lot[(i + 1) % s.lot.length];
      text((a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 15, "STREET (example)", "fill:var(--muted);letter-spacing:.1em");
    });
    el("path", { d: pathOf(s.lot), style: `fill:var(--lot);stroke:var(--wall);stroke-width:${sw * 2.2}` }, svg);
    drawUnderlay(sw, fs);
    // envelope
    for (const poly of envelope(s)) for (const ring of poly)
      el("path", { d: pathOf(ring.slice(0, -1)), style: `fill:none;stroke:var(--muted);stroke-width:${sw};stroke-dasharray:${sw * 6} ${sw * 4}` }, svg);
    if (s.pond) {
      el("path", { d: pathOf(s.pond), style: `fill:var(--water);stroke:var(--glass);stroke-width:${sw * 1.4}` }, svg);
      const c = s.pond.reduce((a, p) => [a[0] + p[0] / s.pond.length, a[1] + p[1] / s.pond.length], [0, 0]);
      text(c[0], c[1] - fs * 0.3, "POND", "fill:var(--glass);font-size:" + fs * 0.8 + "px");
    }
    // no-drive zones
    for (const z of noDrive(s)) el("path", { d: pathOf(z.poly), style: `fill:var(--block-bg);fill-opacity:.7;stroke:var(--block);stroke-width:${sw};stroke-dasharray:${sw * 3} ${sw * 2}` }, svg);
    // lot line lengths (from the coordinates)
    s.lot.forEach((a, i) => {
      const b = s.lot[(i + 1) % s.lot.length], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      const dx = b[0] - a[0], dy = b[1] - a[1], n = [dy / len, -dx / len]; // outward for CCW
      const px = mx + n[0] * 6, py = my + n[1] * 6;
      const t = text(px, py, D.ftin(len), "fill:var(--muted);font-size:" + fs * 0.75 + "px");
      const rot = ang > 90 || ang < -90 ? ang + 180 : ang;
      t.setAttribute("transform", `rotate(${-rot} ${px} ${-py})`);
      t.setAttribute("dominant-baseline", "middle");
    });
    // items
    for (const it of s.items) {
      const isSel = it.id === sel;
      if (it.kind === "well") {
        el("circle", { cx: it.x, cy: -it.y, r: 2.4, style: `fill:var(--sheet);stroke:var(--glass);stroke-width:${sw * 2.2}` }, svg);
        el("circle", { cx: it.x, cy: -it.y, r: 0.9, style: "fill:var(--glass)" }, svg);
        if (isSel) el("circle", { cx: it.x, cy: -it.y, r: 4.5, style: `fill:none;stroke:var(--gold);stroke-width:${sw * 2}` }, svg);
        text(it.x, it.y + 5, it.label, "fill:var(--glass);font-weight:600");
        continue;
      }
      if (it.kind === "logistics") {
        const bad = checks.some((c) => c.a === it.id && c.logistics && !c.pass);
        el("path", { d: pathOf(itemPoly(it)), style: `fill:${LOGI[it.type].color};fill-opacity:.85;stroke:${isSel ? "var(--gold)" : bad ? "var(--block)" : "var(--wall)"};stroke-width:${sw * (isSel || bad ? 2.6 : 0.8)}` }, svg);
        if (Math.max(it.w, it.h) >= 8) {
          const vert = it.h > it.w * 1.4, t = text(it.x, it.y - fs * 0.2, it.label, `fill:#1d2522;font-weight:600;font-size:${fs * 0.55}px`);
          t.setAttribute("transform", `rotate(${-(it.rot || 0) - (vert ? 90 : 0)} ${it.x} ${-it.y})`);
        }
        continue;
      }
      el("path", { d: pathOf(itemPoly(it)), style: `${KIND[it.kind]};stroke-width:${sw * (isSel ? 3 : 1.6)};${isSel ? "stroke:var(--gold)" : ""}` }, svg);
      const t = text(it.x, it.y - fs * 0.35, it.label, "fill:var(--wall);font-weight:600");
      t.setAttribute("transform", `rotate(${-(it.rot || 0)} ${it.x} ${-it.y})`);
    }
    // measured clearances: selected item's rules, plus every failure
    for (const c of checks) {
      if (!c.r.a || (c.noOverlapOnly && c.pass) || !(c.a === sel || c.b === sel || !c.pass)) continue;
      const col = c.pass ? "var(--fact)" : "var(--block)";
      el("line", { x1: c.r.a[0], y1: -c.r.a[1], x2: c.r.b[0], y2: -c.r.b[1], style: `stroke:${col};stroke-width:${sw * 1.6};stroke-dasharray:${sw * 4} ${sw * 3}` }, svg);
      [c.r.a, c.r.b].forEach((p) => el("circle", { cx: p[0], cy: -p[1], r: sw * 3, style: `fill:${col}` }, svg));
      const mx = (c.r.a[0] + c.r.b[0]) / 2, my = (c.r.a[1] + c.r.b[1]) / 2;
      const lab = c.r.outside ? "OUTSIDE" : c.r.overlap ? "OVERLAP" : D.ftin(c.r.d);
      const t = text(mx + fs * 0.4, my + fs * 0.3, lab, `fill:${col};font-weight:700;paint-order:stroke;stroke:var(--sheet);stroke-width:${fs * 0.25}px`, "start");
    }
    // rotate handle on the selected item
    const rh = rotHandle(s);
    if (rh) {
      el("line", { x1: rh.top[0], y1: -rh.top[1], x2: rh.p[0], y2: -rh.p[1], style: `stroke:var(--gold);stroke-width:${sw * 1.6}` }, svg);
      el("circle", { cx: rh.p[0], cy: -rh.p[1], r: rh.r, style: `fill:var(--gold);stroke:var(--sheet);stroke-width:${sw}` }, svg);
      const t = el("text", { x: rh.p[0], y: -rh.p[1], "text-anchor": "middle", "dominant-baseline": "central", style: `font:700 ${rh.r * 1.5}px var(--body);fill:#0D1B2A;pointer-events:none` }, svg);
      t.textContent = "⟳";
    }
    // north arrow
    const nx = vb[0] + vb[2] - fs * 1.5, ny = -(vb[1] + fs * 3.2);
    el("path", { d: `M${nx} ${-(ny + fs * 1.6)}L${nx - fs * 0.5} ${-ny}L${nx + fs * 0.5} ${-ny}Z`, style: "fill:var(--wall)" }, svg);
    text(nx, ny - fs * 1.1, "N", "fill:var(--wall);font-weight:700");
  }

  function facts(ul, rows) {
    const MARK = { f: "🟢 FACT", i: "🟡 INTERP", b: "🔴 BLOCKED" };
    ul.innerHTML = "";
    for (const [k, html] of rows) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="tm ${k}">${MARK[k]}</span><span>${html}</span>`;
      ul.appendChild(li);
    }
  }
  function report(s, checks) {
    const rows = checks.filter((c) => !c.logistics && (!c.noOverlapOnly || !c.pass)).map((c) => {
      const val = c.r.outside ? "outside the lot" : c.r.overlap ? "overlapping" : `<span class="num">${D.ftin(c.r.d)}</span> edge to edge`;
      const need = c.noOverlapOnly ? "must not overlap" : `min <span class="num">${D.ftin(c.min)}</span>`;
      return [c.pass ? "f" : "b", `${c.pass ? "PASS" : "FAIL"} · ${c.label}: ${val} (${need})`];
    });
    const wdf = checks.find((c) => c.id === "wdf");
    if (wdf && !wdf.r.overlap) rows.push(["i", `Measured center to center, ${wdf.label.toLowerCase()} would read <span class="num">${D.ftin(wdf.cc)}</span> — <span class="num">${D.ftin(wdf.cc - wdf.r.d)}</span> more clearance than really exists`]);
    const lg = checks.filter((c) => c.logistics);
    for (const c of lg.filter((c) => !c.pass)) rows.push(["b", `FAIL · ${c.label}: ${c.why.join("; ")}`]);
    if (lg.length) {
      const ok = lg.filter((c) => c.pass).length, n = (t) => s.items.filter((i) => i.type === t).length;
      if (ok) rows.push(["f", `${ok} of ${lg.length} logistics items clear of no-drive zones, pond, buildings and each other`]);
      rows.push(["f", `On site: ${n("parking")} crew parking · ${n("truck")} truck · ${n("staging")} staging · ${n("dumpster")} dumpster · ${n("toilet")} porta-john`]);
    }
    facts($("siteFacts"), rows);
    const fails = checks.filter((c) => !c.pass).length;
    $("siteStatus").textContent = fails ? `${fails} fail${fails > 1 ? "s" : ""} · held` : "all checks pass";
    const it = s.items.find((i) => i.id === sel);
    $("siteInfo").textContent = it
      ? `🟢 ${it.label} center at (${D.ftin(it.x)}, ${D.ftin(it.y)})${it.kind !== "well" ? ` · ${D.ftin(it.w)} × ${D.ftin(it.h)} · rotated ${r2(it.rot || 0)}°` : ""}`
      : "Drag the house, drainfield, well or any logistics item. Select one to rotate it.";
    const rotOK = it && it.kind !== "well";
    ["siteDup", "siteDel"].forEach((id) => { $(id).disabled = !(it && it.kind === "logistics"); });
    ["rotL", "rotR", "rotSlider"].forEach((id) => { $(id).disabled = !rotOK; });
    if (rotOK) $("rotSlider").value = it.rot || 0;
  }

  function render(s, writeText) {
    const checks = check(s);
    draw(s, checks);
    report(s, checks);
    if (writeText) ta.value = toYAML(s);
    persistSoon();
  }
  function fromText() {
    try { state = parse(ta.value); $("siteErr").hidden = true; render(state, false); }
    catch (ex) { $("siteErr").hidden = false; $("siteErr").textContent = "🔴 BLOCKED — " + (ex.reason || ex.message); }
  }

  // ---------- interaction ----------
  const snap = () => +$("siteSnap").value;
  const snapV = (v) => r2(Math.round(v / snap()) * snap());
  function toWorld(ev) {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [q.x, -q.y];
  }
  function hit(p) {
    const tol = Math.max(10 * (vb[2] / svg.getBoundingClientRect().width), 3);
    const items = state.items.slice().reverse();
    for (const it of items) if (it.kind === "well" && Math.hypot(p[0] - it.x, p[1] - it.y) <= tol) return it;
    for (const it of items) if (it.kind !== "well" && inside(p, itemPoly(it))) return it;
    return null;
  }
  function pushHistory() { history.push(ta.value); if (history.length > 50) history.shift(); $("siteUndo").disabled = false; }
  svg.addEventListener("pointerdown", (ev) => {
    if (!state) return;
    if (U.mode) { ulDown(ev); return; }
    const p = toWorld(ev), rh = rotHandle(state);
    if (rh && Math.hypot(p[0] - rh.p[0], p[1] - rh.p[1]) <= rh.r * 1.8) {
      ev.preventDefault(); svg.setPointerCapture(ev.pointerId);
      drag = { id: rh.it.id, rotate: true, before: ta.value, moved: false };
      return;
    }
    const it = hit(p);
    sel = it ? it.id : null;
    if (it) {
      ev.preventDefault(); svg.setPointerCapture(ev.pointerId);
      drag = { id: it.id, dx: it.x - p[0], dy: it.y - p[1], before: ta.value, moved: false };
    }
    render(state, false);
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!state) return;
    if (U.mode) { ulMove(ev); return; }
    if (!drag) {
      if (ev.pointerType !== "mouse") return;
      const pw = toWorld(ev), rh = rotHandle(state);
      svg.style.cursor = rh && Math.hypot(pw[0] - rh.p[0], pw[1] - rh.p[1]) <= rh.r * 1.8 ? "grab" : hit(pw) ? "move" : "default";
      return;
    }
    const p = toWorld(ev), it = state.items.find((i) => i.id === drag.id);
    if (drag.rotate) { // angle of the pointer around the item's center; 5° steps, Shift for 1°
      const step = ev.shiftKey ? 1 : 5, deg = (Math.atan2(p[1] - it.y, p[0] - it.x) * 180) / Math.PI - 90;
      it.rot = ((Math.round(deg / step) * step + 540) % 360) - 180; drag.moved = true;
      render(state, true);
      return;
    }
    it.x = snapV(p[0] + drag.dx); it.y = snapV(p[1] + drag.dy); drag.moved = true;
    render(state, true);
  });
  function end() {
    ulDrag = null;
    if (drag && drag.moved && drag.before !== ta.value) { history.push(drag.before); $("siteUndo").disabled = false; }
    drag = null;
  }
  svg.setAttribute("tabindex", "0");
  svg.addEventListener("keydown", (ev) => {
    const it = state && state.items.find((i) => i.id === sel); if (!it) return;
    const n = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key];
    if (n) { ev.preventDefault(); pushHistory(); it.x = snapV(it.x + n[0] * snap()); it.y = snapV(it.y + n[1] * snap()); render(state, true); }
    else if ((ev.key === "r" || ev.key === "R") && it.kind !== "well") { ev.preventDefault(); rotate((it.rot || 0) + (ev.shiftKey ? -15 : 15)); }
    else if ((ev.key === "Delete" || ev.key === "Backspace") && it.kind === "logistics") { ev.preventDefault(); $("siteDel").click(); }
  });
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  function rotate(to) {
    const it = state && state.items.find((i) => i.id === sel);
    if (!it || it.kind === "well") return;
    pushHistory();
    it.rot = ((to + 540) % 360) - 180;
    render(state, true);
  }
  $("rotL").addEventListener("click", () => { const it = state.items.find((i) => i.id === sel); if (it) rotate((it.rot || 0) + 15); });
  $("rotR").addEventListener("click", () => { const it = state.items.find((i) => i.id === sel); if (it) rotate((it.rot || 0) - 15); });
  $("rotSlider").addEventListener("input", (e) => {
    const it = state.items.find((i) => i.id === sel); if (!it || it.kind === "well") return;
    it.rot = +e.target.value; render(state, true);
  });
  $("rotSlider").addEventListener("pointerdown", pushHistory);
  $("siteUndo").addEventListener("click", () => { if (!history.length) return; ta.value = history.pop(); $("siteUndo").disabled = !history.length; fromText(); });
  $("siteReset").addEventListener("click", () => { pushHistory(); ta.value = SITE_TEXT; vb = null; sel = "house"; fromText(); });
  let timer, focusVal = null;
  ta.addEventListener("focus", () => { focusVal = ta.value; });
  ta.addEventListener("change", () => { if (focusVal != null && focusVal !== ta.value) { history.push(focusVal); $("siteUndo").disabled = false; } focusVal = ta.value; });
  ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(fromText, 250); });
  $("siteReport").addEventListener("click", () => {
    if (!state) return;
    const checks = check(state), L = ["FieldComm Draw — site check (example lot, fictional)", `Generated ${new Date().toISOString()}`, ""];
    L.push("POSITIONS (feet, origin SW lot corner)");
    for (const it of state.items) L.push(`  ${it.label.padEnd(12)} (${r2(it.x)}, ${r2(it.y)})${it.kind !== "well" ? `  ${it.w}x${it.h}  rot ${r2(it.rot || 0)}°` : ""}`);
    L.push("", "CHECKS (edge to edge)");
    for (const c of checks) L.push(`  [${c.pass ? "PASS" : "FAIL"}] ${c.label}: ${c.r.outside ? "outside lot" : c.r.overlap ? "overlap" : r2(c.r.d) + " ft"}${c.noOverlapOnly ? "" : ` (min ${c.min} ft)`}`);
    L.push("", "TO BE VERIFIED", ...[...document.querySelectorAll("#siteVerify li")].map((li) => "  - " + li.textContent), "", "Schematic only. Not for construction or permitting.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([L.join("\n") + "\n"], { type: "text/plain" }));
    a.download = "fieldcomm-site-check.txt"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // palette: add to-scale logistics items
  let uid = 0;
  const newId = (t) => { let id; do { id = `${t}${++uid}`; } while (state.items.some((i) => i.id === id)); return id; };
  function addLogi(type, from) {
    if (!state) return;
    pushHistory();
    const t = LOGI[type], n = state.items.filter((i) => i.kind === "logistics").length;
    const it = from ? Object.assign({}, from, { id: newId(type), x: snapV(from.x + 12), y: snapV(from.y) })
      : { id: newId(type), kind: "logistics", type, label: t.name, x: 14 + (n % 7) * 27, y: 22 + Math.floor(n / 7) * 36, w: t.w, h: t.h, rot: 0 };
    state.items.push(it); sel = it.id; render(state, true);
  }
  const pal = $("logiPal");
  Object.entries(LOGI).forEach(([k, t]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "alt";
    b.innerHTML = `<span class="sw" style="background:${t.color}"></span><span></span>`;
    b.lastChild.textContent = `${t.name} ${t.w}×${t.h}`;
    b.addEventListener("click", () => addLogi(k));
    pal.appendChild(b);
  });
  $("siteDup").addEventListener("click", () => { const it = state && state.items.find((i) => i.id === sel); if (it && it.kind === "logistics") addLogi(it.type, it); });
  $("siteDel").addEventListener("click", () => {
    const it = state && state.items.find((i) => i.id === sel); if (!it || it.kind !== "logistics") return;
    pushHistory(); state.items = state.items.filter((i) => i !== it); sel = null; render(state, true);
  });

  // ================= UNDERLAY: import a PDF or image, scale it, align it, measure on it =================
  // Reference only: nothing read off the underlay becomes a fact until it is typed into the spec.
  const U = { align: [], href: null, W: 0, H: 0, fpp: 1, cx: 0, cy: 0, rot: 0, opacity: 0.55, isPdf: false, r: 1, pdf: null, page: 1,
    name: "", mode: null, pts: [], measure: null, scaleSrc: null };
  let ulDrag = null;
  const ftIn = (v) => D.ftin(v);
  const ulInfo = (html) => { $("ulInfo").innerHTML = html; };
  const tmI = '<span class="tm i">🟡 INTERP</span> ', tmB = '<span class="tm b">🔴 BLOCKED</span> ', tmF = '<span class="tm f">🟢 FACT</span> ';
  function ulWorld(px, py) { // image pixel -> world feet
    const a = rad(U.rot), vx = (px - U.W / 2) * U.fpp, vy = -(py - U.H / 2) * U.fpp;
    return [U.cx + Math.cos(a) * vx - Math.sin(a) * vy, U.cy + Math.sin(a) * vx + Math.cos(a) * vy];
  }
  function ulPx(p) { // world feet -> image pixel (the inverse of ulWorld)
    const a = rad(-U.rot), dx = p[0] - U.cx, dy = p[1] - U.cy;
    const lx = Math.cos(a) * dx - Math.sin(a) * dy, ly = Math.sin(a) * dx + Math.cos(a) * dy;
    return [lx / U.fpp + U.W / 2, -ly / U.fpp + U.H / 2];
  }
  // Plan-side picks snap to real corners: lot, pond and every item.
  function snapTarget(p) {
    const tol = 12 * screenFt(), C = [];
    state.lot.forEach((q, i) => C.push({ q, name: `lot corner ${i + 1}` }));
    (state.pond || []).forEach((q) => C.push({ q, name: "pond point" }));
    state.items.forEach((it) => itemPoly(it).forEach((q) => C.push({ q, name: `${it.label} corner` })));
    let best = null;
    for (const c of C) { const d = Math.hypot(c.q[0] - p[0], c.q[1] - p[1]); if (d <= tol && (!best || d < best.d)) best = { d, q: c.q.slice(), name: c.name }; }
    return best;
  }
  function alignStep() {
    const n = U.align.length;
    return ["1 of 4: click a point on the <b>underlay</b> (e.g. a lot corner drawn on the PDF).",
      "2 of 4: click where that point belongs on the <b>plan</b> (snaps to corners).",
      "3 of 4: click a second point on the <b>underlay</b>, far from the first.",
      "4 of 4: click where the second point belongs on the <b>plan</b>."][n] || "";
  }
  function doAlign() {
    const [A1, B1, A2, B2] = U.align, wA1 = ulWorld(...A1.px), wA2 = ulWorld(...A2.px);
    const la = Math.hypot(wA2[0] - wA1[0], wA2[1] - wA1[1]), lb = Math.hypot(B2.p[0] - B1.p[0], B2.p[1] - B1.p[1]);
    if (la < 1e-6 || lb < 1e-6) { ulInfo(`${tmB}The two points are on top of each other. Pick points far apart.`); U.align = []; return; }
    const dRot = ((Math.atan2(B2.p[1] - B1.p[1], B2.p[0] - B1.p[0]) - Math.atan2(wA2[1] - wA1[1], wA2[0] - wA1[0])) * 180) / Math.PI;
    const k = $("ulAlignScale").checked ? lb / la : 1;
    U.rot = ((U.rot + dRot + 540) % 360) - 180; U.fpp *= k;
    const n1 = ulWorld(...A1.px); U.cx += B1.p[0] - n1[0]; U.cy += B1.p[1] - n1[1]; // first point lands exactly
    const n2 = ulWorld(...A2.px), miss = Math.hypot(n2[0] - B2.p[0], n2[1] - B2.p[1]);
    if (k !== 1) { U.scaleSrc = "cal"; $("ulScale").value = "cal"; }
    let msg = `${tmI}Aligned: turned ${dRot >= 0 ? "+" : ""}${dRot.toFixed(2)}° to ${U.rot.toFixed(2)}°; point 1 sits on ${B1.name || "its target"}`;
    msg += k !== 1 ? `, and the scale was set from the pair (${((k - 1) * 100).toFixed(2)}% change), so point 2 lands on its target too.`
      : `. Point 2 lands <b class="num">${ftIn(miss)}</b> from its target with the scale held${miss > clickTol() * 2 ? " — check the scale, or tick “set scale too”" : " — within click precision"}.`;
    ulInfo(msg + " Your picks are interpretations: zoom in on the PDF corners for a better fit.");
    U.align = []; U.mode = null;
    ["ulMove", "ulCal", "ulMeasure", "ulAlign"].forEach((id) => $(id).setAttribute("aria-pressed", "false")); svg.style.cursor = "default";
  }
  function ulInside(p) {
    const a = rad(-U.rot), dx = p[0] - U.cx, dy = p[1] - U.cy;
    const lx = Math.cos(a) * dx - Math.sin(a) * dy, ly = Math.sin(a) * dx + Math.cos(a) * dy;
    return Math.abs(lx) <= (U.W * U.fpp) / 2 && Math.abs(ly) <= (U.H * U.fpp) / 2;
  }
  function ulKnob() { const a = rad(U.rot), d = vb[2] / 8; return [U.cx - Math.sin(a) * d, U.cy + Math.cos(a) * d]; }
  function screenFt() { return vb[2] / svg.getBoundingClientRect().width; }
  function clickTol() { return screenFt() + U.fpp; } // where you clicked + the image's own pixel size
  function drawUnderlay(sw, fs) {
    if (!U.href) return;
    if (document.activeElement !== $("ulAngle")) $("ulAngle").value = (Math.round(U.rot * 10) / 10).toString();
    const w = U.W * U.fpp, h = U.H * U.fpp;
    el("image", { href: U.href, x: U.cx - w / 2, y: -U.cy - h / 2, width: w, height: h, preserveAspectRatio: "none",
      opacity: U.opacity, transform: `rotate(${-U.rot} ${U.cx} ${-U.cy})`, style: "pointer-events:none" }, svg);
    const gold = `stroke:var(--gold);stroke-width:${sw * 1.6}`;
    if (U.mode === "move") {
      const k = ulKnob(), r = vb[2] / 70;
      el("path", { d: pathOf([ulWorld(0, 0), ulWorld(U.W, 0), ulWorld(U.W, U.H), ulWorld(0, U.H)]), style: `fill:none;${gold};stroke-dasharray:${sw * 5} ${sw * 3}` }, svg);
      el("line", { x1: U.cx, y1: -U.cy, x2: k[0], y2: -k[1], style: gold }, svg);
      el("circle", { cx: U.cx, cy: -U.cy, r: r * 0.5, style: "fill:var(--gold)" }, svg);
      el("circle", { cx: k[0], cy: -k[1], r, style: `fill:var(--gold);stroke:var(--sheet);stroke-width:${sw}` }, svg);
      const t = el("text", { x: k[0], y: -k[1], "text-anchor": "middle", "dominant-baseline": "central", style: `font:700 ${r * 1.5}px var(--body);fill:#0D1B2A;pointer-events:none` }, svg);
      t.textContent = "⟳";
    }
    const seg = (a, b, col) => {
      el("line", { x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], style: `stroke:${col};stroke-width:${sw * 1.8}` }, svg);
      [a, b].forEach((q) => el("circle", { cx: q[0], cy: -q[1], r: sw * 3.5, style: `fill:${col}` }, svg));
    };
    if (U.pts.length) { const a = U.pts[0]; el("circle", { cx: a[0], cy: -a[1], r: sw * 3.5, style: "fill:var(--interp)" }, svg); }
    if (U.pts.length === 2) seg(U.pts[0], U.pts[1], "var(--interp)");
    (U.align || []).forEach((a, i) => {
      const q = a.px ? ulWorld(...a.px) : a.p, col = a.px ? "var(--interp)" : "var(--fact)";
      el("circle", { cx: q[0], cy: -q[1], r: sw * 4, style: `fill:none;stroke:${col};stroke-width:${sw * 1.8}` }, svg);
      const t = el("text", { x: q[0] + fs * 0.5, y: -q[1] - fs * 0.4, style: `font:700 ${fs * 0.8}px var(--mono);fill:${col};paint-order:stroke;stroke:var(--sheet);stroke-width:${fs * 0.2}px` }, svg);
      t.textContent = (a.px ? "A" : "B") + (i < 2 ? "1" : "2");
      if (!a.px) { const s0 = ulWorld(...U.align[i - 1].px); el("line", { x1: s0[0], y1: -s0[1], x2: q[0], y2: -q[1], style: `stroke:var(--gold);stroke-width:${sw * 1.4};stroke-dasharray:${sw * 4} ${sw * 3}` }, svg); }
    });
    if (U.measure) {
      const [a, b] = U.measure; seg(a, b, "var(--interp)");
      const t = el("text", { x: (a[0] + b[0]) / 2 + fs * 0.4, y: -((a[1] + b[1]) / 2) - fs * 0.3, style: `font:700 ${fs}px var(--mono);fill:var(--interp);paint-order:stroke;stroke:var(--sheet);stroke-width:${fs * 0.25}px` }, svg);
      t.textContent = "≈ " + ftIn(Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
  }
  function setMode(m) {
    U.mode = U.mode === m ? null : m; U.pts = []; U.align = [];
    $("ulCalForm").hidden = true;
    ["ulMove", "ulCal", "ulMeasure", "ulAlign"].forEach((id) => $(id).setAttribute("aria-pressed", String(U.mode === { ulMove: "move", ulCal: "cal", ulMeasure: "measure", ulAlign: "align" }[id])));
    svg.style.cursor = U.mode === "move" ? "move" : U.mode ? "crosshair" : "default";
    const msg = {
      move: "Drag the underlay to line it up with the lot; drag the gold ⟳ knob to rotate it (1° steps, Shift for 0.1°). Click Move / rotate again when done.",
      cal: "Click both ends of a dimension you know on the underlay (on the sample: the 220.00′ check dimension).",
      measure: "Click two points on the underlay to measure between them.",
      align: alignStep(),
    }[U.mode];
    ulInfo(msg ? "👉 " + msg : ulStatus());
    render(state, false);
  }
  function ulStatus() {
    if (!U.href) return "No underlay. Import a PDF or image of a survey or plan, or try the sample.";
    const src = U.scaleSrc === "sheet" ? `sheet scale ${$("ulScale").selectedOptions[0].text}` : U.scaleSrc === "cal" ? "calibrated from a known dimension" : "scale not set";
    return `${U.scaleSrc ? tmI : tmB}<b>${esc(U.name)}</b> · ${src} · rotated ${(Math.round(U.rot * 10) / 10).toFixed(1)}° · reference only — type what you read off it into the spec to make it a fact.`;
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function parseFt(t) { // 220, 220.5, 220'-6", 220' 6"
    const m = String(t).trim().match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i);
    return m ? +m[1] + (m[2] ? +m[2] / 12 : 0) : NaN;
  }
  function ulDown(ev) {
    const p = toWorld(ev);
    if (U.mode === "move") {
      if (!U.href) return;
      const k = ulKnob(), r = vb[2] / 70;
      ev.preventDefault(); svg.setPointerCapture(ev.pointerId);
      if (Math.hypot(p[0] - k[0], p[1] - k[1]) <= r * 1.8) ulDrag = { rot: true };
      else if (ulInside(p)) ulDrag = { dx: U.cx - p[0], dy: U.cy - p[1] };
      return;
    }
    if (U.mode === "align") {
      ev.preventDefault();
      if (U.align.length % 2 === 0) {
        if (!ulInside(p)) { ulInfo(`${tmB}That click is off the underlay. ` + alignStep()); return; }
        U.align.push({ px: ulPx(p) });
      } else {
        const sn = snapTarget(p);
        U.align.push(sn ? { p: sn.q, name: sn.name } : { p, name: null });
      }
      if (U.align.length === 4) doAlign(); else ulInfo("👉 " + alignStep());
      render(state, false);
      return;
    }
    if (U.mode === "cal" || U.mode === "measure") {
      ev.preventDefault();
      if (U.pts.length >= 2) U.pts = [];
      U.pts.push(p);
      if (U.pts.length === 2) {
        const L = Math.hypot(U.pts[1][0] - U.pts[0][0], U.pts[1][1] - U.pts[0][1]);
        if (U.mode === "measure") {
          U.measure = U.pts.slice(); U.pts = [];
          ulInfo(`${tmI}On the underlay: <b class="num">≈ ${ftIn(L)}</b> ± ${ftIn(clickTol())} (where you clicked + the image's pixel size + the sheet's own accuracy). Type it into the spec to make it a fact.`);
        } else {
          $("ulCalForm").hidden = false; $("ulCalFt").focus();
          ulInfo(`${tmI}Your two clicks are <b class="num">${ftIn(L)}</b> apart at the current scale. Type the real distance and press <b>Set scale</b>.`);
        }
      }
      render(state, false);
    }
  }
  function ulMove(ev) {
    if (!ulDrag) return;
    const p = toWorld(ev);
    if (ulDrag.rot) {
      const step = ev.shiftKey ? 0.1 : 1, deg = (Math.atan2(p[1] - U.cy, p[0] - U.cx) * 180) / Math.PI - 90;
      U.rot = ((Math.round(deg / step) * step + 540) % 360) - 180;
    } else { U.cx = p[0] + ulDrag.dx; U.cy = p[1] + ulDrag.dy; }
    ulInfo(`👉 Underlay center (${ftIn(U.cx)}, ${ftIn(U.cy)}) · rotated ${U.rot.toFixed(1)}°`);
    render(state, false);
  }
  function applySheetScale() {
    const v = $("ulScale").value;
    if (!U.href || !U.isPdf || v === "cal") return;
    U.fpp = +v / (72 * U.r); U.scaleSrc = "sheet"; // PDF: 72 points per inch, rendered at r px per point
    ulInfo(ulStatus()); render(state, false);
  }
  async function loadPdfLib() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((ok, bad) => { const sc = document.createElement("script"); sc.src = "vendor/pdfjs/pdf.min.js"; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
    return window.pdfjsLib;
  }
  async function renderPdfPage(n) {
    const page = await U.pdf.getPage(n), v1 = page.getViewport({ scale: 1 });
    U.r = Math.min(3, 2400 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale: U.r }), c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    U.href = c.toDataURL("image/png"); U.W = c.width; U.H = c.height; U.page = n;
  }
  function placeFresh() {
    const xs = state.lot.map((q) => q[0]), ys = state.lot.map((q) => q[1]);
    U.cx = (Math.min(...xs) + Math.max(...xs)) / 2; U.cy = (Math.min(...ys) + Math.max(...ys)) / 2; U.rot = 0; U.measure = null; U.pts = [];
    if (!U.scaleSrc) U.fpp = ((Math.max(...xs) - Math.min(...xs)) * 1.4) / U.W; // a guess so it's visible: not a scale
  }
  async function openPdf(data, name, presetScale, src, restore) {
    ulInfo("Reading the PDF…");
    try {
      const lib = await loadPdfLib();
      const keep = src || { kind: "pdf", blob: new Blob([data], { type: "application/pdf" }) }; // before pdf.js takes the bytes
      U.pdf = await lib.getDocument({ data }).promise; U.isPdf = true; U.name = name; U.scaleSrc = null;
      if (!restore) { U.src = keep; U.srcDirty = true; }
      await renderPdfPage(restore && restore.page <= U.pdf.numPages ? restore.page : 1);
      const sel = $("ulPage"); sel.innerHTML = "";
      for (let i = 1; i <= U.pdf.numPages; i++) sel.add(new Option("Page " + i, i));
      $("ulPageWrap").hidden = U.pdf.numPages < 2;
      $("ulScale").disabled = false;
      $("ulPage").value = U.page;
      if (restore) { applyRestore(restore); return; }
      if (presetScale) { $("ulScale").value = presetScale; applySheetScale(); } else $("ulScale").value = "cal";
      placeFresh(); setTools(true);
      ulInfo(ulStatus() + (U.scaleSrc ? "" : " Pick the sheet scale printed on it, or Calibrate."));
      render(state, false);
    } catch (e) { ulInfo(`${tmB}Couldn't read that PDF (${esc(e.message || e)}).`); }
  }
  function openImage(file, name, restore) {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        U.href = rd.result; U.W = img.naturalWidth; U.H = img.naturalHeight; U.isPdf = false; U.name = name || file.name; U.scaleSrc = null; U.pdf = null;
        $("ulScale").value = "cal"; $("ulScale").disabled = true; $("ulPageWrap").hidden = true;
        if (restore) { applyRestore(restore); return; }
        U.src = { kind: "image", blob: file }; U.srcDirty = true;
        placeFresh(); setTools(true);
        ulInfo(`${tmB}<b>${esc(file.name)}</b>: a photo or scan has no built-in scale. Click <b>Calibrate</b> and pick two ends of a known dimension.`);
        render(state, false);
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  }
  function setTools(on) { ["ulMove", "ulAlign", "ulAlignScale", "ulCal", "ulMeasure", "ulRemove", "ulOpacity", "ulAngle"].forEach((id) => { $(id).disabled = !on; }); }
  $("ulImport").onclick = () => $("ulFile").click();
  $("ulFile").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) openPdf(new Uint8Array(await f.arrayBuffer()), f.name, null, { kind: "pdf", blob: f });
    else if (/^image\//.test(f.type)) openImage(f);
    else ulInfo(`${tmB}Use a PDF, PNG or JPG.`);
  };
  $("ulSample").onclick = async () => {
    try { const r = await fetch("samples/sample-boundary-sketch.pdf"); openPdf(new Uint8Array(await r.arrayBuffer()), "Sample boundary sketch (fictional, 1″ = 30′)", "30", { kind: "sample" }); }
    catch (e) { ulInfo(`${tmB}Couldn't load the sample.`); }
  };
  $("ulPage").onchange = async (e) => { if (!U.pdf) return; await renderPdfPage(+e.target.value); applySheetScale(); render(state, false); };
  $("ulAlignScale").onchange = () => persistSoon();
  $("ulScale").onchange = () => { if ($("ulScale").value === "cal") { U.scaleSrc = U.scaleSrc === "sheet" ? null : U.scaleSrc; setMode("cal"); } else applySheetScale(); };
  $("ulMove").onclick = () => setMode("move");
  $("ulCal").onclick = () => setMode("cal");
  $("ulMeasure").onclick = () => setMode("measure");
  $("ulAlign").onclick = () => setMode("align");
  $("ulAngle").onchange = (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) { U.rot = ((v + 540) % 360) - 180; ulInfo(ulStatus()); render(state, false); } };
  $("ulOpacity").oninput = (e) => { U.opacity = +e.target.value / 100; render(state, false); };
  $("ulRemove").onclick = () => { Object.assign(U, { href: null, pdf: null, mode: null, pts: [], measure: null, scaleSrc: null }); setTools(false); $("ulPageWrap").hidden = true; ulInfo(ulStatus()); render(state, false); };
  $("ulCalApply").onclick = () => {
    const D2 = parseFt($("ulCalFt").value);
    if (U.pts.length !== 2 || !(D2 > 0)) { ulInfo(`${tmB}Type the real distance in feet, e.g. 220 or 220'-0".`); return; }
    const [a, b] = U.pts, L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = D2 / L;
    const before = U.scaleSrc === "sheet" ? U.fpp : null;
    U.fpp *= k; U.cx = a[0] + k * (U.cx - a[0]); U.cy = a[1] + k * (U.cy - a[1]); // scale about the first click
    U.scaleSrc = "cal"; $("ulScale").value = "cal"; $("ulCalForm").hidden = true; U.mode = null; U.pts = [];
    ["ulMove", "ulCal", "ulMeasure", "ulAlign"].forEach((id) => $(id).setAttribute("aria-pressed", "false")); svg.style.cursor = "default";
    const tol = (clickTol() / D2) * 100;
    let msg = `${tmI}Scale set so your clicks are <b class="num">${ftIn(D2)}</b> apart (± about ${tol.toFixed(2)}% from click precision).`;
    if (before) msg += Math.abs(k - 1) < 0.0005 ? ` It matches the printed sheet scale (within ${(Math.abs(k - 1) * 100).toFixed(2)}%).` : ` The printed sheet scale was ${(Math.abs(k - 1) * 100).toFixed(2)}% ${k > 1 ? "short" : "long"} against it${Math.abs(k - 1) > 0.005 ? " — the sheet may have been printed or scanned off-scale" : ""}.`;
    ulInfo(msg + " Now use Move / rotate to line it up.");
    render(state, false);
  };
  $("ulCalFt").addEventListener("keydown", (e) => { if (e.key === "Enter") $("ulCalApply").click(); });
  setTools(false); ulInfo(ulStatus());
  window.FCUnderlay = U; // for tests

  // ================= SAVE IN THIS BROWSER =================
  // The site spec goes in localStorage; the underlay (the original PDF or image, plus its scale,
  // position, rotation, fade and page) goes in IndexedDB, which can hold files. Nothing leaves the browser.
  const LS_SPEC = "fc-site-spec-v1";
  let dbp = null, saveT = null, restoring = false, lastMeta = "";
  function idb() {
    return new Promise((ok, bad) => {
      const r = indexedDB.open("fieldcomm-draw-demo", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
    });
  }
  async function kv(mode, fn) {
    const db = await (dbp = dbp || idb());
    return new Promise((ok, bad) => {
      const tx = db.transaction("kv", mode), req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => ok(req && req.result); tx.onerror = () => bad(tx.error); tx.onabort = () => bad(tx.error);
    });
  }
  const kvGet = (k) => kv("readonly", (st) => st.get(k)), kvPut = (k, v) => kv("readwrite", (st) => st.put(v, k)), kvDel = (k) => kv("readwrite", (st) => st.delete(k));
  const savedNote = (t, ok) => { const e = $("ulSaved"); e.textContent = t; e.style.color = ok ? "var(--fact)" : "var(--block)"; };
  function persistSoon() {
    if (restoring) return;
    clearTimeout(saveT); saveT = setTimeout(persistNow, 400);
  }
  async function persistNow() {
    try { localStorage.setItem(LS_SPEC, ta.value); } catch (e) { /* storage off: still works, just not saved */ }
    try {
      if (!U.href) { if (lastMeta !== "none") { await kvDel("ul-meta"); await kvDel("ul-src"); lastMeta = "none"; savedNote("", true); } return; }
      if (U.srcDirty) { await kvPut("ul-src", U.src); U.srcDirty = false; lastMeta = ""; }
      const meta = { v: 1, name: U.name, isPdf: U.isPdf, page: U.page, fpp: U.fpp, cx: U.cx, cy: U.cy, rot: U.rot, opacity: U.opacity,
        scaleSrc: U.scaleSrc, scaleSel: $("ulScale").value, alignScale: $("ulAlignScale").checked };
      const js = JSON.stringify(meta);
      if (js !== lastMeta) { await kvPut("ul-meta", meta); lastMeta = js; }
      savedNote("✓ underlay saved in this browser", true);
    } catch (e) {
      savedNote(/quota/i.test((e && (e.name + e.message)) || "") ? "Underlay too large to save here" : "Underlay can't be saved in this browser (private window?)", false);
    }
  }
  function applyRestore(m) {
    Object.assign(U, { fpp: m.fpp, cx: m.cx, cy: m.cy, rot: m.rot, opacity: m.opacity, scaleSrc: m.scaleSrc, mode: null, pts: [], align: [], measure: null });
    $("ulScale").value = m.scaleSel || "cal"; $("ulOpacity").value = Math.round(m.opacity * 100); $("ulAlignScale").checked = !!m.alignScale;
    setTools(true); lastMeta = JSON.stringify(m);
    ulInfo(ulStatus() + " <i>Restored from this browser.</i>"); savedNote("✓ underlay saved in this browser", true);
    render(state, false);
  }
  async function ulRestore() {
    let m, src;
    try { m = await kvGet("ul-meta"); src = await kvGet("ul-src"); } catch (e) { return; }
    if (!m || !src || m.v !== 1) return;
    restoring = true;
    try {
      U.src = src; U.srcDirty = false;
      if (src.kind === "sample") { const r = await fetch("samples/sample-boundary-sketch.pdf"); await openPdf(new Uint8Array(await r.arrayBuffer()), m.name, null, src, m); }
      else if (m.isPdf) await openPdf(new Uint8Array(await src.blob.arrayBuffer()), m.name, null, src, m);
      else await new Promise((ok) => { openImage(src.blob, m.name, m); const t = setInterval(() => { if (U.href) { clearInterval(t); ok(); } }, 50); setTimeout(() => { clearInterval(t); ok(); }, 5000); });
    } catch (e) { ulInfo(`${tmB}The saved underlay couldn't be reopened. Import it again.`); }
    finally { restoring = false; }
  }

  let savedSpec = null;
  try { savedSpec = localStorage.getItem(LS_SPEC); } catch (e) { savedSpec = null; }
  ta.value = savedSpec || SITE_TEXT;
  fromText();
  if (!state) { ta.value = SITE_TEXT; fromText(); } // a broken saved spec never locks the demo
  ulRestore();
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state && render(state, false));
  window.FCSite = { check: () => state && check(state), state: () => state }; // for tests
})();
