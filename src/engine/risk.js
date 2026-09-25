// Market randomness and "what would get you there".
//
// The main projection uses one steady return a year. Real markets don't: two plans with the same
// average can end very differently if the bad years come early in retirement. This simulates
// many possible market histories and counts how often the money lasts.

import { preFireFlows, withdrawalsFrom, analyse, requiredMonthlySip } from "./project.js";

// Small seeded generator so the same plan always shows the same percentage.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normals(count, seed) {
  const rnd = mulberry32(seed), out = new Float64Array(count);
  for (let i = 0; i < count; i += 2) {
    const u = Math.max(rnd(), 1e-12), v = rnd(), m = Math.sqrt(-2 * Math.log(u));
    out[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < count) out[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return out;
}

/**
 * Share of simulated market histories in which the money lasts until plan-until age, for each
 * whole-year FIRE point t = 0..maxT. Yearly growth is (1 + expected return) × e^(σ·z): the
 * assumed returns are the median outcome, and the same market history is reused for every
 * FIRE age so the answers are comparable.
 */
export function chanceByFireYear(inp, p, { runs = 1000, seed = 20260925 } = {}) {
  const horizon = Math.max(1, Math.floor(p.planUntilAge - p.age) + 1);
  const maxT = horizon - 1;
  const z = normals(runs * horizon, seed);
  const flows = preFireFlows(inp, p, maxT);
  const volPre = inp.assumptions["risk.volatilityBeforeFire"] ?? 0.13;
  const volPost = inp.assumptions["risk.volatilityAfterFire"] ?? 0.09;
  const out = [];
  for (let t = 0; t <= maxT; t++) {
    const ws = withdrawalsFrom(inp, p, {}, t);
    let ok = 0;
    for (let r = 0; r < runs; r++) {
      const zr = r * horizon;
      let c = p.corpus;
      for (let y = 0; y < t; y++) c = (c + flows[y]) * (1 + p.rPre) * Math.exp(volPre * z[zr + y]);
      let lasted = true;
      for (let k = 0; k < ws.length; k++) {
        c -= ws[k];
        if (c < 0) { lasted = false; break; }
        c *= (1 + p.rPost) * Math.exp(volPost * z[zr + t + k]);
      }
      if (lasted) ok++;
    }
    out.push({ t, age: p.age + t, chance: ok / runs });
  }
  return out;
}

/** Largest scale in [lo, hi] for which ok(scale) holds, assuming ok is monotone decreasing. */
function bisect(ok, lo, hi, steps = 30) {
  if (!ok(lo)) return null;
  if (ok(hi)) return hi;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** Three ways to close the gap (or the room you have), each on its own. */
export function levers(inp, p, base) {
  const spendToday = inp.expenses.reduce((s, e) => s + e.monthly, 0) * (inp.postFireSpending ?? 1);
  const reaches = (scale) => analyse(inp, { ...p, expenseScale: scale }).gap >= 0;
  if (base.gap < 0) {
    const sip = requiredMonthlySip(inp, p);
    const scale = bisect(reaches, 0, 1);
    return {
      onTrack: false,
      investMore: sip == null ? null : Math.max(0, sip - p.sip),
      spendAfterFire: scale == null ? null : { from: spendToday, to: spendToday * scale },
      retireAt: base.earliestAge,
    };
  }
  const scale = bisect(reaches, 1, 4);
  return { onTrack: true, retireAt: base.earliestAge, spendAfterFire: { from: spendToday, to: spendToday * (scale ?? 1) } };
}
