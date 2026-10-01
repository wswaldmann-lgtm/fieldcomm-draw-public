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
    return out;
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
      const o = { id: it.id, kind: it.kind, label: it.label, x: r2(it.x), y: r2(it.y) };
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
    // envelope
    for (const poly of envelope(s)) for (const ring of poly)
      el("path", { d: pathOf(ring.slice(0, -1)), style: `fill:none;stroke:var(--muted);stroke-width:${sw};stroke-dasharray:${sw * 6} ${sw * 4}` }, svg);
    if (s.pond) {
      el("path", { d: pathOf(s.pond), style: `fill:var(--water);stroke:var(--glass);stroke-width:${sw * 1.4}` }, svg);
      const c = s.pond.reduce((a, p) => [a[0] + p[0] / s.pond.length, a[1] + p[1] / s.pond.length], [0, 0]);
      text(c[0], c[1] - fs * 0.3, "POND", "fill:var(--glass);font-size:" + fs * 0.8 + "px");
    }
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
    const rows = checks.filter((c) => !c.noOverlapOnly || !c.pass).map((c) => {
      const val = c.r.outside ? "outside the lot" : c.r.overlap ? "overlapping" : `<span class="num">${D.ftin(c.r.d)}</span> edge to edge`;
      const need = c.noOverlapOnly ? "must not overlap" : `min <span class="num">${D.ftin(c.min)}</span>`;
      return [c.pass ? "f" : "b", `${c.pass ? "PASS" : "FAIL"} · ${c.label}: ${val} (${need})`];
    });
    const wdf = checks.find((c) => c.id === "wdf");
    if (wdf && !wdf.r.overlap) rows.push(["i", `Measured center to center, ${wdf.label.toLowerCase()} would read <span class="num">${D.ftin(wdf.cc)}</span> — <span class="num">${D.ftin(wdf.cc - wdf.r.d)}</span> more clearance than really exists`]);
    facts($("siteFacts"), rows);
    const fails = checks.filter((c) => !c.pass).length;
    $("siteStatus").textContent = fails ? `${fails} fail${fails > 1 ? "s" : ""} · held` : "all checks pass";
    const it = s.items.find((i) => i.id === sel);
    $("siteInfo").textContent = it
      ? `🟢 ${it.label} center at (${D.ftin(it.x)}, ${D.ftin(it.y)})${it.kind !== "well" ? ` · ${D.ftin(it.w)} × ${D.ftin(it.h)} · rotated ${r2(it.rot || 0)}°` : ""}`
      : "Drag the house, drainfield or well. Select one to rotate it.";
    const rotOK = it && it.kind !== "well";
    ["rotL", "rotR", "rotSlider"].forEach((id) => { $(id).disabled = !rotOK; });
    if (rotOK) $("rotSlider").value = it.rot || 0;
  }

  function render(s, writeText) {
    const checks = check(s);
    draw(s, checks);
    report(s, checks);
    if (writeText) ta.value = toYAML(s);
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
    const p = toWorld(ev), it = hit(p);
    sel = it ? it.id : null;
    if (it) {
      ev.preventDefault(); svg.setPointerCapture(ev.pointerId);
      drag = { id: it.id, dx: it.x - p[0], dy: it.y - p[1], before: ta.value, moved: false };
    }
    render(state, false);
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!state) return;
    if (!drag) { if (ev.pointerType === "mouse") svg.style.cursor = hit(toWorld(ev)) ? "move" : "default"; return; }
    const p = toWorld(ev), it = state.items.find((i) => i.id === drag.id);
    it.x = snapV(p[0] + drag.dx); it.y = snapV(p[1] + drag.dy); drag.moved = true;
    render(state, true);
  });
  function end() {
    if (drag && drag.moved && drag.before !== ta.value) { history.push(drag.before); $("siteUndo").disabled = false; }
    drag = null;
  }
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

  ta.value = SITE_TEXT;
  fromText();
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state && render(state, false));
  window.FCSite = { check: () => state && check(state), state: () => state }; // for tests
})();
