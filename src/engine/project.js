// Year-by-year projection. All amounts are nominal rupees; `t` is whole years from today.
//
// Before FIRE:  corpus(t+1) = (corpus(t) + SIP(t) + EPF(t) − goals(t)) × (1 + return before FIRE)
//               (contributions at the start of the year = the sheet's FV(..., type 1))
// After FIRE:   the withdrawal is taken at the start of each year and the rest grows, as in
//               the sheet's retirement schedule. The corpus needed at FIRE is the present value
//               of every withdrawal until `plan.untilAge` (money lasts through that year).

import { pvDue } from "./finance.js";

export function makeParams(inp, changes = {}) {
  const A = inp.assumptions;
  return {
    age: inp.age,
    fireTargetAge: inp.fireTargetAge + (changes.fireAgeDelta || 0),
    planUntilAge: inp.planUntilAge,
    infl: {
      general: A["inflation.general"] + (changes.generalInflationDelta || 0),
      health: A["inflation.health"] + (changes.healthInflationDelta || 0),
      education: A["inflation.education"],
    },
    rPre: A["return.beforeFire"] + (changes.returnBeforeFireDelta || 0),
    rPost: A["return.afterFire"] + (changes.returnAfterFireDelta || 0),
    tax: A["tax.withdrawalEffective"],
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

/** Money added (+) or taken (−) at the start of each year before FIRE: contributions, goals, lump sums. */
export function preFireFlows(inp, p, years, tier = {}) {
  const flows = [];
  for (let y = 0; y < years; y++) {
    let f = 12 * p.sip * (1 + p.stepUp) ** y + 12 * p.epf * (1 + p.incomeGrowth) ** y + inflowAt(inp, p, y);
    for (const g of inp.goals) if (goalIndex(g, p) === y && goalIncluded(g, tier)) f -= goalCost(g, p);
    flows.push(f);
  }
  return flows;
}

/** Corpus at the start of each year t = 0..years, investing until then. */
export function accumulate(inp, p, years, tier = {}) {
  const path = [p.corpus];
  let c = p.corpus;
  for (const f of preFireFlows(inp, p, years, tier)) {
    c = (c + f) * (1 + p.rPre);
    path.push(c);
  }
  return path;
}

/**
 * Amount to withdraw in year T (years from today), retired: spending net of income, grossed up
 * for tax, less any lump sum received that year. Negative means money goes back into the corpus.
 */
export function withdrawalAt(inp, p, tier, T) {
  const ageT = p.age + T;
  const active = (end) => end == null || ageT < end;
  let spend = 0;
  for (const e of inp.expenses) {
    if (!active(e.endsAtAge) || (tier.essentialsOnly && !e.essential)) continue;
    spend += 12 * e.monthly * e.postFireFactor * (1 + p.infl[e.inflation]) ** T;
  }
  spend *= (tier.multiplier ?? 1) * p.expenseScale * (inp.postFireSpending ?? 1);
  for (const l of inp.emis) if (active(l.endsAtAge)) spend += 12 * l.monthly;
  for (const g of inp.goals) if (goalIndex(g, p) === T && goalIncluded(g, tier)) spend += goalCost(g, p);

  let income = 0;
  for (const i of inp.incomesAfterFire)
    if (active(i.endsAtAge) && (i.fromAge == null || ageT >= i.fromAge)) income += 12 * i.monthly * (1 + i.growth) ** T;
  for (const x of inp.properties || [])
    if (x.sellAge == null || ageT < x.sellAge) income += (12 * x.rentMonthly - x.costsYearly) * (1 + p.infl.general) ** T;
  if (tier.partTime && ageT < tier.partTime.untilAge)
    income += 12 * tier.partTime.monthly * (1 + p.infl.general) ** T;

  return Math.max(0, spend - income) / (1 - p.tax) - inflowAt(inp, p, T);
}

export function withdrawalsFrom(inp, p, tier, t) {
  const years = Math.floor(p.planUntilAge - (p.age + t)) + 1;
  const out = [];
  for (let k = 0; k < years; k++) out.push(withdrawalAt(inp, p, tier, t + k));
  return out;
}

/**
 * Smallest corpus at the start of year t that pays every withdrawal until plan-until age.
 * Without inflows this is the present value of the withdrawals. With a late inflow the early
 * years must still be covered on their own, so it is the largest running present value.
 */
export function requiredAt(inp, p, tier, t) {
  const ws = withdrawalsFrom(inp, p, tier, t);
  if (ws.every((w) => w >= 0)) return pvDue(ws, p.rPost);
  let run = 0, need = 0;
  for (let k = 0; k < ws.length; k++) {
    run += ws[k] / (1 + p.rPost) ** k;
    need = Math.max(need, run);
  }
  return need;
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
  const req = path.map((_, t) => requiredAt(inp, p, tier, t));
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
  const tTarget = Math.min(Math.max(0, p.fireTargetAge - p.age), maxT);
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
