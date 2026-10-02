// Market randomness and "what would get you there".
//
// The main projection uses one steady return a year. Real markets don't: two plans with the same
// average can end very differently if the bad years come early in retirement. This simulates
// many possible market histories and counts how often the money lasts, with the cash, debt and
// equity buckets of the withdrawal plan each simulated separately after FIRE.

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

// The market histories are the same for every recalculation with the same settings (they're
// seeded), so their growth factors are made once and kept: the last few settings are cached.
// Before FIRE the whole portfolio moves together; after FIRE equity and debt get their own
// (independent) shocks, so the buckets can be simulated separately.
const shockCache = new Map();
function shocks(runs, horizon, seed, volPre, volEq, volDebt) {
  const key = `${runs}|${horizon}|${seed}|${volPre}|${volEq}|${volDebt}`;
  let s = shockCache.get(key);
  if (!s) {
    const z = normals(runs * horizon, seed), zd = normals(runs * horizon, seed ^ 0x5bd1e995), n = z.length;
    s = { pre: new Float64Array(n), pre12: new Float64Array(n), eq: new Float64Array(n), debt: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      s.pre[i] = Math.exp(volPre * z[i]);
      s.pre12[i] = Math.exp((volPre * z[i]) / 12); // the same shock spread over 12 months
      s.eq[i] = Math.exp(volEq * z[i]); // equity after FIRE: the same market as before, its own size
      s.debt[i] = Math.exp(volDebt * zd[i]);
    }
    shockCache.set(key, s);
    if (shockCache.size > 3) shockCache.delete(shockCache.keys().next().value);
  }
  return s;
}

/** Simulated market histories per plan. At 10,000 a result's sampling error is under ±1 point. */
export const SIMULATION_RUNS = 10000;

/** The ± range (95%) around a simulated share `p` from `runs` histories: sampling noise only. */
export const simulationMargin = (p, runs = SIMULATION_RUNS) => 1.96 * Math.sqrt((p * (1 - p)) / runs);

/** Years of withdrawals held in the cash and debt buckets (the withdrawal plan's split). */
export const CASH_YEARS = 3, DEBT_YEARS = 5;

/**
 * The yearly returns the buckets earn after stopping at year t. Cash and debt earn the rules
 * pack's asset-class returns; equity earns what makes the starting split average the assumed
 * post-FIRE return (the figure the withdrawal plan shows), so the simulation's middle outcome
 * stays close to the steady plan. When equity is too small a share for that to be sensible,
 * all three move by the same amount instead.
 */
export function bucketReturns(split, rPost, ret) {
  const total = split.cash + split.debt + split.equity;
  if (total <= 0) return { cash: rPost, debt: rPost, equity: rPost };
  const rest = rPost * total - split.cash * ret.cash - split.debt * ret.debt;
  const eq = split.equity > 0 ? rest / split.equity : null;
  if (eq != null && eq >= ret.debt && eq <= 0.18) return { cash: ret.cash, debt: ret.debt, equity: eq };
  const shift = rPost - (split.cash * ret.cash + split.debt * ret.debt + split.equity * ret.equity) / total;
  return { cash: ret.cash + shift, debt: ret.debt + shift, equity: ret.equity + shift };
}

/** Split money left after this year's withdrawal w: 3 years of it in cash, 5 in debt, the rest equity. */
export function bucketSplit(left, w) {
  const need = Math.max(0, w);
  const cash = Math.max(0, Math.min(left, need * CASH_YEARS));
  const debt = Math.max(0, Math.min(left - cash, need * DEBT_YEARS));
  return { cash, debt, equity: Math.max(0, left - cash - debt) };
}

/**
 * How often the money lasts until plan-until age, for each whole-year FIRE point t = 0..maxT.
 * Before FIRE the portfolio grows at (1 + expected return) × e^(σ·z). From FIRE on the savings
 * are held as the withdrawal plan says, and each bucket is simulated on its own: withdrawals
 * come from cash; each year cash is topped back up to 3 years from debt, and debt back up to 5
 * years from equity, but only after a year in which equity didn't fall (no selling equity at a
 * low unless cash and debt have run out). The same market histories are reused for every FIRE
 * age so the answers are comparable.
 *
 * Each FIRE year is simulated only when asked for (`at(t)`, kept once worked out). The chance
 * rises with a later stop, so the first age reaching a share (`firstWith`) is searched for
 * instead of simulating every age.
 */
