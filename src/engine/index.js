// Public entry point: evaluatePlan(userFile, rulesPack) → everything the UI shows.
// Pure: no DOM, no network, no storage. Runs the same in the browser and in Node tests.

import { evaluate } from "./conditions.js";
import { confidence, bandFor } from "./confidence.js";
import { resolveInputs } from "./resolve.js";
import { makeParams, analyse, requiredMonthlySip, withdrawalsFrom, withdrawalParts, drawdown, requiredAt } from "./project.js";
import { chanceByFireYear, levers } from "./risk.js";

export { fv, pmt, nper, pvDue } from "./finance.js";
export { evaluate, getPointer, setPointer } from "./conditions.js";
export { resolveInputs, assumptionValues, ageAt } from "./resolve.js";
export { makeParams, accumulate, analyse, drawdown, withdrawalsFrom, withdrawalParts, requiredAt } from "./project.js";
export { slabTax, yearTax } from "./tax.js";
export { chanceByFireYear, levers } from "./risk.js";

function tierSpec(tier, inp) {
  const A = inp.assumptions;
  const todayMonthly = inp.expenses.reduce((s, e) => s + e.monthly, 0);
  switch (tier.basis) {
    case "essentialsOnly":
      return inp.detailed.expenses ? { essentialsOnly: true, mustGoalsOnly: true } : null;
    case "allExpenses":
      return {};
    case "allExpensesTimes":
      return { multiplier: A["tier.fatMultiplier"] ?? tier.multiplier ?? 1.5 };
    case "withPartTimeIncome":
      // Same default as the original sheet: part-time work covers half of today's spending, until 60.
      return { partTime: inp.partTime ?? { monthly: todayMonthly * 0.5, untilAge: 60, assumed: true } };
    default:
      return null;
  }
}

export function evaluatePlan(user, pack, { today = new Date() } = {}) {
  const inp = resolveInputs(user, pack, today);
  const p = makeParams(inp);
  const base = analyse(inp, p);

  // ---- derived values used by nudges and conditions ----
  const activeMonthly = (e) => e.endsAtAge == null || e.endsAtAge > inp.age;
  const monthlyExpenses = inp.expenses.filter(activeMonthly).reduce((s, e) => s + e.monthly, 0);
  const derived = {
    age: inp.age,
    yearsToFire: inp.fireTargetAge - inp.age,
    fireCorpus: inp.fireCorpus,
    emergencyFund: inp.emergencyFund,
    monthlyExpenses,
    monthlyEmi: inp.emiMonthlyNow,
    monthlySurplus: inp.takeHomeMonthly > 0
      ? inp.takeHomeMonthly - monthlyExpenses - inp.emiMonthlyNow - inp.monthlySip
      : undefined,
    emergencyShortfall: inp.detailed.holdings
      ? Math.max(0, inp.assumptions["emergency.months"] * (monthlyExpenses + inp.emiMonthlyNow) - inp.emergencyFund)
      : undefined,
  };
  const conf = confidence(user, pack, derived);
  derived.confidence = conf.score;

  // ---- range from answer uncertainty ----
  const bE = bandFor(inp.expenses.map((e) => ({ source: e.source, weight: e.monthly })), pack);
  const bC = inp.detailed.holdings
    ? bandFor(user.holdings.map((h) => ({ source: h.source, weight: h.value })), pack)
    : bandFor([{ source: user.provenance?.["/quick/investedCorpus"] || "estimate", weight: 1 }], pack);
  const pessimistic = analyse(inp, makeParams(inp, { expenseScale: 1 + bE, corpusScale: 1 - bC }));
  const optimistic = analyse(inp, makeParams(inp, { expenseScale: 1 - bE, corpusScale: 1 + bC }));

  // ---- tiers ----
  const tiers = [];
  for (const t of pack.tiers) {
    if (t.basis === "coastToday") {
      const coastToday = base.required / (1 + p.rPre) ** base.tTarget;
      tiers.push({ ...t, available: true, requiredAtTarget: coastToday, corpusToday: inp.fireCorpus,
        reached: inp.fireCorpus >= coastToday, progress: coastToday ? inp.fireCorpus / coastToday : 1 });
      continue;
    }
    const spec = tierSpec(t, inp);
    if (!spec) { tiers.push({ ...t, available: false }); continue; }
    const a = analyse(inp, p, spec);
    tiers.push({ ...t, available: true, requiredAtTarget: a.required, projectedAtTarget: a.projected,
      earliestAge: a.earliestAge, reached: a.projected >= a.required, progress: a.required ? inp.fireCorpus / a.required : 1,
      onTrack: a.required ? a.projected / a.required : 1, assumedPartTime: spec.partTime?.assumed ? spec.partTime : null });
  }

  // ---- scenarios ----
  const scenarios = pack.scenarios.map((s) => {
    const a = analyse(inp, makeParams(inp, s.changes));
    return { ...s, fireTargetAge: inp.fireTargetAge + (s.changes.fireAgeDelta || 0),
      projected: a.projected, required: a.required, gap: a.gap, earliestAge: a.earliestAge };
  });

  // ---- current path: invest until the target age, then draw down ----
  const tFire = Math.round(base.tTarget);
  const drawRows = drawdown(base.path[tFire], withdrawalsFrom(inp, p, {}, tFire), { rate: p.rPost });
  const year0 = today.getFullYear();
  const timeline = [];
  for (let t = 0; t <= tFire; t++)
    timeline.push({ t, age: inp.age + t, year: year0 + t, corpus: base.path[t], required: base.req[t], phase: "invest" });
  for (const r of drawRows.slice(1))
    timeline.push({ t: tFire + r.k, age: inp.age + tFire + r.k, year: year0 + tFire + r.k, corpus: r.begin,
      required: base.req[tFire + r.k] ?? null, phase: "retired" });
  const depletedRow = drawRows.find((r) => r.end <= 0);
  const retirementSchedule = drawRows.map((r) => ({ ...r, age: inp.age + tFire + r.k, year: year0 + tFire + r.k }));

  // ---- how the money comes out: an SWP from the corpus needed at the target age ----
  const swp = swpPlan(inp, p, pack, tFire, year0);

  // ---- market ups and downs: how often the money lasts, by FIRE age ----
  const chances = chanceByFireYear(inp, p);
  const at = (t) => chances[Math.min(Math.max(0, t), chances.length - 1)];
  const firstWith = (x) => chances.find((c) => c.chance >= x) || null;
  const chance = {
    atTarget: at(tFire).chance,
    confidentAge: firstWith(0.9)?.age ?? null,
    likelyAge: firstWith(0.75)?.age ?? null,
    byAge: chances,
  };

  // ---- where you stand: everything you own and owe, today and at the target age ----
  const propAt = (years) => inp.properties.reduce((s, x) =>
    s + (x.sellAge == null || inp.age + years < x.sellAge ? x.value * (1 + x.growth) ** years : 0), 0);
  const balance = {
    today: {
      investments: inp.fireCorpus, emergency: inp.emergencyFund, locked: inp.excludedCorpus,
      property: propAt(0), other: inp.otherAssetsValue, loans: inp.loansOutstanding,
    },
    atTarget: { investments: base.projected, property: propAt(base.tTarget) },
  };
  balance.today.netWorth = balance.today.investments + balance.today.emergency + balance.today.locked +
    balance.today.property + balance.today.other - balance.today.loans;

  const nudges = pack.nudges
    .filter((n) => { try { return evaluate(n.when, user, derived); } catch { return false; } })
    .map(({ id, severity, section, message }) => ({ id, severity, section, message }));

  return {
    inputs: inp,
    params: p,
    derived,
    target: {
      age: inp.fireTargetAge, projected: base.projected, required: base.required, gap: base.gap,
      funded: base.required ? base.projected / base.required : 1,
      firstYearWithdrawal: withdrawalsFrom(inp, p, {}, tFire)[0] ?? 0,
      requiredMonthlySip: requiredMonthlySip(inp, p),
    },
    earliestAge: base.earliestAge,
    range: { from: optimistic.earliestAge, to: pessimistic.earliestAge, expenseBand: bE, corpusBand: bC },
    confidence: conf,
    tiers,
    scenarios,
    timeline,
    retirementSchedule,
    swp,
    chance,
    levers: levers(inp, p, base),
    balance,
    depletesAtAge: depletedRow ? inp.age + tFire + depletedRow.k : null,
    nudges,
  };
}

