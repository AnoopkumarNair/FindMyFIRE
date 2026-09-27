// Year-by-year projection. All amounts are nominal rupees; `t` is whole years from today.
//
// Before FIRE:  corpus(t+1) = (corpus(t) + lump sums(t) − goals(t)) × (1 + r) + contributions(t) × k(r)
//               where contributions are paid monthly through the year (SIP and PF at the start of
//               each month) and k(r) is what ₹1 of them is worth by the year end. The original
//               sheet's timing (all contributions at the start of the year, FV(..., type 1)) is
//               kept as p.contributionTiming = "yearStart" for the golden tests.
// After FIRE:   the withdrawal is taken at the start of each year and the rest grows, as in
//               the sheet's retirement schedule. The corpus needed at FIRE is the present value
//               of every withdrawal until `plan.untilAge` (money lasts through that year).

import { grossUp } from "./tax.js";
import { premiumAt } from "./resolve.js";

export function makeParams(inp, changes = {}) {
  const A = inp.assumptions;
  return {
    age: inp.age,
    fireTargetAge: inp.fireTargetAge + (changes.fireAgeDelta || 0),
    planUntilAge: inp.planUntilAge + (changes.planUntilDelta || 0),
    infl: {
      general: A["inflation.general"] + (changes.generalInflationDelta || 0),
      health: A["inflation.health"] + (changes.healthInflationDelta || 0),
      education: A["inflation.education"],
    },
    rPre: A["return.beforeFire"] + (changes.returnBeforeFireDelta || 0),
    rPost: A["return.afterFire"] + (changes.returnAfterFireDelta || 0),
    stepUp: A["sip.stepUp"],
    incomeGrowth: A["income.growth"],
    corpus: inp.fireCorpus * (1 - (changes.corpusShock || 0)) * (changes.corpusScale ?? 1),
    sip: inp.monthlySip * (changes.sipMultiplier ?? 1),
    epf: inp.epfMonthly,
    expenseScale: changes.expenseScale ?? 1,
    fireCrash: changes.crashAtFire || 0,
  };
}

const goalIndex = (g, p) => Math.floor(g.atAge - p.age);
const goalCost = (g, p) => g.costToday * (1 + g.inflationRate) ** Math.max(0, g.atAge - p.age);
const goalIncluded = (g, tier) => !tier.mustGoalsOnly || g.priority === "must";

/** Net money received (gratuity, maturities, a sale…) in year T. */
function inflowAt(inp, p, T) {
  let sum = 0;
  for (const x of inp.inflows || []) if (Math.floor(x.atAge - p.age) === T) sum += x.net;
  return sum;
}

/**
 * What ₹1 of a year's contributions is worth at the end of that year, when it's paid in 12 equal
 * monthly instalments at the start of each month and the year's return is r. Less than 1 + r,
 * because later instalments are invested for fewer months.
 */
export function contributionGrowth(r, timing = "monthly") {
  if (timing === "yearStart") return 1 + r;
  const m = (1 + r) ** (1 / 12) - 1;
  return Math.abs(m) < 1e-12 ? 1 : ((1 + m) * r) / (12 * m);
}

/**
 * Money going in before FIRE, year by year: `lumps` arrive at the start of the year (money
 * received, minus goals paid), `contributions` are the year's SIP and PF, paid monthly.
 */
export function preFireFlows(inp, p, years, tier = {}) {
  const lumps = [], contributions = [];
  for (let y = 0; y < years; y++) {
    let f = inflowAt(inp, p, y);
    for (const g of inp.goals) if (goalIndex(g, p) === y && goalIncluded(g, tier)) f -= goalCost(g, p);
    lumps.push(f);
    contributions.push(12 * p.sip * (1 + p.stepUp) ** y + 12 * p.epf * (1 + p.incomeGrowth) ** y);
  }
  return { lumps, contributions };
}

/** Corpus at the start of each year t = 0..years, investing until then. */
export function accumulate(inp, p, years, tier = {}) {
  const path = [p.corpus];
  let c = p.corpus;
  const { lumps, contributions } = preFireFlows(inp, p, years, tier);
  const k = contributionGrowth(p.rPre, p.contributionTiming);
  for (let y = 0; y < years; y++) {
    c = (c + lumps[y]) * (1 + p.rPre) + contributions[y] * k;
    path.push(c);
  }
  return path;
}

