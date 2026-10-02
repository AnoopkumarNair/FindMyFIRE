// Small infographics for the simple results view, drawn in code (no image files, nothing
// fetched). Colours come from CSS classes so they follow the light and dark themes.
import { h } from "./dom.js";

const S = (tag, attrs, ...kids) => h(`svg:${tag}`, attrs, ...kids);

/**
 * Your journey on one line: today → your goal → when work becomes optional → the age the money
 * lasts to. The working years are drawn in the accent colour, the years after in sun.
 */
export function journey({ age, goal, stop, until }) {
  const W = 340, x0 = 22, x1 = W - 22, y = 52;
  const span = Math.max(1, until - age);
  const X = (a) => x0 + ((Math.min(Math.max(a, age), until) - age) / span) * (x1 - x0);
  const reached = stop != null && stop <= until;
  const xs = reached ? X(stop) : x1;
  const label = (x, line1, line2, anchor = "middle", cls = "") =>
    S("text", { x, y: y + 30, "text-anchor": anchor, class: `jl ${cls}` }, line1,
      line2 ? S("tspan", { x, dy: 14, class: "jl2" }, line2) : null);
  return S("svg", { viewBox: `0 0 ${W} 112`, class: "info journey", role: "img",
    "aria-label": `From age ${Math.round(age)} today${reached ? `, work could become optional around ${Math.round(stop)}` : ""}; your goal is ${goal}; the plan runs to ${until}.` },
    S("path", { d: `M${x0} ${y}H${x1}`, class: "j-track" }),
    S("path", { d: `M${x0} ${y}H${xs}`, class: "j-work" }),
    reached ? S("path", { d: `M${xs} ${y}H${x1}`, class: "j-free" }) : null,
    // goal flag
    S("path", { d: `M${X(goal)} ${y}V${y - 30}`, class: "j-pole" }),
    S("path", { d: `M${X(goal)} ${y - 30}l16 5-16 5z`, class: "j-flag" }),
    S("text", { x: X(goal) + 3, y: y - 34, class: "jl jl-goal" }, `Goal ${goal}`),
    // today
    S("circle", { cx: x0, cy: y, r: 6, class: "j-dot" }),
    label(x0, "Today", String(Math.round(age)), "start"),
    // work optional: a small sun
    reached ? S("g", { class: "j-sun" },
      S("circle", { cx: xs, cy: y, r: 9 }),
      ...[0, 45, 90, 135, 180, 225, 270, 315].map((d) => {
        const a = (d * Math.PI) / 180;
        return S("path", { d: `M${xs + Math.cos(a) * 12} ${y + Math.sin(a) * 12}L${xs + Math.cos(a) * 16} ${y + Math.sin(a) * 16}` });
      })) : null,
    reached ? label(xs, "Work optional", `around ${Math.round(stop)}`, xs > W - 70 ? "end" : "middle", "jl-strong") : null,
    // the end of the plan
    S("circle", { cx: x1, cy: y, r: 5, class: "j-end" }),
    !reached || X(stop) < x1 - 60 ? label(x1, "Money lasts", `to ${until}`, "end") : null);
}

/** A jar filled to how far your savings are on the way to what your goal needs. */
export function jar(fraction) {
  const f = Math.min(1, Math.max(0, fraction || 0));
  const top = 18, bottom = 74, fillY = bottom - f * (bottom - top);
  return S("svg", { viewBox: "0 0 64 84", class: "info jar", "aria-hidden": "true" },
    S("defs", {}, S("clipPath", { id: "jar-clip" }, S("path", { d: "M14 18h36v52a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z" }))),
    S("rect", { x: 14, y: fillY, width: 36, height: bottom + 10 - fillY, class: "jar-fill", "clip-path": "url(#jar-clip)" }),
    S("path", { d: "M14 18h36v52a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z", class: "jar-glass" }),
    S("rect", { x: 11, y: 10, width: 42, height: 9, rx: 3, class: "jar-lid" }),
    S("text", { x: 32, y: 54, "text-anchor": "middle", class: "jar-text" }, `${Math.round(f * 100)}%`));
}
