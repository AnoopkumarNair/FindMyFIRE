// Corpus-over-age line chart: projected corpus (series 1) vs corpus needed to stop at that age
// (series 2, dashed). One y-axis, thin lines, crosshair + tooltip on hover/touch.
import { h } from "./dom.js";
import { inrShort, age1 } from "./format.js";

export function corpusChart(points, { targetAge, earliestAge }) {
  const W = 720, H = 300, m = { l: 64, r: 16, t: 16, b: 34 };
  const x0 = points[0].age, x1 = points.at(-1).age;
  const yMax = niceMax(Math.max(...points.map((p) => Math.max(p.corpus || 0, p.required || 0))));
  const X = (a) => m.l + ((a - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (Math.max(0, v) / yMax) * (H - m.t - m.b);
  const line = (key) => points.filter((p) => p[key] != null)
    .map((p, i) => `${i ? "L" : "M"}${X(p.age).toFixed(1)},${Y(p[key]).toFixed(1)}`).join("");

  const grid = [];
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4, y = Y(v);
    grid.push(h("svg:line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: i ? "grid" : "axis" }));
    grid.push(h("svg:text", { x: m.l - 8, y: y + 4, "text-anchor": "end", class: "tick" }, inrShort(v)));
  }
  const step = x1 - x0 > 40 ? 10 : 5;
  for (let a = Math.ceil(x0 / step) * step; a <= x1; a += step)
    grid.push(h("svg:text", { x: X(a), y: H - m.b + 18, "text-anchor": "middle", class: "tick" }, String(a)));
  grid.push(h("svg:text", { x: W - m.r, y: H - 4, "text-anchor": "end", class: "tick" }, "Age"));

  const marker = (age, label, cls, dy = 0) => age == null || age < x0 || age > x1 ? null : h("svg:g", { class: cls },
    h("svg:line", { x1: X(age), x2: X(age), y1: m.t, y2: H - m.b }),
    h("svg:text", { x: X(age) + 4, y: m.t + 10 + dy }, label));

  const cross = h("svg:line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
  const dotA = h("svg:circle", { r: 4.5, class: "dot s1", visibility: "hidden" });
  const dotB = h("svg:circle", { r: 4.5, class: "dot s2", visibility: "hidden" });
  const tip = h("div", { class: "tip", hidden: true });
  const hit = h("svg:rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: "hit" });

  const svg = h("svg:svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Projected corpus compared with the corpus needed to stop working, by age" },
    ...grid,
    marker(targetAge, `Target ${targetAge}`, "mark target"),
    marker(earliestAge, `Earliest ${age1(earliestAge)}`, "mark earliest", 14),
    h("svg:path", { d: line("required"), class: "series s2" }),
    h("svg:path", { d: line("corpus"), class: "series s1 draw", pathLength: 1 }),
    cross, dotA, dotB, hit);

  const show = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    const age = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    const p = points.reduce((b, q) => (Math.abs(q.age - age) < Math.abs(b.age - age) ? q : b));
    const x = X(p.age);
    for (const el of [cross, dotA, dotB]) el.setAttribute("visibility", "visible");
    cross.setAttribute("x1", x); cross.setAttribute("x2", x);
    dotA.setAttribute("cx", x); dotA.setAttribute("cy", Y(p.corpus));
    if (p.required != null) { dotB.setAttribute("cx", x); dotB.setAttribute("cy", Y(p.required)); }
    else dotB.setAttribute("visibility", "hidden");
    tip.replaceChildren(
      h("strong", {}, `Age ${Math.floor(p.age)} · ${p.year}`),
      h("div", {}, h("span", { class: "key s1" }), `Your corpus: ${inrShort(p.corpus)}`),
      p.required != null ? h("div", {}, h("span", { class: "key s2" }), `Needed to stop now: ${inrShort(p.required)}`) : null,
      h("div", { class: "muted" }, p.phase === "invest" ? "Still investing" : "Drawing down"));
    tip.hidden = false;
    const left = (x / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 90), r.width - 90)}px`;
  };
  const hide = () => { tip.hidden = true; for (const el of [cross, dotA, dotB]) el.setAttribute("visibility", "hidden"); };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);

  return h("figure", { class: "chart" },
    h("div", { class: "legend" },
      h("span", {}, h("span", { class: "key s1" }), "Your corpus (invest until target, then withdraw)"),
      h("span", {}, h("span", { class: "key s2 dashed" }), "Corpus needed if you stop at this age")),
    h("div", { class: "plot" }, svg, tip));
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}