/** Everything behind one retired year's withdrawal (year T from today, nominal rupees). */
export function withdrawalParts(inp, p, tier, T) {
  const ageT = p.age + T;
  const active = (end) => end == null || ageT < end;
  let living = 0, health = 0;
  for (const e of inp.expenses) {
    if (!active(e.endsAtAge) || (tier.essentialsOnly && !e.essential)) continue;
    const x = 12 * e.monthly * e.postFireFactor * (1 + p.infl[e.inflation]) ** T;
    if (e.inflation === "health") health += x; else living += x;
  }
  const scale = (tier.multiplier ?? 1) * p.expenseScale * (inp.postFireSpending ?? 1);
  living *= scale; health *= scale;
  let spend = living + health;
  let healthPremium = 0;
  if (inp.health) {
    const grow = (1 + p.infl.health) ** T;
    healthPremium = Math.max(0, premiumAt(inp.health.table, ageT) * inp.health.scale * grow - inp.health.existingYearly * grow);
    spend += healthPremium;
  }
  let emi = 0, goals = 0;
  for (const l of inp.emis) if (active(l.endsAtAge)) emi += 12 * l.monthly;
  for (const g of inp.goals) if (goalIndex(g, p) === T && goalIncluded(g, tier)) goals += goalCost(g, p);
  spend += emi + goals;

  let income = 0, slabIncome = 0;
  for (const i of inp.incomesAfterFire)
    if (active(i.endsAtAge) && (i.fromAge == null || ageT >= i.fromAge)) {
      const x = 12 * i.monthly * (1 + i.growth) ** T;
      income += x; slabIncome += x * (i.taxShare ?? 1);
    }
  for (const x of inp.properties || [])
    if (x.sellAge == null || ageT < x.sellAge) {
      const grow = (1 + p.infl.general) ** T, rent = 12 * x.rentMonthly * grow;
      income += rent - x.costsYearly * grow;
      slabIncome += 0.7 * rent; // 30% standard deduction on rent
    }
  // Lump sums taxed with this year's income (the taxable part of an NPS lump sum): they raise the
  // tax, but the money itself arrives as an inflow.
  for (const x of inp.taxableLumps || []) if (Math.floor(x.atAge - p.age) === T) slabIncome += x.amount;
  if (tier.partTime && ageT < tier.partTime.untilAge) {
    const x = 12 * tier.partTime.monthly * (1 + p.infl.general) ** T;
    income += x; slabIncome += x;
  }

  const need = Math.max(0, spend - income);
  const deflate = (1 + p.infl.general) ** T; // slabs assumed to rise with inflation
  const gross = inp.taxCtx ? grossUp(need / deflate, slabIncome / deflate, inp.taxCtx) * deflate : need;
  const inflow = inflowAt(inp, p, T);
  return { spend, living, health, healthPremium, emi, goals, income, need, tax: gross - need, gross, inflow, withdrawal: gross - inflow };
}

/**
 * Amount to take from the corpus in year T: spending net of income, plus the year's tax, less
 * any lump sum received that year. Negative means money goes back into the corpus.
 */
export function withdrawalAt(inp, p, tier, T) {
  return withdrawalParts(inp, p, tier, T).withdrawal;
}

// A retired year's withdrawal depends only on the year, not on when you stopped working, so the
// whole schedule is worked out once per set of assumptions (params object) and reused.
const scheduleCache = new WeakMap();

/** Withdrawals for every year T = 0 .. (plan-until age − today's age), for these inputs and params. */
export function withdrawalSchedule(inp, p, tier = {}) {
  let byInp = scheduleCache.get(p);
  if (!byInp) scheduleCache.set(p, (byInp = new WeakMap()));
  let byTier = byInp.get(inp);
  if (!byTier) byInp.set(inp, (byTier = new Map()));
  const key = JSON.stringify(tier);
  let s = byTier.get(key);
  if (!s) {
    const last = Math.floor(p.planUntilAge - p.age);
    s = [];
    for (let T = 0; T <= last; T++) s.push(withdrawalAt(inp, p, tier, T));
    byTier.set(key, s);
  }
  return s;
}