export function chanceModel(inp, p, { runs = SIMULATION_RUNS, seed = 20260925 } = {}) {
  const horizon = Math.max(1, Math.floor(p.planUntilAge - p.age) + 1);
  const maxT = horizon - 1;
  const { lumps, contributions } = preFireFlows(inp, p, maxT);
  const A = inp.assumptions;
  const volPre = A["risk.volatilityBeforeFire"] ?? 0.13;
  const volEq = A["risk.volatilityEquity"] ?? 0.18;
  const volDebt = A["risk.volatilityDebt"] ?? 0.03;
  const ret = { equity: 0.11, debt: 0.07, cash: 0.05, ...(inp.assetReturns || {}) };
  const S = shocks(runs, horizon, seed, volPre, volEq, volDebt);
  const monthly = p.contributionTiming !== "yearStart", a = (1 + p.rPre) ** (1 / 12);
  // Withdrawals by year from today; stopping at t draws years t, t+1, … to the plan-until age.
  const ws = withdrawalsFrom(inp, p, {}, 0);
  const W = ws.length;
  // Steady money needed from each year on, to size the starting buckets for each FIRE year.
  const steady = new Float64Array(W + 1);
  for (let T = W - 1; T >= 0; T--) steady[T] = ws[T] + Math.max(0, steady[T + 1]) / (1 + p.rPost);

  // The savings at each year before FIRE don't depend on when you stop: built once per history.
  const P = maxT + 1, pre = new Float64Array(runs * P);
  for (let r = 0; r < runs; r++) {
    const zr = r * horizon, o = r * P;
    let c = p.corpus;
    pre[o] = c;
    for (let y = 0; y < maxT; y++) {
      const g = (1 + p.rPre) * S.pre[zr + y];
      // contributionGrowth(g − 1) without the powers: the month's growth is a × the shock's 12th root.
      let k = g;
      if (monthly) { const m1 = a * S.pre12[zr + y], m = m1 - 1; k = Math.abs(m) < 1e-12 ? 1 : (m1 * (g - 1)) / (12 * m); }
      c = (c + lumps[y]) * g + contributions[y] * k;
      pre[o + y + 1] = c;
    }
  }

  const lo = new Float64Array(W + 1), hi = new Float64Array(W + 1);
  const simulate = (t, R) => {
    if (t >= W) return 1;
    const br = bucketReturns(bucketSplit(Math.max(0, steady[t] - ws[t]), ws[t]), p.rPost, ret);
    const cg = 1 + br.cash, dg = 1 + br.debt, eg = 1 + br.equity;
    let ok = 0;
    for (let r = 0; r < R; r++) {
      const zr = r * horizon, start = pre[r * P + t];
      // Shortcut: a year's growth on the whole pot lies between its worst and best bucket's.
      // The money needed from year T on if every year went the best way (lo) or the worst way
      // (hi) brackets the real answer: below lo always fails, at or above hi always lasts.
      // Only histories in between are followed bucket by bucket, and only until it's settled.
      if (start < ws[t]) continue;
      const s = bucketSplit(start - ws[t], ws[t]);
      let cash = s.cash, debt = s.debt, eq = s.equity, alive = true;
      for (let T = t; T < W; T++) {
        if (T > t) {
          const w = ws[T];
          if (w < 0) cash -= w; // more coming in than going out: it goes to cash
          else {
            // This year's withdrawal: from cash, then debt, then (only if both are empty) equity.
            let left = w;
            const fc = Math.min(cash, left); cash -= fc; left -= fc;
            const fd = Math.min(debt, left); debt -= fd; left -= fd;
            if (left > 0) { if (eq < left) { alive = false; break; } eq -= left; }
          }
          // Refill: cash back to 3 years from debt; debt back to 5 years from equity, but only
          // after a year in which equity didn't fall.
          const need = Math.max(0, w);
          const topC = Math.min(debt, Math.max(0, need * CASH_YEARS - cash)); cash += topC; debt -= topC;
          if (eg * S.eq[zr + T - 1] >= 1) { const topD = Math.min(eq, Math.max(0, need * DEBT_YEARS - debt)); debt += topD; eq -= topD; }
        }
        cash *= cg; debt *= dg * S.debt[zr + T]; eq *= eg * S.eq[zr + T];
      }
      if (alive) ok++;
    }
    return ok / R;
  };

  const memo = new Map(), rough = new Map(), few = Math.max(1, Math.round(runs / 5));
  const clamp = (t) => Math.min(Math.max(0, t), maxT);
  const row = (t) => {
    t = clamp(t);
    if (!memo.has(t)) memo.set(t, { t, age: p.age + t, chance: simulate(t, runs) });
    return memo.get(t);
  };
  // A quick look on a fifth of the histories, only to steer the search.
  const quick = (t) => {
    if (memo.has(t)) return memo.get(t).chance;
    if (!rough.has(t)) rough.set(t, simulate(t, few));
    return rough.get(t);
  };
  return {
    maxT,
    at: row,
    /**
     * The first FIRE year whose chance reaches x, or null if none does. Bisection on the quick
     * look finds the spot; the full set of histories then confirms it (and steps if needed), so
     * the answer is the same as checking every year.
     */
    firstWith(x) {
      let l = 0, h = maxT;
      while (l < h) { const m = (l + h) >> 1; if (quick(m) >= x) h = m; else l = m + 1; }
      let t = l;
      while (t < maxT && row(t).chance < x) t++;
      if (row(t).chance < x) return null;
      while (t > 0 && row(t - 1).chance >= x) t--;
      return row(t);
    },
    /** Every FIRE year (slower: simulates them all). */
    all: () => Array.from({ length: maxT + 1 }, (_, t) => row(t)),
  };
}

/** The chance for every whole-year FIRE point t = 0..maxT (see chanceModel). */
export function chanceByFireYear(inp, p, opts) {
  return chanceModel(inp, p, opts).all();
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
