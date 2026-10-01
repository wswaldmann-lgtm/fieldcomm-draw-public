/* FieldComm Draw — browser demo. All geometry comes from engine.js (FCDraw). */
(function () {
  "use strict";
  const D = window.FCDraw;
  const SVGNS = "http://www.w3.org/2000/svg";

  // Same rooms/openings/dimension strings as examples/spec/demo_cottage.yaml.
  // (Fixtures and the title block render in the Python engine only.)
  const SPEC_TEXT = `# Demo cottage (fictional). Units: feet. Origin = living room SW corner.
project: "Demo Cottage - 3 BR / 1 BA"
wall_system: {exterior: "2x6", interior: "2x4"}
rooms:
  - {name: "Living / Kitchen", type: living,      x: 0,  y: 0,  w: 24, h: 15}
  - {name: "Bedroom 1",        type: bedroom,     x: 24, y: 0,  w: 14, h: 15}
  - {name: "Laundry",          type: utility,     x: 0,  y: 15, w: 8,  h: 4}
  - {name: "Hall",             type: circulation, x: 8,  y: 15, w: 30, h: 4}
  - {name: "Bedroom 2",        type: bedroom,     x: 0,  y: 19, w: 12, h: 12}
  - {name: "Bath",             type: bathroom,    x: 12, y: 19, w: 8,  h: 12}
  - {name: "Bedroom 3",        type: bedroom,     x: 20, y: 19, w: 18, h: 12}
  - {name: "Front Porch",      type: porch,       x: 0,  y: -6, w: 24, h: 6}
doors:
  - {room: "Living / Kitchen", side: S, offset: 10, width: 3}
  - {room: "Living / Kitchen", side: N, offset: 9,  width: 4, type: cased}
  - {room: "Bedroom 1",        side: N, offset: 2,  width: 2.7}
  - {room: "Laundry",          side: E, offset: 0.7, width: 2.5}
  - {room: "Bedroom 2",        side: S, offset: 9,  width: 2.7}
  - {room: "Bath",             side: S, offset: 2,  width: 2.5}
  - {room: "Bedroom 3",        side: S, offset: 2,  width: 2.7}
windows:
  - {room: "Living / Kitchen", side: S, offset: 3,  width: 5}
  - {room: "Living / Kitchen", side: W, offset: 4,  width: 5}
  - {room: "Bedroom 1",        side: E, offset: 5,  width: 4}
  - {room: "Bedroom 1",        side: S, offset: 5,  width: 4}
  - {room: "Bedroom 2",        side: N, offset: 4,  width: 4}
  - {room: "Bedroom 2",        side: W, offset: 4,  width: 4}
  - {room: "Bath",             side: N, offset: 3,  width: 2}
  - {room: "Bedroom 3",        side: N, offset: 7,  width: 4}
  - {room: "Bedroom 3",        side: E, offset: 4,  width: 4}
# Dimension strings: drawn only if the segments add up to the overall.
dim_chains:
  - {p0: [0, 31], segments: [12, 8, 18], overall: 38, orient: H, side: 1, offset: 2.5}
  - {p0: [0, 0],  segments: [15, 4, 12], overall: 31, orient: V, side: -1, offset: 3.5}
`;
  const PRESETS = {
    good: SPEC_TEXT,
    gate: SPEC_TEXT
      .replace(/  - \{room: "Bedroom 2",\s+side: N[^\n]*\n/, "")
      .replace(/  - \{room: "Bedroom 2",\s+side: W[^\n]*\n/, ""),
    chain: SPEC_TEXT.replace("segments: [12, 8, 18]", "segments: [12, 8, 17]"),
  };

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (v, n = 2) => v.toFixed(n);
  const MARK = { f: "🟢 FACT", i: "🟡 INTERP", b: "🔴 BLOCKED" };
  function facts(ul, rows) {
    ul.innerHTML = "";
    for (const [k, html] of rows) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="tm ${k}">${MARK[k]}</span><span>${html}</span>`;
      ul.appendChild(li);
    }
  }
  function polyArea(walls) {
    let a = 0;
    for (const poly of walls) poly.forEach((ring, i) => {
      let s = 0;
      for (let k = 0; k < ring.length - 1; k++) s += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
      a += (i === 0 ? 1 : -1) * Math.abs(s / 2);
    });
    return a;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------- SVG plan (vector, in feet; y is flipped so north is up) ----------
  function doorGeom(spec, d) {
    const r = spec.rooms.find((rr) => rr.name === d.room);
    const S = {
      S: { s: [r.x + d.offset, r.y], u: [1, 0], n: [0, 1] },
      N: { s: [r.x + d.offset, r.y + r.h], u: [1, 0], n: [0, -1] },
      W: { s: [r.x, r.y + d.offset], u: [0, 1], n: [1, 0] },
      E: { s: [r.x + r.w, r.y + d.offset], u: [0, 1], n: [-1, 0] },
    }[d.side];
    return S;
  }
  function drawPlanSVG(svg, spec, walls, opt = {}) {
    svg.innerHTML = "";
    const e = D.extents(spec), m = opt.margin == null ? 6 : opt.margin;
    const vb = opt.viewBox || [e.minx - m, -(e.maxy + m), e.maxx - e.minx + 2 * m, e.maxy - e.miny + 2 * m];
    svg.setAttribute("viewBox", vb.join(" "));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const g = el("g", { transform: "scale(1,-1)" }, svg);
    const sw = opt.stroke || vb[2] / 500; // hairline relative to view
    // room fills (light) for legibility
    for (const r of spec.rooms)
      el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, style: `fill:${r.type === "porch" ? "var(--rule)" : "transparent"};opacity:.35` }, g);
    // walls: exact polygons
    let d = "";
    for (const poly of walls) for (const ring of poly) d += "M" + ring.map((p) => p[0] + " " + p[1]).join("L") + "Z";
    el("path", { d, "fill-rule": "evenodd", style: "fill:var(--wall)" }, g);
    // windows: glass line in the wall center
    const te = D.tExt(spec);
    for (const w of spec.windows || []) {
      const r = spec.rooms.find((rr) => rr.name === w.room);
      let x0, y0, x1, y1;
      if (w.side === "N" || w.side === "S") { const y = w.side === "N" ? r.y + r.h + te / 2 : r.y - te / 2; x0 = r.x + w.offset; x1 = x0 + w.width; y0 = y1 = y; }
      else { const x = w.side === "E" ? r.x + r.w + te / 2 : r.x - te / 2; y0 = r.y + w.offset; y1 = y0 + w.width; x0 = x1 = x; }
      el("line", { x1: x0, y1: y0, x2: x1, y2: y1, style: `stroke:var(--glass);stroke-width:${Math.max(sw * 2, 0.08)}` }, g);
    }
    // door swings
    for (const dr of spec.doors || []) {
      if (dr.type === "cased") continue;
      const { s, u, n } = doorGeom(spec, dr), wd = dr.width;
      const leaf = [s[0] + n[0] * wd, s[1] + n[1] * wd], end = [s[0] + u[0] * wd, s[1] + u[1] * wd];
      el("line", { x1: s[0], y1: s[1], x2: leaf[0], y2: leaf[1], style: `stroke:var(--door);stroke-width:${sw * 1.4}` }, g);
      const cross = u[0] * n[1] - u[1] * n[0];
      el("path", { d: `M${leaf[0]} ${leaf[1]}A${wd} ${wd} 0 0 ${cross > 0 ? 0 : 1} ${end[0]} ${end[1]}`, style: `fill:none;stroke:var(--door);stroke-width:${sw};stroke-dasharray:${sw * 4} ${sw * 3}` }, g);
    }
    // text layer (unflipped)
    const t = el("g", {}, svg);
    if (opt.labels !== false) for (const r of spec.rooms) {
      const cx = r.x + r.w / 2, cy = -(r.y + r.h / 2), fs = Math.min(0.95, r.w / 7.5, r.h / 3);
      const tx = el("text", { x: cx, y: cy - fs * 0.1, "text-anchor": "middle", style: `font:600 ${fs}px var(--body);fill:var(--muted)` }, t);
      tx.textContent = r.name;
      if (r.h >= 5) { const a = el("text", { x: cx, y: cy + fs * 1.05, "text-anchor": "middle", style: `font:400 ${fs * 0.75}px var(--mono);fill:var(--muted)` }, t); a.textContent = `${D.ftin(r.w)} × ${D.ftin(r.h)}`; }
    }
    if (opt.dims !== false) drawChains(t, spec, vb);
    return vb;
  }
  // A dimension string is only true if it adds up AND every tick lands on a real wall line.
  function chainStatus(spec) {
    return D.checkChains(spec).map((c) => {
      const ch = c.chain, H = (ch.orient || "H") === "H";
      const lines = spec.rooms.flatMap((r) => (H ? [r.x, r.x + r.w] : [r.y, r.y + r.h]));
      let acc = H ? ch.p0[0] : ch.p0[1];
      const ticks = [acc]; ch.segments.forEach((s) => { acc += s; ticks.push(acc); });
      const offWall = ticks.filter((t) => !lines.some((l) => Math.abs(l - t) < 1e-3));
      return Object.assign(c, { offWall, ok: c.closes && !offWall.length });
    });
  }
  function drawChains(t, spec, vb) {
    const sw = vb[2] / 600, fs = 1.05;
    for (const c of chainStatus(spec)) {
      const ch = c.chain, H = (ch.orient || "H") === "H", side = ch.side || 1, off = ch.offset || 2.5;
      const col = c.ok ? "var(--wall)" : "var(--block)";
      const [px, py] = ch.p0;
      // in screen coords (y flipped)
      const P = (along, out) => (H ? [px + along, -(py + side * out)] : [px + side * out, -(py + along)]);
      const line = (a, b, extra = "") => el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], style: `stroke:${col};stroke-width:${sw}${extra}` }, t);
      const text = (p, s, rot) => {
        const tx = el("text", { x: p[0], y: p[1], "text-anchor": "middle", transform: rot ? `rotate(-90 ${p[0]} ${p[1]})` : "", style: `font:500 ${fs}px var(--mono);fill:${col}` }, t);
        tx.textContent = s;
      };
      if (!c.ok) {
        line(P(0, off), P(ch.overall, off), `;stroke-dasharray:${sw * 6} ${sw * 4}`);
        const mid = P(ch.overall / 2, off + 0.4 * side);
        const why = !c.closes ? `${ch.segments.map(D.ftin).join("+")} = ${D.ftin(c.sum)} ≠ ${D.ftin(ch.overall)}` : `no wall at ${c.offWall.map(D.ftin).join(", ")}`;
        text(H ? [mid[0], mid[1] - 0.15] : [mid[0] - 0.15 * side, mid[1]], `REFUSED: ${why}`, !H);
        continue;
      }
      let acc = 0;
      const ticks = [0];
      ch.segments.forEach((s) => { acc += s; ticks.push(acc); });
      line(P(0, off), P(ch.overall, off));
      line(P(0, off + 1.6), P(ch.overall, off + 1.6));
      for (const v of ticks) {
        line(P(v, off - 0.4), P(v, off + 0.4));
        const tk = 0.3; const p = P(v, off), q = P(v, off + 1.6);
        line([p[0] - tk, p[1] + tk], [p[0] + tk, p[1] - tk]);
        if (v === 0 || v === ch.overall) line([q[0] - tk, q[1] + tk], [q[0] + tk, q[1] - tk]);
      }
      for (let k = 0; k < ch.segments.length; k++) {
        const p = P((ticks[k] + ticks[k + 1]) / 2, off + 0.3);
        text(H ? p : [p[0] - 0.15, p[1]], D.ftin(ch.segments[k]), !H);
      }
      const p = P(ch.overall / 2, off + 1.9);
      text(H ? p : [p[0] - 0.15, p[1]], D.ftin(ch.overall), !H);
    }
  }

  // ---------- Test 1: repeatability ----------
  const BASE = D.parse(SPEC_TEXT);
  const TYPOS = { "Bedroom 2": "Bedrom 2", "Laundry": "Laundy", "Living / Kitchen": "Livng / Kitchen", "Bedroom 3": "Bedroom 8" };
  const t1 = { n: 0, pixHashes: new Set(), widths: [], missing: 0, prints: new Set(), area: null };

  function simulatePixels(seed) {
    // Illustrative only: imitates the failure modes of drawing plans as images.
    const rnd = mulberry32(seed * 7919 + 13), J = (a) => (rnd() * 2 - 1) * a;
    const canvas = $("pixCanvas"), ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = css("--sheet") || "#fff"; ctx.fillRect(0, 0, W, H);
    const e = D.extents(BASE), m = 6;
    const sc = Math.min(W / (e.maxx - e.minx + 2 * m), H / (e.maxy - e.miny + 2 * m));
    const ox = (W - (e.maxx - e.minx) * sc) / 2 - e.minx * sc, oy = (H + (e.maxy - e.miny) * sc) / 2 + e.miny * sc;
    const X = (x) => ox + x * sc, Y = (y) => oy - y * sc;
    const drop = rnd() < 0.45 ? ["Bath", "Hall", "Laundry", "Bedroom 2"][Math.floor(rnd() * 4)] : null;
    const typo = rnd() < 0.35 ? Object.keys(TYPOS)[Math.floor(rnd() * 4)] : null;
    const rot = J(0.012);
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.translate(-W / 2, -H / 2);
    const drawn = [];
    for (const r of BASE.rooms) {
      if (r.name === drop) continue;
      const q = { name: r.name, x: r.x + J(0.7), y: r.y + J(0.7), w: r.w * (0.95 + J(0.07)), h: r.h * (0.95 + J(0.07)), type: r.type };
      drawn.push(q);
      ctx.strokeStyle = css("--wall"); ctx.lineWidth = Math.max(2, D.tExt(BASE) * sc * (0.7 + rnd() * 0.8));
      if (q.type === "porch") { ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; } else ctx.setLineDash([]);
      ctx.strokeRect(X(q.x), Y(q.y + q.h), q.w * sc, q.h * sc);
    }
    ctx.setLineDash([]);
    // door gaps, loosely placed (some missing)
    ctx.fillStyle = css("--sheet") || "#fff";
    for (const d of BASE.doors) {
      if (rnd() < 0.3) continue;
      const q = drawn.find((rr) => rr.name === d.room); if (!q) continue;
      const off = d.offset + J(1.2), wd = d.width * (0.8 + rnd() * 0.4);
      if (d.side === "S" || d.side === "N") { const y = d.side === "S" ? q.y : q.y + q.h; ctx.fillRect(X(q.x + off), Y(y) - 5, wd * sc, 10); }
      else { const x = d.side === "W" ? q.x : q.x + q.w; ctx.fillRect(X(x) - 5, Y(q.y + off + wd), 10, wd * sc); }
    }
    // labels: names and the *spec's* area, regardless of what got drawn
    ctx.fillStyle = css("--muted"); ctx.textAlign = "center";
    for (const q of drawn) {
      const orig = BASE.rooms.find((rr) => rr.name === q.name);
      ctx.font = `600 ${Math.min(13, q.w * sc / 8)}px ${css("--body")}`;
      ctx.fillText(q.name === typo ? TYPOS[q.name] : q.name, X(q.x + q.w / 2), Y(q.y + q.h / 2));
      if (q.h > 5) { ctx.font = `400 10px ${css("--mono")}`; ctx.fillText(`${orig.w * orig.h} SF`, X(q.x + q.w / 2), Y(q.y + q.h / 2) + 13); }
    }
    // overall dimension: line spans the drawn width, label is always 38'-0"
    const minx = Math.min(...drawn.map((q) => q.x)), maxx = Math.max(...drawn.map((q) => q.x + q.w));
    const maxy = Math.max(...drawn.map((q) => q.y + q.h));
    ctx.strokeStyle = css("--wall"); ctx.lineWidth = 1;
    const dy = Y(maxy) - 26;
    ctx.beginPath(); ctx.moveTo(X(minx), dy); ctx.lineTo(X(maxx), dy); ctx.stroke();
    for (const x of [minx, maxx]) { ctx.beginPath(); ctx.moveTo(X(x) - 4, dy + 4); ctx.lineTo(X(x) + 4, dy - 4); ctx.stroke(); }
    ctx.fillStyle = css("--wall"); ctx.font = `500 12px ${css("--mono")}`;
    ctx.fillText(`38'-0"`, (X(minx) + X(maxx)) / 2, dy - 6);
    ctx.restore();
    // a cheap hash of the pixels
    const px = ctx.getImageData(0, 0, W, H).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < px.length; i += 37) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    const b3 = drawn.find((q) => q.name === "Bedroom 3");
    return { drop, typo, width: maxx - minx, hash: h.toString(16).padStart(8, "0"), b3: b3 ? b3.w * b3.h : null };
  }

  async function generate() {
    t1.n++;
    const sim = simulatePixels(t1.n);
    t1.pixHashes.add(sim.hash); t1.widths.push(sim.width); if (sim.drop) t1.missing++;
    facts($("pixFacts"), [
      ["i", sim.drop ? `Rooms: 7 of 8 — <b>${sim.drop} is missing</b>` : "Rooms: 8 of 8 this time"],
      ["i", `Label says <span class="num">38'-0"</span>; the drawn width measures <span class="num">≈ ${fmt(sim.width, 1)} ft</span>`],
      ["i", sim.b3 ? `Bedroom 3 looks like <span class="num">≈ ${Math.round(sim.b3)} sf</span> (labeled 216 SF)` : "Bedroom 3 size: can't tell"],
      ["i", `Image hash <span class="num">${sim.hash}</span> — new every run${sim.typo ? `; a label now reads “${TYPOS[sim.typo]}”` : ""}`],
    ]);
    // Engine: parse the same text again and solve from scratch each time.
    const spec = D.parse(SPEC_TEXT);
    const { walls } = D.buildWalls(spec);
    const fp = await D.fingerprint(walls);
    t1.prints.add(fp); t1.area = polyArea(walls);
    drawPlanSVG($("specSvg"), spec, walls);
    const ch = D.checkChains(spec);
    facts($("specFacts"), [
      ["f", `Rooms: ${spec.rooms.length} of ${spec.rooms.length}, every run`],
      ...ch.map((c) => ["f", `<span class="num">${D.ftin(c.chain.overall)} = ${c.chain.segments.join(" + ")}</span> — the string closes`]),
      ["f", `Wall area <span class="num">${fmt(t1.area, 3)} sf</span>, computed from polygons`],
      ["f", `Fingerprint <span class="num">${fp.slice(0, 16)}…</span> — ${t1.prints.size === 1 ? `identical ${t1.n}/${t1.n}` : `${t1.prints.size} different`}`],
    ]);
    const ws = t1.widths, lo = Math.min(...ws), hi = Math.max(...ws);
    $("tallyL").innerHTML = `<b>${t1.n} generation${t1.n > 1 ? "s" : ""} · ${t1.pixHashes.size} different image${t1.pixHashes.size > 1 ? "s" : ""}</b>🟡 Width drawn anywhere from ${fmt(lo, 1)} to ${fmt(hi, 1)} ft under the same 38'-0" label. A room went missing in ${t1.missing} of ${t1.n}.`;
    $("tallyR").innerHTML = `<b>${t1.n} generation${t1.n > 1 ? "s" : ""} · ${t1.prints.size} fingerprint</b>🟢 38'-0" × 31'-0" every time, 0.000 ft drift. Same spec in, same geometry out.`;
  }
  let busy = false;
  $("gen1").addEventListener("click", () => { if (!busy) generate(); });
  $("gen10").addEventListener("click", async () => {
    if (busy) return; busy = true;
    for (let i = 0; i < 10; i++) { await generate(); await new Promise((r) => setTimeout(r, 160)); }
    busy = false;
  });
  $("genReset").addEventListener("click", () => {
    if (busy) return;
    Object.assign(t1, { n: 0, pixHashes: new Set(), widths: [], missing: 0, prints: new Set() });
    generate();
  });

  // ---------- Test 2: zoom ----------
  const CORNER = [24, 15];
  const BASE_VB = { x: -7, y: -7, w: 52, h: 39 }; // world window at 1x (feet)
  const RASTER_W = 300, RASTER_H = 225;
  const raster = document.createElement("canvas");
  let baseWalls;
  function buildRaster() {
    baseWalls = D.buildWalls(BASE).walls;
    raster.width = RASTER_W; raster.height = RASTER_H;
    const c = raster.getContext("2d"), s = RASTER_W / BASE_VB.w;
    c.fillStyle = css("--sheet") || "#fff"; c.fillRect(0, 0, RASTER_W, RASTER_H);
    c.fillStyle = css("--wall");
    c.beginPath();
    for (const poly of baseWalls) for (const ring of poly) ring.forEach((p, k) => {
      const X = (p[0] - BASE_VB.x) * s, Y = RASTER_H - (p[1] - BASE_VB.y) * s;
      k ? c.lineTo(X, Y) : c.moveTo(X, Y);
    });
    c.fill("evenodd");
  }
  function drawZoom() {
    const z = +$("zoom").value;
    $("zoomOut").textContent = z + "×";
    const vw = BASE_VB.w / z, vh = BASE_VB.h / z;
    // blend the view center toward the corner as zoom grows
    const k = Math.min(1, (z - 1) / 3);
    const mx = (BASE_VB.x + BASE_VB.w / 2) * (1 - k) + CORNER[0] * k, my = (BASE_VB.y + BASE_VB.h / 2) * (1 - k) + CORNER[1] * k;
    const x0 = mx - vw / 2, y0 = my - vh / 2;
    // raster: enlarge the 300 px picture
    const cv = $("zoomPix"), c = cv.getContext("2d"), s = RASTER_W / BASE_VB.w;
    c.imageSmoothingEnabled = false;
    c.fillStyle = css("--sheet") || "#fff"; c.fillRect(0, 0, cv.width, cv.height);
    c.drawImage(raster, (x0 - BASE_VB.x) * s, RASTER_H - (y0 + vh - BASE_VB.y) * s, vw * s, vh * s, 0, 0, cv.width, cv.height);
    const sx = (CORNER[0] - x0) / vw * cv.width, sy = cv.height - (CORNER[1] - y0) / vh * cv.height;
    c.strokeStyle = css("--interp"); c.lineWidth = 1.5; c.setLineDash([5, 4]);
    c.beginPath(); c.arc(sx, sy, 14, 0, 2 * Math.PI); c.stroke(); c.setLineDash([]);
    c.fillStyle = css("--interp"); c.font = `600 13px ${css("--mono")}`; c.textAlign = "left";
    c.fillText("corner here?", sx + 18, sy - 10);
    const pxIn = (BASE_VB.w / RASTER_W) * 12;
    facts($("zoomPixFacts"), [
      ["i", `One source pixel ≈ <span class="num">${fmt(pxIn, 1)} in</span>; at ${z}× it is just a bigger square`],
      ["i", `Corner reads as about <span class="num">(24, 15) ft ± ${fmt(pxIn / 2, 1)} in</span>`],
      ["i", `A 4½" partition is about <span class="num">${fmt(4.5 / pxIn, 1)} px</span> thick — its faces can't be measured`],
    ]);
    // vector: same window, exact
    const svg = $("zoomSvg");
    drawPlanSVG(svg, BASE, baseWalls, { viewBox: [x0, -(y0 + vh), vw, vh], dims: false, labels: z < 6, stroke: vw / 500 });
    const r = vw / 60;
    el("circle", { cx: CORNER[0], cy: -CORNER[1], r, style: `fill:none;stroke:var(--fact);stroke-width:${vw / 300}` }, svg);
    el("line", { x1: CORNER[0] - r * 2.2, y1: -CORNER[1], x2: CORNER[0] + r * 2.2, y2: -CORNER[1], style: `stroke:var(--fact);stroke-width:${vw / 500}` }, svg);
    el("line", { x1: CORNER[0], y1: -CORNER[1] - r * 2.2, x2: CORNER[0], y2: -CORNER[1] + r * 2.2, style: `stroke:var(--fact);stroke-width:${vw / 500}` }, svg);
    const tx = el("text", { x: CORNER[0] + r * 3, y: -CORNER[1] + r * 5, style: `font:600 ${vw / 34}px var(--mono);fill:var(--fact)` }, svg);
    tx.textContent = "(24.000, 15.000)";
    const half = D.tInt(BASE) / 2;
    facts($("zoomSvgFacts"), [
      ["f", `Corner at <span class="num">(24.000, 15.000) ft</span>, straight from the spec`],
      ["f", `Partition faces at <span class="num">x = ${fmt(24 - half, 4)}</span> and <span class="num">${fmt(24 + half, 4)} ft</span> (4½" wall, centered)`],
      ["f", `Window shown: <span class="num">${fmt(vw, vw < 10 ? 2 : 1)} ft</span> wide — the numbers don't change with zoom`],
    ]);
  }
  $("zoom").addEventListener("input", drawZoom);

  // ---------- Test 3: edit the spec (type it or drag it) ----------
  const ta = $("specText"), esvg = $("editSvg");
  let lastSpec = null, lastWalls = null, timer, token = 0, frozenVB = null;
  const undo = [];

  // Spec -> YAML in the same compact style as the hand-written spec.
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  function yv(v) {
    if (typeof v === "number") return String(r4(v));
    if (Array.isArray(v)) return "[" + v.map(yv).join(", ") + "]";
    if (typeof v === "string") return /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) && !/^(true|false|null|yes|no|on|off)$/i.test(v) ? v : JSON.stringify(v);
    return JSON.stringify(v);
  }
  const flow = (o) => "{" + Object.keys(o).map((k) => `${k}: ${yv(o[k])}`).join(", ") + "}";
  function toYAML(spec) {
    const L = ["# Demo cottage (fictional). Units: feet. Origin = living room SW corner.", "# Edited in the browser: every drag is written back here as numbers."];
    const known = ["project", "wall_system", "rooms", "doors", "windows", "dim_chains"];
    if (spec.project != null) L.push(`project: ${JSON.stringify(spec.project)}`);
    if (spec.wall_system) L.push(`wall_system: ${flow(spec.wall_system)}`);
    for (const k of ["rooms", "doors", "windows", "dim_chains"]) {
      if (!spec[k] || !spec[k].length) continue;
      L.push(`${k}:`); for (const o of spec[k]) L.push("  - " + flow(o));
    }
    const rest = {}; for (const k in spec) if (!known.includes(k)) rest[k] = spec[k];
    if (Object.keys(rest).length) L.push(window.jsyaml.dump(rest, { flowLevel: 2 }).trimEnd());
    return L.join("\n") + "\n";
  }

  // Keep the view steady while editing; refit only when the plan outgrows it (or on a preset).
  let editVB = null;
  function fitVB(spec) {
    const e = D.extents(spec), m = 6;
    return [e.minx - m, -(e.maxy + m), e.maxx - e.minx + 2 * m, e.maxy - e.miny + 2 * m];
  }
  function draw(spec, walls, vb) {
    if (!vb) {
      const f = fitVB(spec);
      const inside = editVB && f[0] >= editVB[0] && f[1] >= editVB[1] && f[0] + f[2] <= editVB[0] + editVB[2] && f[1] + f[3] <= editVB[1] + editVB[3];
      if (!inside) editVB = f;
      vb = editVB;
    }
    const out = drawPlanSVG(esvg, spec, walls, { viewBox: vb });
    drawSelection(spec, out);
    return out;
  }
  // Selected room: gold outline + a rotate handle in its top-right corner.
  let selRoom = null;
  function handleOf(spec, vb) {
    const r = selRoom && spec.rooms.find((rr) => rr.name === selRoom);
    if (!r) return null;
    const rad = Math.max(vb[2] / 45, Math.min(r.w, r.h) / 7, 0.5);
    return { r, cx: r.x + r.w - rad * 1.3, cy: r.y + r.h - rad * 1.3, rad };
  }
  function drawSelection(spec, vb) {
    $("rotRoom").disabled = !(selRoom && spec.rooms.some((rr) => rr.name === selRoom));
    if (typeof drag !== "undefined" && drag && drag.hit && drag.hit.kind !== "room") return;
    const h = handleOf(spec, vb);
    if (!h) return;
    const sw = vb[2] / 300, r = h.r;
    el("rect", { x: r.x, y: -(r.y + r.h), width: r.w, height: r.h, style: `fill:none;stroke:var(--gold);stroke-width:${sw};stroke-dasharray:${sw * 4} ${sw * 3};pointer-events:none` }, esvg);
    const g = el("g", { style: "cursor:pointer" }, esvg);
    el("circle", { cx: h.cx, cy: -h.cy, r: h.rad, style: `fill:var(--gold);stroke:var(--sheet);stroke-width:${sw}` }, g);
    const t = el("text", { x: h.cx, y: -h.cy, "text-anchor": "middle", "dominant-baseline": "central", style: `font:700 ${h.rad * 1.5}px var(--body);fill:#0D1B2A;pointer-events:none` }, g);
    t.textContent = "⟳";
    const tt = el("title", {}, g); tt.textContent = "Rotate room 90°";
  }
  // Rotate a room 90° counter-clockwise about its center; doors and windows move with their walls.
  function rotateRoom(spec, name) {
    const s2 = clone(spec), r = s2.rooms.find((rr) => rr.name === name);
    if (!r) return null;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, w = r.w, h = r.h;
    r.w = h; r.h = w;
    r.x = snapTo(cx - r.w / 2); r.y = snapTo(cy - r.h / 2);
    const MAP = { S: "E", E: "N", N: "W", W: "S" };
    for (const list of ["doors", "windows"]) for (const o of s2[list] || []) {
      if (o.room !== name) continue;
      const flip = o.side === "E" || o.side === "W";
      o.offset = r4(flip ? h - o.offset - o.width : o.offset);
      o.side = MAP[o.side];
    }
    return s2;
  }
  function doRotate() {
    if (!lastSpec || !selRoom) return;
    const s2 = rotateRoom(lastSpec, selRoom);
    if (!s2) return;
    undo.push(ta.value); $("undoBtn").disabled = false;
    ta.value = toYAML(s2);
    const r = s2.rooms.find((rr) => rr.name === selRoom);
    renderEdit();
    $("dragInfo").textContent = `🟢 ${r.name} rotated 90°: now ${D.ftin(r.w)} × ${D.ftin(r.h)} at (${D.ftin(r.x)}, ${D.ftin(r.y)}); its doors and windows moved with their walls`;
  }

  async function renderSpec(spec, opts = {}) {
    const my = ++token, err = $("specErr");
    let walls;
    try { walls = D.buildWalls(spec).walls; }
    catch (ex) { err.hidden = false; err.textContent = "🔴 BLOCKED — " + ex.message; $("dxfBtn").disabled = true; lastSpec = null; return; }
    err.hidden = true;
    lastSpec = spec; lastWalls = walls; $("dxfBtn").disabled = false;
    const vb = draw(spec, walls, opts.viewBox);
    if (opts.highlight) opts.highlight(vb);
    const tier = $("tier2").checked ? 2 : 1;
    const gate = D.validate(spec, tier), chains = chainStatus(spec);
    const failed = gate.report.filter((r) => r.problems.length);
    const chainsBad = chains.filter((c) => !c.ok);
    // two rooms can't claim the same floor
    const overlaps = [];
    spec.rooms.forEach((a, i) => spec.rooms.forEach((b, j) => {
      if (j <= i) return;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > 1e-6 && h > 1e-6) overlaps.push(`${a.name} and ${b.name} overlap by ${fmt(w * h, 1)} sf`);
    }));
    if (overlaps.length) chainsBad.push(...overlaps);
    $("editStatus").textContent = `Tier ${tier} · ${gate.released && !chainsBad.length ? "released" : tier === 1 ? "advisory" : "held"}`;
    const fp = await D.fingerprint(walls);
    if (my !== token) return; // a newer render has started
    const rows = [["f", `Fingerprint <span class="num">${fp.slice(0, 16)}…</span>`], ["f", `Wall area <span class="num">${fmt(polyArea(walls), 3)} sf</span>`]];
    for (const c of chains) {
      const segs = c.chain.segments.map(D.ftin).join(" + ");
      rows.push(c.ok ? ["f", `<span class="num">${segs} = ${D.ftin(c.chain.overall)}</span> — adds up and lands on walls, drawn`]
        : !c.closes ? ["b", `<span class="num">${segs} = ${D.ftin(c.sum)} ≠ ${D.ftin(c.chain.overall)}</span> — dimension string refused, fix the spec`]
        : ["b", `Dimension string ends at <span class="num">${c.offWall.map(D.ftin).join(", ")}</span> where there is no wall — refused`]);
    }
    for (const o of overlaps) rows.push(["b", `${o} — rooms can't share floor area`]);
    if (tier === 2) rows.push(failed.length ? ["b", `Gate: ${failed.length} room${failed.length > 1 ? "s" : ""} fail — not released as permit-intent`] : ["f", "Gate: every room meets the minimums — released"]);
    else rows.push(["i", `Tier 1 is advisory: ${failed.length ? failed.length + " issue(s) noted, not enforced" : "no issues noted"}`]);
    facts($("editFacts"), rows);
    const tb = $("gateTable");
    tb.innerHTML = "<thead><tr><th>Room</th><th>Size</th><th>Area</th><th>Check</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const r of gate.report) {
      const tr = document.createElement("tr");
      const mark = r.problems.length ? (tier === 2 ? '<span class="tm b">🔴 FAIL</span>' : '<span class="tm i">🟡 NOTE</span>') : '<span class="tm f">🟢 PASS</span>';
      tr.innerHTML = `<td></td><td class="n">${D.ftin(r.w)} × ${D.ftin(r.h)}</td><td class="n">${fmt(r.area, 0)} sf</td><td>${mark} <span></span></td>`;
      tr.cells[0].textContent = r.room;
      tr.cells[3].lastChild.textContent = r.problems.join("; ");
      body.appendChild(tr);
    }
    tb.appendChild(body);
  }
  function renderEdit() {
    let spec;
    try { spec = D.parse(ta.value); }
    catch (ex) {
      const err = $("specErr");
      err.hidden = false; err.textContent = "🔴 BLOCKED — " + (ex.reason || ex.message);
      $("editStatus").textContent = "spec error"; $("dxfBtn").disabled = true; lastSpec = null;
      return;
    }
    return renderSpec(spec);
  }
  function pushUndo() { undo.push(ta.value); if (undo.length > 50) undo.shift(); $("undoBtn").disabled = false; }
  let focusVal = null;
  ta.addEventListener("focus", () => { focusVal = ta.value; });
  ta.addEventListener("change", () => { if (focusVal != null && focusVal !== ta.value) { undo.push(focusVal); $("undoBtn").disabled = false; } focusVal = ta.value; });
  ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(renderEdit, 250); });
  $("tier2").addEventListener("change", renderEdit);
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => { pushUndo(); editVB = null; ta.value = PRESETS[b.dataset.preset]; renderEdit(); }));
  $("undoBtn").addEventListener("click", () => {
    if (!undo.length) return;
    ta.value = undo.pop(); $("undoBtn").disabled = !undo.length; renderEdit();
    $("dragInfo").textContent = "Undone.";
  });
  $("dxfBtn").addEventListener("click", () => {
    if (!lastSpec) return;
    const blob = new Blob([D.toDXF(lastSpec, lastWalls)], { type: "application/dxf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "fieldcomm-draw-demo.dxf";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ----- drag-and-drop: every drag edits spec numbers, snapped to real units -----
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const snapStep = () => +$("snap").value;
  const snapTo = (v) => { const s = snapStep(); return r4(Math.round(v / s) * s); };
  function toWorld(ev) {
    const pt = esvg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(esvg.getScreenCTM().inverse());
    return [q.x, -q.y];
  }
  function worldPerPx() { const vb = esvg.viewBox.baseVal; return vb.width / esvg.getBoundingClientRect().width; }
  function wallLen(r, side) { return side === "N" || side === "S" ? r.w : r.h; }
  function openingSeg(spec, o) {
    const r = spec.rooms.find((rr) => rr.name === o.room);
    if (o.side === "N" || o.side === "S") { const y = o.side === "N" ? r.y + r.h : r.y; return { axis: "y", c: y, lo: r.x + o.offset, hi: r.x + o.offset + o.width }; }
    const x = o.side === "E" ? r.x + r.w : r.x; return { axis: "x", c: x, lo: r.y + o.offset, hi: r.y + o.offset + o.width };
  }
  function roomEdges(spec) {
    const E = [];
    spec.rooms.forEach((r, i) => {
      E.push({ i, which: "x0", axis: "x", c: r.x, lo: r.y, hi: r.y + r.h }, { i, which: "x1", axis: "x", c: r.x + r.w, lo: r.y, hi: r.y + r.h },
        { i, which: "y0", axis: "y", c: r.y, lo: r.x, hi: r.x + r.w }, { i, which: "y1", axis: "y", c: r.y + r.h, lo: r.x, hi: r.x + r.w });
    });
    return E;
  }
  // All room edges on the same line that touch the grabbed one: they move together, like a real wall.
  function wallGroup(spec, e) {
    // Porches only join when their edge overlaps the grabbed wall (not just touching an end).
    const porch = (f) => spec.rooms[f.i].type === "porch" && f.i !== e.i;
    const same = roomEdges(spec).filter((f) => f.axis === e.axis && Math.abs(f.c - e.c) < 1e-6);
    const g = [e]; let grew = true;
    while (grew) {
      grew = false;
      for (const f of same) if (!g.some((h) => h.i === f.i && h.which === f.which) && g.some((h) => (porch(f) ? f.lo < h.hi - 1e-6 && f.hi > h.lo + 1e-6 : f.lo <= h.hi + 1e-6 && f.hi >= h.lo - 1e-6))) { g.push(f); grew = true; }
    }
    return g;
  }
  function hitTest(spec, p) {
    const tol = Math.max(12 * worldPerPx(), 0.35), te = D.tExt(spec);
    for (const list of ["doors", "windows"]) for (let k = 0; k < (spec[list] || []).length; k++) {
      const s = openingSeg(spec, spec[list][k]);
      const along = s.axis === "y" ? p[0] : p[1], across = s.axis === "y" ? p[1] : p[0];
      if (along >= s.lo - 0.2 && along <= s.hi + 0.2 && Math.abs(across - s.c) <= te / 2 + tol * 0.6) return { kind: "opening", list, k };
    }
    let best = null, bd = tol;
    for (const e of roomEdges(spec)) {
      const along = e.axis === "x" ? p[1] : p[0], across = e.axis === "x" ? p[0] : p[1];
      if (along < e.lo - 0.05 || along > e.hi + 0.05) continue;
      const d = Math.abs(across - e.c);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) return { kind: "wall", edge: best };
    const inside = spec.rooms.map((r, i) => ({ r, i })).filter(({ r }) => p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h)
      .sort((a, b) => a.r.w * a.r.h - b.r.w * b.r.h);
    return inside.length ? { kind: "room", i: inside[0].i } : null;
  }
  function moveChains(spec, axis, c0, c1) {
    for (const ch of spec.dim_chains || []) {
      const H = (ch.orient || "H") === "H";
      if ((axis === "x") === H) { // wall line crosses this chain: move matching ticks
        const base = H ? ch.p0[0] : ch.p0[1];
        let acc = base; const ticks = [base];
        ch.segments.forEach((s) => { acc += s; ticks.push(acc); });
        if (!ticks.some((t) => Math.abs(t - c0) < 1e-4)) continue;
        const nt = ticks.map((t) => (Math.abs(t - c0) < 1e-4 ? c1 : t)).map(r4).sort((a, b) => a - b);
        if (H) ch.p0[0] = nt[0]; else ch.p0[1] = nt[0];
        ch.segments = nt.slice(1).map((t, k) => r4(t - nt[k]));
        ch.overall = r4(nt[nt.length - 1] - nt[0]);
      } else { // wall parallel to the chain's baseline: keep the string the same distance off the wall
        const b = H ? 1 : 0;
        if (Math.abs(ch.p0[b] - c0) < 1e-4) ch.p0[b] = r4(c1);
      }
    }
  }
  function clampOpenings(spec, i) {
    const r = spec.rooms[i];
    for (const list of ["doors", "windows"]) for (const o of spec[list] || []) if (o.room === r.name)
      o.offset = r4(Math.max(0, Math.min(o.offset, wallLen(r, o.side) - o.width)));
  }
  function applyDrag(start, hit, p0, p) {
    const spec = clone(start);
    if (hit.kind === "wall") {
      const e = hit.edge, raw = (e.axis === "x" ? p[0] - p0[0] : p[1] - p0[1]);
      let d = snapTo(e.c + raw) - e.c;
      const group = wallGroup(start, e);
      for (const g of group) { // keep every room at least 1 ft
        const r = start.rooms[g.i], len = e.axis === "x" ? r.w : r.h;
        if (g.which.endsWith("1")) d = Math.max(d, 1 - len); else d = Math.min(d, len - 1);
      }
      d = r4(d);
      for (const g of group) {
        const r = spec.rooms[g.i];
        if (g.which === "x0") { r.x = r4(r.x + d); r.w = r4(r.w - d); shiftOpenings(spec, r.name, ["N", "S"], -d); }
        if (g.which === "x1") r.w = r4(r.w + d);
        if (g.which === "y0") { r.y = r4(r.y + d); r.h = r4(r.h - d); shiftOpenings(spec, r.name, ["E", "W"], -d); }
        if (g.which === "y1") r.h = r4(r.h + d);
        clampOpenings(spec, g.i);
      }
      moveChains(spec, e.axis, e.c, r4(e.c + d));
      const names = group.map((g) => spec.rooms[g.i]).filter((r, k, a) => a.indexOf(r) === k)
        .map((r) => `${r.name} ${D.ftin(r.w)} × ${D.ftin(r.h)}`);
      return { spec, info: `🟢 Wall at ${e.axis} = ${D.ftin(r4(e.c + d))} (moved ${d >= 0 ? "+" : "−"}${D.ftin(Math.abs(d))}) · ${names.join(" · ")}`, line: { axis: e.axis, c: r4(e.c + d), group } };
    }
    if (hit.kind === "room") {
      const r0 = start.rooms[hit.i], r = spec.rooms[hit.i];
      r.x = snapTo(r0.x + p[0] - p0[0]); r.y = snapTo(r0.y + p[1] - p0[1]);
      return { spec, info: `🟢 ${r.name} SW corner at (${D.ftin(r.x)}, ${D.ftin(r.y)}) · ${D.ftin(r.w)} × ${D.ftin(r.h)}`, room: hit.i };
    }
    const o0 = start[hit.list][hit.k], o = spec[hit.list][hit.k], s = openingSeg(start, o0);
    const r = spec.rooms.find((rr) => rr.name === o.room);
    const raw = s.axis === "y" ? p[0] - p0[0] : p[1] - p0[1];
    o.offset = r4(Math.max(0, Math.min(snapTo(o0.offset + raw), wallLen(r, o.side) - o.width)));
    return { spec, info: `🟢 ${hit.list === "doors" ? "Door" : "Window"} in ${o.room}, ${o.side} wall: ${D.ftin(o.offset)} from the corner, ${D.ftin(o.width)} wide`, opening: hit };
  }
  function shiftOpenings(spec, room, sides, d) {
    for (const list of ["doors", "windows"]) for (const o of spec[list] || []) if (o.room === room && sides.includes(o.side)) o.offset = r4(o.offset + d);
  }
  function highlighter(res, spec) {
    return (vb) => {
      const sw = vb[2] / 250, st = `stroke:var(--gold);stroke-width:${sw};fill:none;pointer-events:none`;
      if (res.line) for (const g of res.line.group) {
        const r = spec.rooms[g.i];
        const [x1, y1, x2, y2] = res.line.axis === "x" ? [res.line.c, r.y, res.line.c, r.y + r.h] : [r.x, res.line.c, r.x + r.w, res.line.c];
        el("line", { x1, y1: -y1, x2, y2: -y2, style: st }, esvg);
      }
      if (res.room != null) { const r = spec.rooms[res.room]; el("rect", { x: r.x, y: -(r.y + r.h), width: r.w, height: r.h, style: st }, esvg); }
      if (res.opening) {
        const s = openingSeg(spec, spec[res.opening.list][res.opening.k]);
        const [x1, y1, x2, y2] = s.axis === "y" ? [s.lo, s.c, s.hi, s.c] : [s.c, s.lo, s.c, s.hi];
        el("line", { x1, y1: -y1, x2, y2: -y2, style: st.replace(`stroke-width:${sw}`, `stroke-width:${sw * 2.5}`) }, esvg);
      }
    };
  }
  let drag = null;
  esvg.addEventListener("pointerdown", (ev) => {
    if (!lastSpec || ev.button > 0) return;
    const p = toWorld(ev), vbb = esvg.viewBox.baseVal, hd = handleOf(lastSpec, [vbb.x, vbb.y, vbb.width, vbb.height]);
    if (hd && Math.hypot(p[0] - hd.cx, p[1] - hd.cy) <= hd.rad * 1.2) { ev.preventDefault(); doRotate(); return; }
    const hit = hitTest(lastSpec, p);
    if (!hit) { if (selRoom) { selRoom = null; renderEdit(); } return; }
    if (hit.kind === "room") selRoom = lastSpec.rooms[hit.i].name;
    ev.preventDefault();
    esvg.setPointerCapture(ev.pointerId);
    const vb = esvg.viewBox.baseVal;
    frozenVB = [vb.x, vb.y, vb.width, vb.height];
    drag = { start: clone(lastSpec), hit, p0: p, before: ta.value, moved: false };
  });
  esvg.addEventListener("pointermove", (ev) => {
    if (!drag) {
      if (!lastSpec || ev.pointerType !== "mouse") return;
      const pw = toWorld(ev), vbh = esvg.viewBox.baseVal, hd = handleOf(lastSpec, [vbh.x, vbh.y, vbh.width, vbh.height]);
      if (hd && Math.hypot(pw[0] - hd.cx, pw[1] - hd.cy) <= hd.rad * 1.2) { esvg.style.cursor = "pointer"; return; }
      const h = hitTest(lastSpec, pw);
      esvg.style.cursor = !h ? "default" : h.kind === "room" ? "move" : h.kind === "opening" ? "grab"
        : h.edge.axis === "x" ? "ew-resize" : "ns-resize";
      return;
    }
    const res = applyDrag(drag.start, drag.hit, drag.p0, toWorld(ev));
    drag.moved = true;
    ta.value = toYAML(res.spec);
    $("dragInfo").textContent = res.info;
    renderSpec(res.spec, { viewBox: frozenVB, highlight: highlighter(res, res.spec) });
  });
  function endDrag() {
    if (!drag) return;
    if (drag.moved && ta.value !== drag.before) { undo.push(drag.before); $("undoBtn").disabled = false; }
    drag = null; frozenVB = null;
    renderEdit();
  }
  esvg.setAttribute("tabindex", "0");
  esvg.addEventListener("keydown", (ev) => {
    if ((ev.key === "r" || ev.key === "R") && selRoom) { ev.preventDefault(); doRotate(); }
  });
  $("rotRoom").addEventListener("click", doRotate);
  esvg.addEventListener("pointerup", endDrag);
  esvg.addEventListener("pointercancel", endDrag);

  // ---------- start ----------
  function all() { buildRaster(); drawZoom(); }
  ta.value = SPEC_TEXT;
  generate(); all(); renderEdit();
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { all(); renderEdit(); generate(); });
})();