/**
 * Systematic withdrawal plan once the corpus needed is in place: yearly amounts (paid monthly),
 * and the three buckets they come from. Cash and debt earn the rules pack's asset-class
 * returns; the equity return is whatever makes the whole corpus average the post-FIRE return
 * (the same method as the original sheet), so the user can judge whether it's realistic.
 */
function swpPlan(inp, p, pack, tFire, year0) {
  const ws = withdrawalsFrom(inp, p, {}, tFire);
  const corpus = requiredAt(inp, p, {}, tFire);
  const rows = drawdown(corpus, ws, { rate: p.rPost }).map((r) => {
    const parts = withdrawalParts(inp, p, {}, tFire + r.k);
    return { ...r, age: inp.age + tFire + r.k, year: year0 + tFire + r.k, monthly: Math.max(0, r.withdrawal) / 12,
      tax: parts.tax, gross: parts.gross, healthPremium: parts.healthPremium, spend: parts.spend, income: parts.income };
  });
  const first = rows.find((r) => r.withdrawal > 0) || rows[0];
  const ret = Object.fromEntries(pack.assetClasses.map((a) => [a.id, a.expectedReturn]));
  const invested = first ? first.cash + first.debt + first.equity : 0;
  const equityReturn = first?.equity > 0
    ? (p.rPost * invested - first.cash * ret.cash - first.debt * ret.debt) / first.equity
    : null;
  return {
    startAge: inp.age + tFire, corpus, blendedReturn: p.rPost,
    firstTax: first?.tax ?? 0, firstTaxRate: first?.gross > 0 ? first.tax / first.gross : 0,
    firstHealthPremium: first?.healthPremium ?? 0,
    health: inp.health ? { estimated: inp.health.estimated, premiumNow: inp.health.premiumNow } : null,
    firstMonthly: first ? Math.max(0, first.withdrawal) / 12 : 0,
    firstAge: first?.age ?? null,
    bucketTotal: invested + (first ? Math.max(0, first.withdrawal) : 0),
    buckets: first ? {
      cash: { amount: first.cash, years: 3, return: ret.cash },
      debt: { amount: first.debt, years: 5, return: ret.debt },
      equity: { amount: first.equity, return: equityReturn },
    } : null,
    rows,
  };
}
