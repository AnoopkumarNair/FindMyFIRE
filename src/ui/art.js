// Spot illustrations: small duotone SVGs drawn in code (no image files, nothing fetched).
// Colours come from CSS classes so they follow the theme:
//   .t tint (soft background shape)  .p primary  .s sun  .k ink line  .w page/white
import { h } from "./dom.js";

const svg = (name, ...children) =>
  h("svg:svg", { viewBox: "0 0 64 64", class: `art art-${name}`, "aria-hidden": "true", focusable: "false" }, ...children);
const c = (cx, cy, r, cls) => h("svg:circle", { cx, cy, r, class: cls });
const r = (x, y, w, hh, cls, rx = 3) => h("svg:rect", { x, y, width: w, height: hh, rx, class: cls });
const p = (d, cls) => h("svg:path", { d, class: cls });

const ART = {
  // ---- quick-pass questions ----
  birthday: () => svg("birthday",
    c(32, 34, 26, "t"),
    r(16, 34, 32, 16, "p", 4), r(16, 34, 32, 5, "s", 2),
    r(21, 25, 3, 9, "k", 1), r(30.5, 23, 3, 11, "k", 1), r(40, 25, 3, 9, "k", 1),
    p("M22.5 19c2 2.4 1 4.4 0 4.6-1.4-.2-2-2.2 0-4.6z", "s"), p("M32 17c2 2.4 1 4.4 0 4.6-1.4-.2-2-2.2 0-4.6z", "s"), p("M41.5 19c2 2.4 1 4.4 0 4.6-1.4-.2-2-2.2 0-4.6z", "s")),
  sunrise: () => svg("sunrise",
    c(32, 34, 26, "t"),
    c(32, 40, 12, "s"),
    p("M32 18v6M18 26l4 4M46 26l-4 4M12 40h6M46 40h6", "sk"),
    r(8, 40, 48, 14, "w", 0), p("M8 40h48", "kl"), p("M14 46h14M34 46h16M20 51h24", "kl2")),
  hourglass: () => svg("hourglass",
    c(32, 32, 26, "t"),
    r(20, 12, 24, 4, "p", 2), r(20, 48, 24, 4, "p", 2),
    p("M23 16h18c0 8-9 11-9 16s9 8 9 16H23c0-8 9-11 9-16s-9-8-9-16z", "w k"),
    p("M26 44c2-4 6-5 6-8 0 3 4 4 6 8z", "s"), p("M27 20h10c-1 3-5 4-5 6-0-2-4-3-5-6z", "s")),
  wallet: () => svg("wallet",
    c(32, 34, 26, "t"),
    r(12, 20, 38, 28, "p", 6), r(14, 16, 30, 8, "s", 3),
    r(36, 29, 16, 10, "w", 4), c(42, 34, 2.5, "p")),
  basket: () => svg("basket",
    c(32, 34, 26, "t"),
    p("M20 28c0-7 5-12 12-12s12 5 12 12", "kl"),
    p("M12 28h40l-5 22H17z", "p"), p("M12 28h40", "kl"),
    c(26, 24, 5, "s"), c(36, 23, 4, "s"), p("M22 36v8M32 36v8M42 36v8", "wl")),
  housekey: () => svg("housekey",
    c(32, 34, 26, "t"),
    p("M14 32 32 16l18 16v18H14z", "p"), r(27, 38, 10, 12, "w", 2),
    c(46, 44, 6, "s"), p("M42 48l-6 6M38 52l2 2", "sk")),
  jar: () => svg("jar",
    c(32, 34, 26, "t"),
    r(20, 14, 24, 6, "p", 2), p("M18 22h28v24a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6z", "w k"),
    c(27, 44, 5, "s"), c(37, 44, 5, "s"), c(32, 36, 5, "s"), c(26, 30, 3.5, "s")),
  seedling: () => svg("seedling",
    c(32, 34, 26, "t"),
    r(20, 40, 24, 12, "p", 3),
    p("M32 40V26", "kl"), p("M32 30c-8 0-12-5-12-10 7 0 12 4 12 10z", "s"), p("M32 26c0-7 5-11 12-11 0 6-5 11-12 11z", "p"),
    c(48, 16, 3, "s")),

  // ---- landing features ----
  pillars: () => svg("pillars",
    c(32, 34, 26, "t"),
    p("M12 24 32 12l20 12z", "p"), r(12, 46, 40, 6, "p", 2),
    r(17, 27, 5, 18, "s", 1), r(29.5, 27, 5, 18, "s", 1), r(42, 27, 5, 18, "s", 1)),
  house: () => svg("house",
    c(32, 34, 26, "t"),
    p("M12 30 32 14l20 16v20H12z", "p"), r(27, 36, 10, 14, "s", 2), r(16, 34, 7, 7, "w", 1), r(41, 34, 7, 7, "w", 1)),
  health: () => svg("health",
    c(32, 34, 26, "t"),
    p("M32 12 50 18v12c0 11-8 19-18 23-10-4-18-12-18-23V18z", "p"),
    r(28.5, 22, 7, 20, "s", 1.5), r(22, 28.5, 20, 7, "s", 1.5)),
  receipt: () => svg("receipt",
    c(32, 34, 26, "t"),
    p("M18 12h28v40l-4.7-3-4.6 3-4.7-3-4.6 3-4.7-3-4.7 3z", "w k"),
    p("M24 22h16M24 29h16M24 36h10", "kl"), c(42, 40, 5, "s")),
  gift: () => svg("gift",
    c(32, 34, 26, "t"),
    r(14, 28, 36, 22, "p", 3), r(12, 22, 40, 8, "p", 3),
    r(29, 22, 6, 28, "s", 0), p("M32 22c-4-8-12-8-12-3 0 3 6 3 12 3zM32 22c4-8 12-8 12-3 0 3-6 3-12 3z", "s")),
  umbrella: () => svg("umbrella",
    c(32, 34, 26, "t"),
    p("M10 44 22 30l8 8 14-18", "kl red"),
    p("M24 30a16 16 0 0 1 32 0z", "p"), p("M40 30v16a4 4 0 0 1-8 0", "kl"), c(50, 16, 3, "s")),
  ask: () => svg("ask",
    c(32, 32, 28, "t"),
    p("M14 18a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H30l-9 8v-8h-1a6 6 0 0 1-6-6z", "p"),
    p("M21 21h16M21 27h11", "kl"),
    p("M45 34l2.2 5.3 5.3 2.2-5.3 2.2L45 49l-2.2-5.3-5.3-2.2 5.3-2.2z", "s")),
  lock: () => svg("lock",
    c(32, 32, 28, "t"),
    r(18, 14, 28, 40, "p", 6), r(22, 18, 20, 30, "w", 3),
    p("M27 32v-4a5 5 0 0 1 10 0v4", "kl"), r(25, 32, 14, 11, "s", 2.5), c(32, 37.5, 1.8, "p")),

  // ---- how it works ----
  pen: () => svg("pen",
    c(32, 34, 26, "t"),
    r(14, 14, 30, 38, "w k", 4), p("M20 24h18M20 31h18M20 38h10", "kl"),
    p("M40 44 52 28l4 3-12 16-5 2z", "s"), p("M52 28l4 3", "kl")),
  target: () => svg("target",
    c(32, 34, 26, "t"),
    c(32, 34, 17, "w k"), c(32, 34, 11, "s"), c(32, 34, 5, "p"), p("M32 34 50 16M44 16h6v6", "kl")),
  path: () => svg("path",
    c(32, 34, 26, "t"),
    p("M12 50c10 0 8-12 18-12s8-12 18-14", "kl dash"), c(12, 50, 3.5, "p"),
    p("M47 12v16", "kl"), p("M47 12h10l-3 4 3 4H47z", "s")),
};

export function art(name) {
  const f = ART[name];
  return f ? f() : null;
}

/** Illustration for each quick-pass question. */
export const questionArt = {
  "q.birth": "birthday", "q.fire_age": "sunrise", "q.plan_until": "hourglass", "q.take_home": "wallet",
  "q.expenses": "basket", "q.emi": "housekey", "q.corpus": "jar", "q.sip": "seedling", "q.epf": "pillars",
};
