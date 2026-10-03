// Replaying Indian market history: what if you had stopped at the start of a past year, and
// markets and prices then did exactly what they did? Random simulations show the odds; a replay
// shows real bad starts (2000, 2008…) on your own plan.
//
// Before FIRE the plan grows with steady returns, as in the headline. From the FIRE year the
// savings are held and drawn as the withdrawal plan says (the same buckets and refill rule as the
// simulation), and each year uses that calendar year's actual equity return and inflation.
// Spending rises with the actual inflation instead of the assumed one. Debt uses its own history
// when there is one; otherwise debt and cash keep their assumed return above inflation. After the
// history runs out, the plan's assumptions take over.

import { accumulate, withdrawalSchedule, legacyAt } from "./project.js";
import { bucketSplit, bucketReturns, CASH_YEARS, DEBT_YEARS } from "./risk.js";

/** Start years need at least this many years of history to say anything about a bad start. */
export const MIN_HISTORY_YEARS = 10;

/**
 * One row per calendar year that has an equity return: { year, equity, debt?, inflation? }.
 * `history.years` maps year → { equity, debt? } (fractions); `inflation` maps year → fraction.
 */
export function historyRows(history, inflation = {}) {
  const years = Object.keys(history?.years || {}).map(Number).sort((a, b) => a - b);
  const rows = [];
  for (const y of years) {
    const x = history.years[y];
    if (x?.equity == null) continue;
    if (rows.length && rows.at(-1).year !== y - 1) rows.length = 0; // keep the latest unbroken run
    rows.push({ year: y, equity: x.equity, debt: x.debt ?? null, inflation: inflation[y] ?? null });
  }
  return rows;
}

/** Stopping at year t with `start` saved, then living through history from rows[i] on. */
function replay(inp, p, rows, i, t, start, ws, ret) {
  const W = ws.length, ai = p.infl.general;
  // Assumed growth after the history ends (the simulation's middle case).
  const br = bucketReturns(bucketSplit(Math.max(0, start - ws[t]), ws[t]), p.rPost, ret);
  let cash = 0, debt = 0, eq = 0, prices = 1, eqUp = true;
  for (let T = t; T < W; T++) {
    const row = rows[i + T - t];
    const w = ws[T] * prices; // spending follows actual prices since you stopped
    if (T === t) {
      if (start < w) return { lasts: false, runsOutAge: p.age + T };
      ({ cash, debt, equity: eq } = bucketSplit(start - w, w));
    } else {
      if (w < 0) cash -= w;
      else {
        let left = w;
        const fc = Math.min(cash, left); cash -= fc; left -= fc;
        const fd = Math.min(debt, left); debt -= fd; left -= fd;
        if (left > 0) { if (eq < left) return { lasts: false, runsOutAge: p.age + T }; eq -= left; }
      }
      const need = Math.max(0, w);
      const topC = Math.min(debt, Math.max(0, need * CASH_YEARS - cash)); cash += topC; debt -= topC;
      if (eqUp) { const topD = Math.min(eq, Math.max(0, need * DEBT_YEARS - debt)); debt += topD; eq -= topD; }
    }
    let e, d, c;
    if (row) {
      const pi = row.inflation ?? ai, real = (1 + pi) / (1 + ai);
      e = 1 + row.equity;
      d = row.debt != null ? 1 + row.debt : (1 + ret.debt) * real;
      c = (1 + ret.cash) * real;
      prices *= real;
    } else { e = 1 + br.equity; d = 1 + br.debt; c = 1 + br.cash; }
    cash *= c; debt *= d; eq *= e;
    eqUp = e >= 1;
  }
  const end = cash + debt + eq, keep = legacyAt(inp, p, W) * prices;
  return end >= keep ? { lasts: true, end } : { lasts: false, runsOutAge: p.planUntilAge, end };
}

/**
 * Every start year with enough history, stopping at year t (from today) with the steady plan's
 * savings. Returns null when there's too little history.
 */
export function replayHistory(inp, p, rows, t, path) {
  const starts = rows.length - MIN_HISTORY_YEARS + 1;
  if (starts <= 0) return null;
  const ws = withdrawalSchedule(inp, p, {});
  const maxT = ws.length - 1;
  t = Math.min(Math.max(0, t), maxT);
  path = path || accumulate(inp, p, maxT);
  const ret = { equity: 0.11, debt: 0.07, cash: 0.05, ...(inp.assetReturns || {}) };
  const out = [];
  for (let i = 0; i < starts; i++) out.push({ year: rows[i].year, years: rows.length - i, ...replay(inp, p, rows, i, t, path[t], ws, ret) });
  const failed = out.filter((x) => !x.lasts);
  const worst = failed.length ? failed.reduce((a, b) => (b.runsOutAge < a.runsOutAge ? b : a)) : null;
  return { t, age: p.age + t, from: rows[0].year, to: rows.at(-1).year, starts: out, lasted: out.length - failed.length, total: out.length, worst };
}

/**
 * The first stopping year, from `fromT` on, at which every start year in history lasts; null if
 * none before the plan-until age.
 */
export function historySafe(inp, p, rows, fromT = 0) {
  if (rows.length < MIN_HISTORY_YEARS) return null;
  const maxT = withdrawalSchedule(inp, p, {}).length - 1, path = accumulate(inp, p, maxT);
  for (let t = Math.max(0, fromT); t <= maxT; t++) {
    const r = replayHistory(inp, p, rows, t, path);
    if (r && r.lasted === r.total) return r;
  }
  return null;
}

/**
 * One past year replayed from the year you stop (year t from today): markets and prices from
 * `year` on, then the plan's assumptions. Null if that year isn't in the history.
 */
export function replayYear(inp, p, rows, year, t, path) {
  const i = rows.findIndex((r) => r.year === year);
  if (i < 0) return null;
  const ws = withdrawalSchedule(inp, p, {});
  const maxT = ws.length - 1;
  t = Math.min(Math.max(0, t), maxT);
  path = path || accumulate(inp, p, maxT);
  const ret = { equity: 0.11, debt: 0.07, cash: 0.05, ...(inp.assetReturns || {}) };
  return { year, t, age: p.age + t, saved: path[t], ...replay(inp, p, rows, i, t, path[t], ws, ret) };
}

/** The first stopping year from `fromT` on that lasts if `year` happens the year you stop. */
export function survivesYear(inp, p, rows, year, fromT = 0) {
  const maxT = withdrawalSchedule(inp, p, {}).length - 1, path = accumulate(inp, p, maxT);
  for (let t = Math.max(0, fromT); t <= maxT; t++) {
    const r = replayYear(inp, p, rows, year, t, path);
    if (!r) return null;
    if (r.lasts) return r;
  }
  return null;
}