export function withdrawalsFrom(inp, p, tier, t) {
  return withdrawalSchedule(inp, p, tier).slice(t);
}

/**
 * Smallest corpus at the start of each year t that pays every withdrawal until plan-until age.
 * Without inflows this is the present value of the withdrawals. With a late inflow the early
 * years must still be covered on their own, so it is the largest running present value. Worked
 * backwards in one pass: best(t) = w(t) + max(0, best(t+1)) / (1 + r).
 */
export function requiredAll(inp, p, tier = {}) {
  const ws = withdrawalSchedule(inp, p, tier), out = new Array(ws.length);
  let best = 0;
  for (let t = ws.length - 1; t >= 0; t--) {
    best = ws[t] + Math.max(0, best) / (1 + p.rPost);
    out[t] = Math.max(0, best);
  }
  return out;
}

export function requiredAt(inp, p, tier, t) {
  return requiredAll(inp, p, tier)[t] ?? 0;
}

const lerp = (arr, x) => {
  const i = Math.floor(x), f = x - i;
  return i + 1 < arr.length ? arr[i] * (1 - f) + arr[i + 1] * f : arr[Math.min(i, arr.length - 1)];
};

/**
 * Earliest FIRE: the first year the projected corpus covers the corpus needed from then on.
 * The fraction between two years is interpolated linearly on the gap.
 */
export function analyse(inp, p, tier = {}) {
  const maxT = Math.max(0, Math.floor(p.planUntilAge - p.age) - 1);
  const path = accumulate(inp, p, maxT, tier);
  const all = requiredAll(inp, p, tier);
  const req = path.map((_, t) => all[t] ?? 0);
  // Scenario: a crash in the first year of retirement hits whatever corpus you retire with.
  const hit = (x) => x * (1 - (p.fireCrash || 0));
  let earliestT = null;
  for (let t = 0; t <= maxT; t++) {
    const gap = hit(path[t]) - req[t];
    if (gap >= 0) {
      if (t === 0) earliestT = 0;
      else {
        const prev = hit(path[t - 1]) - req[t - 1];
        earliestT = t - 1 + prev / (prev - gap);
      }
      break;
    }
  }
  // The target is valued at a whole plan year (the one containing the target age), so the headline,
  // the breakdown, the SWP plan and the chart all describe the same moment.
  const tTarget = Math.min(Math.max(0, Math.round(p.fireTargetAge - p.age)), maxT);
  const projected = hit(lerp(path, tTarget));
  const required = lerp(req, tTarget);
  return {
    path, req, tTarget, projected, required,
    gap: projected - required,
    earliestAge: earliestT == null ? null : p.age + earliestT,
  };
}

/** Monthly SIP (today, stepped up each year) needed to reach the target corpus at the target age. */
export function requiredMonthlySip(inp, p, tier = {}) {
  const at = (sip) => analyse(inp, { ...p, sip }, tier);
  const a0 = at(0), a1 = at(1);
  const perRupee = a1.projected - a0.projected;
  if (perRupee <= 0) return null;
  return Math.max(0, (a0.required - a0.projected) / perRupee);
}

/**
 * The sheet's retirement schedule. Buckets are informational (3 years of withdrawals in cash,
 * 5 in debt, the rest in equity), refilled every year. Growth is either one blended rate or
 * each bucket at its own rate (the original sheet's method).
 */
export function drawdown(start, withdrawals, { rate, bucketRates, cashYears = 3, debtYears = 5 }) {
  const rows = [];
  let d = start;
  for (let k = 0; k < withdrawals.length; k++) {
    const w = withdrawals[k];
    const alive = d > 0 || w < 0;
    const need = Math.max(0, w);
    const cash = alive ? Math.min(d - w, need * cashYears) : 0;
    const debt = alive ? Math.min(d - w - cash, need * debtYears) : 0;
    const equity = alive ? Math.max(0, d - w - cash - debt) : 0;
    const growth = !alive ? 0 : bucketRates
      ? cash * bucketRates.cash + debt * bucketRates.debt + equity * bucketRates.equity
      : (d - w) * rate;
    const end = alive ? d - w + growth : 0;
    rows.push({ k, begin: d, withdrawal: w, cash, debt, equity, growth, end, shortfall: Math.max(0, -end) });
    d = Math.max(0, end);
  }
  return rows;
}
