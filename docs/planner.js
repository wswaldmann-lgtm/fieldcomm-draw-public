/* FieldComm Planner (demo) — two-week, crew-by-day production planner for construction.
 * Planned rates are estimates (🟡) until the crew's actual output measures them (🟢). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
  const KEY = "fc-planner-demo-v1";
  const NDAYS = 10; // two work weeks, Mon–Fri

  function nextMonday() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const dow = (t.getDay() + 6) % 7; // Mon = 0
    t.setDate(t.getDate() + (dow === 0 ? 0 : 7 - dow));
    return t.toISOString().slice(0, 10);
  }
  function demo() {
    return {
      ver: 1, start: nextMonday(),
      crews: [
        { id: "fA", name: "Framing crew A", trade: "framing", people: 4, hrs: 8 },
        { id: "fB", name: "Framing crew B", trade: "framing", people: 3, hrs: 8 },
        { id: "rf", name: "Roofing crew", trade: "roofing", people: 3, hrs: 8 },
        { id: "pl", name: "Plumber", trade: "plumbing", people: 2, hrs: 8 },
        { id: "el", name: "Electrician", trade: "electrical", people: 2, hrs: 8 },
      ],
      // rate = units per man-hour (estimate until measured)
      acts: [
        { id: "a1", name: "Sill plates & layout", trade: "framing", qty: 156, unit: "LF", rate: 20, pred: null },
        { id: "a2", name: "Frame walls", trade: "framing", qty: 290, unit: "LF", rate: 4, pred: "a1" },
        { id: "a3", name: "Wall sheathing", trade: "framing", qty: 70, unit: "sht", rate: 3.5, pred: "a2" },
        { id: "a4", name: "Set roof trusses", trade: "framing", qty: 22, unit: "ea", rate: 0.8, pred: "a2" },
        { id: "a5", name: "Roof sheathing", trade: "framing", qty: 42, unit: "sht", rate: 3, pred: "a4" },
        { id: "a6", name: "Windows & ext. doors", trade: "framing", qty: 11, unit: "ea", rate: 0.5, pred: "a3" },
        { id: "a7", name: "Dry-in underlayment", trade: "roofing", qty: 14, unit: "sq", rate: 1, pred: "a5" },
        { id: "a8", name: "Shingles", trade: "roofing", qty: 14, unit: "sq", rate: 0.5, pred: "a7" },
        { id: "a9", name: "Rough plumbing", trade: "plumbing", qty: 9, unit: "fixt", rate: 0.12, pred: "a7" },
        { id: "a10", name: "Rough electrical", trade: "electrical", qty: 1140, unit: "sf", rate: 25, pred: "a7" },
      ],
      sched: {}, // "day|crewId" -> [{a, plan, done, hrs}]
      out: {},   // "day|crewId" -> true  (rain, inspection, crew off)
      sel: null,
    };
  }
  let S = load() || demo();
  // pre-load the first two days so the board isn't empty
  if (!Object.keys(S.sched).length && !S._seeded) {
    S.sched["0|fA"] = [{ a: "a1", plan: 156, done: null, hrs: null }];
    S.sched["1|fA"] = [{ a: "a2", plan: 128, done: null, hrs: null }];
    S.sched["1|fB"] = [{ a: "a2", plan: 96, done: null, hrs: null }];
    S._seeded = true;
  }

  // ---------- calendar ----------
  function dayDate(d) { const t = new Date(S.start + "T00:00:00"); t.setDate(t.getDate() + d + (d >= 5 ? 2 : 0)); return t; }
  const dayName = (d) => { const t = dayDate(d); return ["Mon", "Tue", "Wed", "Thu", "Fri"][d % 5] + " " + (t.getMonth() + 1) + "/" + t.getDate(); };

  // ---------- math ----------
  const A = (id) => S.acts.find((a) => a.id === id);
  const C = (id) => S.crews.find((c) => c.id === id);
  const cell = (d, c) => (S.sched[d + "|" + c] = S.sched[d + "|" + c] || []);
  const cap = (d, c) => (S.out[d + "|" + c] ? 0 : C(c).people * C(c).hrs);
  const chipHrs = (ch) => ch.plan / A(ch.a).rate;
  const cellHrs = (d, c) => cell(d, c).reduce((s, ch) => s + chipHrs(ch), 0);
  function chips(fn) { for (const k in S.sched) { const [d, c] = k.split("|"); S.sched[k].forEach((ch, i) => fn(ch, +d, c, i)); } }
  function counted(aid) { let s = 0; chips((ch) => { if (ch.a === aid) s += ch.done != null ? ch.done : ch.plan; }); return s; }
  function doneQty(aid) { let s = 0; chips((ch) => { if (ch.a === aid && ch.done != null) s += ch.done; }); return s; }
  const toPlan = (aid) => Math.max(0, A(aid).qty - counted(aid));
  function finishDay(aid) {
    const by = Array(NDAYS).fill(0);
    chips((ch, d) => { if (ch.a === aid) by[d] += ch.done != null ? ch.done : ch.plan; });
    let s = 0;
    for (let d = 0; d < NDAYS; d++) { s += by[d]; if (s >= A(aid).qty - 1e-9) return d; }
    return null;
  }
  function measured(aid) {
    let q = 0, h = 0, n = 0, assumed = false;
    chips((ch) => {
      if (ch.a !== aid || ch.done == null) return;
      q += ch.done; n++;
      if (ch.hrs != null) h += ch.hrs; else { h += chipHrs(ch); assumed = true; }
    });
    return n && h > 0 ? { rate: q / h, n, assumed } : null;
  }
  function chipIssues(ch, d, c) {
    const a = A(ch.a), cr = C(c), out = [];
    if (S.out[d + "|" + c]) out.push("crew is OUT this day");
    if (a.trade !== cr.trade) out.push(`${a.trade} work on a ${cr.trade} crew`);
    if (a.pred) {
      const f = finishDay(a.pred);
      if (f == null) out.push(`${A(a.pred).name} isn't planned to finish in this window`);
      else if (f > d) out.push(`starts before ${A(a.pred).name} finishes (${dayName(f)})`);
    }
    return out;
  }

  // ---------- operations ----------
  function place(aid, d, c) {
    const need = toPlan(aid);
    if (need <= 0) { hint(`${A(aid).name} is fully planned.`); return; }
    const left = Math.max(0, cap(d, c) - cellHrs(d, c));
    let q = Math.floor(left * A(aid).rate);
    q = Math.max(1, Math.min(need, q));
    const ex = cell(d, c).find((ch) => ch.a === aid && ch.done == null);
    if (ex) ex.plan += q; else cell(d, c).push({ a: aid, plan: q, done: null, hrs: null });
    S.sel = null; render();
  }
  function moveChip(from, d, c) {
    const src = cell(from.d, from.c), ch = src[from.i];
    if (!ch || (from.d === d && from.c === c)) return;
    src.splice(from.i, 1);
    const ex = cell(d, c).find((x) => x.a === ch.a && x.done == null && ch.done == null);
    if (ex) ex.plan += ch.plan; else cell(d, c).push(ch);
    render();
  }

  // ---------- render ----------
  const MARK = { f: "🟢 FACT", i: "🟡 INTERP", b: "🔴 BLOCKED" };
  const tm = (k, t) => `<span class="tm ${k}">${t || MARK[k]}</span>`;
  function hint(t) { $("hint").innerHTML = t; }

  function render() {
    // backlog
    let h = "";
    for (const a of S.acts) {
      const m = measured(a.id), tp = toPlan(a.id), dn = doneQty(a.id), pct = Math.min(100, (dn / a.qty) * 100);
      const fd = finishDay(a.id);
      h += `<div class="act ${S.sel === a.id ? "sel" : ""} ${tp <= 0 ? "full" : ""}" draggable="true" data-act="${a.id}" tabindex="0" role="button" aria-pressed="${S.sel === a.id}">
        <div class="r1"><span class="trade ${a.trade}">${a.trade}</span><b>${esc(a.name)}</b></div>
        <div class="r2">${fmt(a.qty)} ${a.unit} · ${fmt(dn)} in place · <b class="${tp > 0 ? "lft" : "okc"}">${tp > 0 ? fmt(tp) + " to plan" : "fully planned"}</b></div>
        <div class="r2">${m && !m.assumed ? tm("f") : tm("i", "🟡 EST")} plan rate <input class="rate" data-rate="${a.id}" value="${fmt(a.rate, 2)}" inputmode="decimal" aria-label="Planned rate for ${esc(a.name)}"> ${a.unit}/mh
          ${m ? `<span class="meas">measured <b>${fmt(m.rate, 2)}</b>${m.assumed ? "*" : ""} <button type="button" class="use" data-use="${a.id}">use</button></span>` : ""}</div>
        <div class="r2 muted">${a.pred ? "after " + esc(A(a.pred).name) + " · " : ""}${fd != null ? "finishes " + dayName(fd) : "not finished in window"}</div>
        <div class="bar"><div style="width:${pct}%"></div></div>
      </div>`;
    }
    $("backlog").innerHTML = h;

    // grid
    let g = `<table><thead><tr><th class="crewh">Crew</th>`;
    for (let d = 0; d < NDAYS; d++) g += `<th class="${d === 5 ? "wk2" : ""}">${dayName(d)}</th>`;
    g += `</tr></thead><tbody>`;
    for (const cr of S.crews) {
      g += `<tr><th class="crew"><b>${esc(cr.name)}</b><div class="muted">${cr.trade} · ${cr.people} × ${cr.hrs} h = ${cr.people * cr.hrs} mh/day</div></th>`;
      for (let d = 0; d < NDAYS; d++) {
        const k = d + "|" + cr.id, c = cap(d, cr.id), hh = cellHrs(d, cr.id), over = hh > c + 1e-9;
        const target = S.sel && !S.out[k];
        g += `<td class="${S.out[k] ? "out" : ""} ${target ? "target" : ""} ${d === 5 ? "wk2" : ""}" data-cell="${k}">
          <div class="cap"><span class="${over ? "over" : ""}">${fmt(hh, 1)}/${fmt(c, 0)} mh</span><button type="button" class="outb ${S.out[k] ? "on" : ""}" data-out="${k}" title="Rain, inspection or crew off">${S.out[k] ? "OUT ↺" : "OUT"}</button></div>`;
        cell(d, cr.id).forEach((ch, i) => {
          const a = A(ch.a), iss = chipIssues(ch, d, cr.id), hit = ch.done != null && ch.done >= ch.plan;
          g += `<div class="chip ${iss.length ? "bad" : ""} ${hit ? "hit" : ""} t-${a.trade}" draggable="true" data-chip="${d}|${cr.id}|${i}">
            <div class="ct"><b>${esc(a.name)}</b><button type="button" class="x" data-rm="${d}|${cr.id}|${i}" aria-label="Remove">✕</button></div>
            <div class="cr"><label>plan<input data-plan="${d}|${cr.id}|${i}" value="${fmt(ch.plan)}" inputmode="numeric"></label><span class="u">${a.unit} = ${fmt(chipHrs(ch), 1)} mh</span></div>
            <div class="cr"><label>done<input class="act" data-done="${d}|${cr.id}|${i}" value="${ch.done == null ? "" : ch.done}" placeholder="—" inputmode="numeric"></label><label>hrs<input class="act sm" data-hrs="${d}|${cr.id}|${i}" value="${ch.hrs == null ? "" : ch.hrs}" placeholder="—" inputmode="decimal"></label></div>
            ${iss.map((t) => `<div class="iss">🔴 ${esc(t)}</div>`).join("")}
          </div>`;
        });
        g += `</td>`;
      }
      g += `</tr>`;
    }
    g += `</tbody></table>`;
    $("grid").innerHTML = g;

    // status
    const issues = [];
    let overCells = 0;
    for (const cr of S.crews) for (let d = 0; d < NDAYS; d++) if (cellHrs(d, cr.id) > cap(d, cr.id) + 1e-9) { overCells++; issues.push(`${cr.name} ${dayName(d)}: ${fmt(cellHrs(d, cr.id), 1)} mh planned, ${fmt(cap(d, cr.id))} available`); }
    chips((ch, d, c) => chipIssues(ch, d, c).forEach((t) => issues.push(`${A(ch.a).name} · ${C(c).name} ${dayName(d)}: ${t}`)));
    const wk = [0, 1].map((w) => {
      let p = 0, cp = 0, dn = 0;
      for (const cr of S.crews) for (let d = w * 5; d < w * 5 + 5; d++) { p += cellHrs(d, cr.id); cp += cap(d, cr.id); }
      chips((ch, d) => { if (Math.floor(d / 5) === w && ch.done != null) dn++; });
      return { p, cp, dn };
    });
    const remainMh = S.acts.reduce((s, a) => s + toPlan(a.id) / a.rate, 0);
    const freeMh = S.crews.reduce((s, cr) => { let f = 0; for (let d = 0; d < NDAYS; d++) f += Math.max(0, cap(d, cr.id) - cellHrs(d, cr.id)); return s + f; }, 0);
    const rows = [
      ["f", `Week 1: <b>${fmt(wk[0].p, 1)}</b> of ${fmt(wk[0].cp)} crew-hours planned · Week 2: <b>${fmt(wk[1].p, 1)}</b> of ${fmt(wk[1].cp)}`],
      [remainMh <= freeMh ? "f" : "b", `Unplanned work: <b>${fmt(remainMh, 0)} mh</b> at plan rates · open capacity: <b>${fmt(freeMh, 0)} mh</b>${remainMh <= freeMh ? " — fits" : " — doesn't fit in two weeks"}`],
      ["i", "Plan rates marked EST are estimates. Type what actually went in place (and the hours, if you know them); the measured rate replaces the guess. * = hours assumed from the plan."],
    ];
    if (issues.length) rows.unshift(["b", `${issues.length} issue${issues.length > 1 ? "s" : ""}: ${issues.slice(0, 4).map(esc).join(" · ")}${issues.length > 4 ? " …" : ""}`]);
    else rows.unshift(["f", "No conflicts: every crew-day is within capacity, on the right trade, and in sequence"]);
    $("status").innerHTML = rows.map(([k, t]) => `<li>${tm(k)}<span>${t}</span></li>`).join("");
    $("weekLbl").textContent = `${dayDate(0).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${dayDate(9).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    if (S.sel) hint(`👉 <b>${esc(A(S.sel).name)}</b> selected — tap a highlighted crew-day to plan it (${fmt(toPlan(S.sel))} ${A(S.sel).unit} left to plan). Tap it again to cancel.`);
    else hint(`👆 <b>Tap an activity</b>, then <b>tap a crew-day</b> — or drag it there. Drag chips between days. Yellow boxes are what <b>actually</b> went in place.`);
    save();
  }

  // ---------- events ----------
  const parseRef = (s) => { const [d, c, i] = s.split("|"); return { d: +d, c, i: +i }; };
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("input")) return;
    const use = t.closest("[data-use]");
    if (use) { const a = A(use.dataset.use), m = measured(a.id); if (m) { a.rate = Math.round(m.rate * 100) / 100; render(); } return; }
    const out = t.closest("[data-out]");
    if (out) { const k = out.dataset.out; if (S.out[k]) delete S.out[k]; else S.out[k] = true; render(); return; }
    const rm = t.closest("[data-rm]");
    if (rm) { const r = parseRef(rm.dataset.rm); cell(r.d, r.c).splice(r.i, 1); render(); return; }
    const act = t.closest("[data-act]");
    if (act) { S.sel = S.sel === act.dataset.act ? null : act.dataset.act; render(); return; }
    const td = t.closest("[data-cell]");
    if (td && S.sel && !t.closest(".chip")) { const [d, c] = td.dataset.cell.split("|"); if (!S.out[td.dataset.cell]) place(S.sel, +d, c); }
  });
  document.addEventListener("keydown", (e) => {
    const act = e.target.closest && e.target.closest("[data-act]");
    if (act && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); act.click(); }
    if (e.key === "Escape" && S.sel) { S.sel = null; render(); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target, num = (v) => (v.trim() === "" ? null : Math.max(0, parseFloat(v.replace(/,/g, "")) || 0));
    if (t.dataset.rate) { const a = A(t.dataset.rate); a.rate = Math.max(0.01, num(t.value) || a.rate); }
    else if (t.dataset.plan) { const r = parseRef(t.dataset.plan), ch = cell(r.d, r.c)[r.i]; ch.plan = Math.max(0, Math.round(num(t.value) || 0)); if (!ch.plan && ch.done == null) cell(r.d, r.c).splice(r.i, 1); }
    else if (t.dataset.done) { const r = parseRef(t.dataset.done); cell(r.d, r.c)[r.i].done = num(t.value); }
    else if (t.dataset.hrs) { const r = parseRef(t.dataset.hrs); cell(r.d, r.c)[r.i].hrs = num(t.value); }
    else return;
    render();
  });
  // drag (desktop)
  let dragData = null;
  document.addEventListener("dragstart", (e) => {
    const chip = e.target.closest && e.target.closest("[data-chip]"), act = e.target.closest && e.target.closest("[data-act]");
    if (chip) dragData = { chip: parseRef(chip.dataset.chip) }; else if (act) dragData = { act: act.dataset.act }; else return;
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x");
  });
  document.addEventListener("dragover", (e) => { const td = e.target.closest && e.target.closest("[data-cell]"); if (td && dragData) { e.preventDefault(); td.classList.add("dragover"); } });
  document.addEventListener("dragleave", (e) => { const td = e.target.closest && e.target.closest("[data-cell]"); if (td) td.classList.remove("dragover"); });
  document.addEventListener("drop", (e) => {
    const td = e.target.closest && e.target.closest("[data-cell]"); if (!td || !dragData) return;
    e.preventDefault(); const [d, c] = td.dataset.cell.split("|");
    if (dragData.act) place(dragData.act, +d, c); else moveChip(dragData.chip, +d, c);
    dragData = null;
  });

  // ---------- save / backup / export ----------
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); $("saveStat").textContent = "Saved in this browser"; } catch (e) { $("saveStat").textContent = "Not saved (browser storage off) — use Backup"; } }
  function load() { try { const o = JSON.parse(localStorage.getItem(KEY) || "null"); return o && o.ver === 1 ? o : null; } catch (e) { return null; } }
  function download(name, text, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $("backup").onclick = () => download(`fieldcomm-plan-${S.start}.json`, JSON.stringify(S, null, 1), "application/json");
  $("restore").onclick = () => $("restoreFile").click();
  $("restoreFile").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const o = JSON.parse(r.result); if (o.ver !== 1 || !Array.isArray(o.crews)) throw 0; S = o; render(); } catch (x) { hint("🔴 That file isn't a FieldComm plan backup."); } };
    r.readAsText(f); e.target.value = "";
  };
  $("csv").onclick = () => {
    const L = [["Day", "Crew", "Activity", "Plan qty", "Unit", "Plan mh", "In place", "Actual hrs", "Issues"]];
    chips((ch, d, c) => L.push([dayName(d), C(c).name, A(ch.a).name, ch.plan, A(ch.a).unit, chipHrs(ch).toFixed(1), ch.done ?? "", ch.hrs ?? "", chipIssues(ch, d, c).join("; ")]));
    download(`fieldcomm-plan-${S.start}.csv`, L.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n", "text/csv");
  };
  $("reset").onclick = () => { if (confirm("Start over with the demo plan? Your changes in this browser will be replaced.")) { S = demo(); S.sched["0|fA"] = [{ a: "a1", plan: 156, done: null, hrs: null }]; S._seeded = true; render(); } };
  $("printBtn").onclick = () => window.print();

  render();
  window.FCPlanner = { state: () => S, issues: () => { const o = []; chips((ch, d, c) => o.push(...chipIssues(ch, d, c))); return o; } };
})();
