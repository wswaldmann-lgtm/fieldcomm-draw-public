/* FieldComm Draw — browser port of engine/floorplan.py (geometry + gate only).
 *
 * Same method as the Python engine:
 *   exterior walls = (union of rooms, each grown by the exterior wall thickness)
 *                    minus (union of rooms)            [a mitred offset of the footprint]
 *   partitions     = shared room edges, centered, interior wall thickness, flat ends
 *   openings       = door/window rectangles cut through the walls
 * Everything is polygon math on feet. No pixels are involved until display.
 * Requires polygon-clipping (global `polygonClipping`) and js-yaml (global `jsyaml`).
 */
(function (global) {
  "use strict";
  const PC = global.polygonClipping;

  const WALL_T = { "2x4": 5.5 / 12, "2x6": 7.25 / 12, "2x4_int": 4.5 / 12, "2x6_int": 6.5 / 12 };
  const EPS = 1e-9;

  // Room catalog: same minimums as lib/primitives.py (FBC 2023 Residential / IRC 2021 baseline)
  const CATALOG = {
    habitable: { label: "Habitable room", area: 70, dim: 7, note: "IRC R304" },
    living: { label: "Living / great room", area: 120, dim: 10, note: "IRC R304.1" },
    kitchen: { label: "Kitchen", area: 50, dim: 3, note: "" },
    bedroom: { label: "Bedroom", area: 70, dim: 7, note: "R304 + egress R310" },
    bathroom: { label: "Bathroom", area: 18, dim: 2.5, note: "P2705" },
    closet: { label: "Closet", area: 4, dim: 2, note: "" },
    utility: { label: "Laundry / utility", area: 12, dim: 2.5, note: "" },
    circulation: { label: "Hall", area: 0, dim: 3, note: "R311.6" },
    garage: { label: "Garage", area: 200, dim: 10, note: "" },
    porch: { label: "Porch", area: 0, dim: 4, note: "" },
  };

  function tExt(spec) { return WALL_T[(spec.wall_system || {}).exterior || "2x6"]; }
  function tInt(spec) { return WALL_T[((spec.wall_system || {}).interior || "2x4") + "_int"]; }

  function rect(x0, y0, x1, y1) { return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]; }

  function parse(text) {
    const spec = global.jsyaml.load(text);
    if (!spec || !Array.isArray(spec.rooms) || !spec.rooms.length) throw new Error("The spec needs a rooms: list.");
    spec.rooms.forEach((r, i) => {
      ["x", "y", "w", "h"].forEach((k) => {
        if (typeof r[k] !== "number") throw new Error(`Room ${i + 1} (${r.name || "unnamed"}) needs a number for ${k}.`);
      });
      if (r.w <= 0 || r.h <= 0) throw new Error(`Room ${r.name}: width and height must be positive.`);
    });
    const names = new Set(spec.rooms.map((r) => r.name));
    [...(spec.doors || []), ...(spec.windows || [])].forEach((o) => {
      if (!names.has(o.room)) throw new Error(`Opening refers to a room that doesn't exist: "${o.room}".`);
    });
    return spec;
  }

  function openingRect(spec, op, depth) {
    const r = spec.rooms.find((rr) => rr.name === op.room);
    const { x, y, w, h } = r, off = op.offset, wid = op.width;
    switch (op.side) {
      case "S": return rect(x + off, y - depth, x + off + wid, y + depth);
      case "N": return rect(x + off, y + h - depth, x + off + wid, y + h + depth);
      case "W": return rect(x - depth, y + off, x + depth, y + off + wid);
      case "E": return rect(x + w - depth, y + off, x + w + depth, y + off + wid);
    }
    throw new Error(`Opening side must be N, S, E or W (got "${op.side}").`);
  }

  // Is point (x, y) within `tol` of the footprint outline?
  function nearOutline(footprint, x, y, tol) {
    for (const poly of footprint) for (const ring of poly)
      for (let k = 0; k < ring.length - 1; k++) {
        const [ax, ay] = ring[k], [bx, by] = ring[k + 1];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= tol + 1e-9) return true;
      }
    return false;
  }

  // Shared edges between rooms -> centered partition rectangles (flat caps).
  // Like the Python engine, partition ends that meet the outer walls stop 0.02 ft
  // short (Python: interior lines minus footprint.boundary.buffer(0.02)).
  const TRIM = 0.02;
  function partitions(rooms, half, footprint) {
    const segs = [];
    const out = segs;
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        // vertical shared edge
        for (const [xa, xb] of [[a.x + a.w, b.x], [b.x + b.w, a.x]]) {
          if (Math.abs(xa - xb) < 1e-6) {
            let y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
            if (y1 - y0 > EPS) {
              if (nearOutline(footprint, xa, y0, 0)) y0 += TRIM;
              if (nearOutline(footprint, xa, y1, 0)) y1 -= TRIM;
              out.push(rect(xa - half, y0, xa + half, y1));
            }
          }
        }
        // horizontal shared edge
        for (const [ya, yb] of [[a.y + a.h, b.y], [b.y + b.h, a.y]]) {
          if (Math.abs(ya - yb) < 1e-6) {
            let x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
            if (x1 - x0 > EPS) {
              if (nearOutline(footprint, x0, ya, 0)) x0 += TRIM;
              if (nearOutline(footprint, x1, ya, 0)) x1 -= TRIM;
              out.push(rect(x0, ya - half, x1, ya + half));
            }
          }
        }
      }
    }
    return out;
  }

  function buildWalls(spec, opts) {
    const rooms = spec.rooms, te = tExt(spec), ti = tInt(spec);
    const boxes = rooms.map((r) => rect(r.x, r.y, r.x + r.w, r.y + r.h));
    const footprint = PC.union(...boxes);
    const grown = PC.union(...rooms.map((r) => rect(r.x - te, r.y - te, r.x + r.w + te, r.y + r.h + te)));
    let walls = PC.difference(grown, footprint);
    const parts = partitions(rooms, ti / 2, footprint);
    if (parts.length) walls = PC.union(walls, ...parts);
    if (!(opts && opts.noOpenings)) {
      const depth = Math.max(te, ti) + 0.2;
      const cuts = [...(spec.doors || []), ...(spec.windows || [])].map((op) => openingRect(spec, op, depth));
      if (cuts.length) walls = PC.difference(walls, ...cuts);
    }
    return { walls, footprint };
  }

  // Gate: same rules as validate() in engine/floorplan.py
  function validate(spec, tier) {
    const winRooms = new Set((spec.windows || []).map((w) => w.room));
    const report = spec.rooms.map((r) => {
      const std = CATALOG[r.type || "habitable"];
      const area = r.w * r.h, minDim = Math.min(r.w, r.h), problems = [];
      if (!std) problems.push(`unknown room type "${r.type}"`);
      else {
        if (std.area && area < std.area) problems.push(`area ${area.toFixed(0)} sf < ${std.area} sf min`);
        if (std.dim && minDim < std.dim) problems.push(`narrowest side ${minDim.toFixed(1)} ft < ${std.dim} ft min`);
      }
      if (r.type === "bedroom" && !winRooms.has(r.name)) problems.push("no egress window (IRC R310)");
      return { room: r.name, type: r.type || "habitable", w: r.w, h: r.h, area, problems };
    });
    const failed = report.some((x) => x.problems.length);
    const released = tier === 1 ? true : !failed;
    const status = tier === 1 ? "SCHEMATIC DESIGN — compliance advisory"
      : failed ? "PERMIT-INTENT — PENDING REVIEW (gate failures)" : "PERMIT-INTENT — CAD-READY";
    return { report, released, status };
  }

  // Dimension strings: a chain is only drawn if its segments add up to the overall.
  function checkChains(spec) {
    return (spec.dim_chains || []).map((c) => {
      const sum = c.segments.reduce((a, b) => a + b, 0);
      return { chain: c, sum, closes: Math.abs(sum - c.overall) < 1e-6 };
    });
  }

  // Fingerprint: SHA-256 of the sorted, rounded wall-polygon coordinates.
  async function fingerprint(walls) {
    const rings = [];
    for (const poly of walls) for (const ring of poly)
      rings.push(ring.map((pt) => pt.map((v) => Math.round(v * 1e5) / 1e5)));
    const key = rings.map((r) => JSON.stringify(r)).sort();
    const buf = new TextEncoder().encode(key.join("|"));
    if (!(global.crypto && global.crypto.subtle)) return fallbackHash(key.join("|"));
    const dig = await global.crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function fallbackHash(s) { // FNV-1a, only if WebCrypto is unavailable (e.g. http:// on some browsers)
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("fnv1a-" + h.toString(16)).padEnd(64, "0");
  }

  function extents(spec) {
    const xs = [], ys = [];
    spec.rooms.forEach((r) => { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); });
    return { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
  }

  function ftin(ft) {
    const neg = ft < 0; ft = Math.abs(ft);
    let f = Math.floor(ft + 1e-9), i = Math.round((ft - f) * 12);
    if (i === 12) { f += 1; i = 0; }
    return (neg ? "-" : "") + `${f}'-${i}"`;
  }

  // Minimal DXF (R12 entities) — walls as closed outlines, glazing lines, room labels.
  function toDXF(spec, walls) {
    const L = [];
    const p = (...a) => L.push(...a.map(String));
    p(0, "SECTION", 2, "ENTITIES");
    for (const poly of walls) for (const ring of poly)
      for (let k = 0; k < ring.length - 1; k++)
        p(0, "LINE", 8, "A-WALL-FULL", 10, ring[k][0], 20, ring[k][1], 30, 0, 11, ring[k + 1][0], 21, ring[k + 1][1], 31, 0);
    for (const o of spec.windows || []) {
      const r = spec.rooms.find((rr) => rr.name === o.room);
      let a, b;
      if (o.side === "N" || o.side === "S") { const y = o.side === "N" ? r.y + r.h : r.y; a = [r.x + o.offset, y]; b = [r.x + o.offset + o.width, y]; }
      else { const x = o.side === "E" ? r.x + r.w : r.x; a = [x, r.y + o.offset]; b = [x, r.y + o.offset + o.width]; }
      p(0, "LINE", 8, "A-GLAZ", 10, a[0], 20, a[1], 30, 0, 11, b[0], 21, b[1], 31, 0);
    }
    for (const r of spec.rooms)
      p(0, "TEXT", 8, "A-ANNO-TEXT", 10, r.x + r.w / 2, 20, r.y + r.h / 2, 30, 0, 40, 0.6, 1, r.name, 72, 1, 11, r.x + r.w / 2, 21, r.y + r.h / 2, 31, 0);
    p(0, "ENDSEC", 0, "EOF");
    return L.join("\n") + "\n";
  }

  global.FCDraw = { parse, buildWalls, validate, checkChains, fingerprint, extents, ftin, toDXF, tExt, tInt, CATALOG };
})(window);
