// Property-based checks: rules that must hold for ANY household, run on 150 random ones.
// The generator is seeded, so a failure always reproduces; the failing household is printed.
//
// Three kinds of rule:
//  1. Direction: more cost never needs less money; more money never delays FIRE.
//  2. Same money, different wording: monthly vs yearly, one line vs two, list order, quick vs
//     detailed. None of these may change the answer.
//  3. Book-keeping: the corpus needed pays every withdrawal and ends at zero; the "what it pays
//     for" breakdown adds up; money entered twice is counted once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluatePlan, resolveInputs, makeParams, analyse, drawdown, withdrawalsFrom } from "../src/engine/index.js";

const pack = JSON.parse(readFileSync(new URL("../rules/in.2026.1.json", import.meta.url)));
const today = new Date(2026, 8, 25);
const N = 150;

// ---------- seeded random households ----------
function rng(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const between = (r, lo, hi) => lo + (hi - lo) * r();
const round = (x, to = 1000) => Math.round(x / to) * to;

function household(i) {
  const r = rng(1000 + i * 7919);
  const age = Math.floor(between(r, 25, 55));
  const birthYear = today.getFullYear() - age;
  const fire = Math.min(70, age + Math.floor(between(r, 4, 20)));
  const takeHome = round(between(r, 50000, 500000));
  const spend = round(takeHome * between(r, 0.3, 0.8));
  const emi = r() < 0.5 ? round(takeHome * between(r, 0.05, 0.3)) : 0;
  const u = {
    schemaVersion: 1, app: { rulesPack: "in", rulesPackVersion: "2026.1" }, provenance: {},
    profile: { birthYearMonth: `${birthYear}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}`, children: [] },
    plan: { fireTargetAge: fire, planUntilAge: pick(r, [85, 90, 95]) },
    sectionsDone: [],
    quick: { takeHomeMonthly: takeHome, monthlyExpenses: spend, emiMonthly: emi,
      investedCorpus: round(between(r, 0, 5e7), 10000), monthlySip: round(takeHome * between(r, 0, 0.4)), epfMonthly: round(takeHome * between(r, 0, 0.15)) },
    goals: [], inflows: [], properties: [],
  };
  if (r() < 0.5) {
    const kidBorn = today.getFullYear() - Math.floor(between(r, 0, 15));
    u.profile.children.push({ id: "c1", birthYear: kidBorn });
    u.goals.push({ id: "g1", templateId: "goal.child_ug", label: "College", atAge: kidBorn + 18 - birthYear, costToday: round(between(r, 5e5, 3e6)), priority: "must", childId: "c1", source: "estimate" });
  }
  if (r() < 0.4) u.goals.push({ id: "g2", templateId: "goal.car", label: "Car", atAge: age + Math.floor(between(r, 1, 30)), costToday: round(between(r, 3e5, 2e6)), repeatEveryYears: pick(r, [undefined, 8]), priority: "want", source: "estimate" });
  if (r() < 0.4) u.inflows.push({ id: "m1", templateId: "inflow.gratuity", label: "Gratuity", amount: round(between(r, 2e5, 2.5e6)), on: `${birthYear + fire}-06`, source: "estimate" });
  if (r() < 0.3) u.properties.push({ id: "p1", kind: "secondHome", label: "Flat", value: round(between(r, 3e6, 3e7), 1e5),
    monthlyRent: r() < 0.5 ? round(between(r, 5000, 60000)) : undefined, plan: r() < 0.5 ? "sell" : "keep",
    sellOn: `${birthYear + age + Math.floor(between(r, 2, 25))}-04`, source: "estimate" });
  if (r() < 0.3) u.insurance = { premiumAfterFire: pick(r, [0, 30000, 60000]) };
  return u;
}

/** The same household entered through the detailed sections instead of the quick answers. */
function asDetailed(u) {
  const d = structuredClone(u);
  const q = d.quick;
  d.sectionsDone = ["expenses", "holdings", "income", "loans"];
  d.expenses = [
    { id: "e1", categoryId: "other.misc", amount: q.monthlyExpenses * 0.9, frequency: "monthly", source: "exact" },
    { id: "e2", categoryId: "health.out_of_pocket", amount: q.monthlyExpenses * 0.1, frequency: "monthly", source: "exact" },
  ];
  d.holdings = [
    { id: "h1", instrumentId: "mf_equity_index", value: q.investedCorpus, monthlyContribution: q.monthlySip, asOf: "2026-09-01", source: "exact" },
    { id: "h2", instrumentId: "epf", value: 0, monthlyContribution: q.epfMonthly / 2, employerMonthlyContribution: q.epfMonthly / 2, asOf: "2026-09-01", source: "exact" },
  ];
  d.incomes = [{ id: "i1", type: "salary", monthly: q.takeHomeMonthly, source: "exact" }];
  // Quick EMIs are assumed to end before FIRE; end the loan before today so it can't run past it.
  d.liabilities = q.emiMonthly ? [{ id: "l1", type: "home", outstanding: 1e6, emi: q.emiMonthly, endsOn: "2026-08", source: "exact" }] : [];
  d.quick = {};
  return d;
}

// Fast path (no market simulation) for the many variant checks.
function core(u) {
  const inp = resolveInputs(u, pack, today);
  const p = makeParams(inp);
  const a = analyse(inp, p);
  return { inp, p, a, required: a.required, projected: a.projected, earliest: a.earliestAge ?? Infinity };
}
const where = (i, u) => `household #${i}: ${JSON.stringify({ ...u, app: undefined, provenance: undefined })}`;
const same = (x, y, rel = 1e-9) => (x === y) || Math.abs(x - y) <= rel * Math.max(1, Math.abs(x), Math.abs(y));
const each = (fn) => { for (let i = 0; i < N; i++) { const u = household(i); try { fn(u, i); } catch (e) { e.message += `\n${where(i, u)}`; throw e; } } };
const clone = (x) => structuredClone(x);

// ---------- 1. direction ----------
test("more spending never needs less money or brings FIRE earlier", () => each((u) => {
  const a = core(u), v = clone(u); v.quick.monthlyExpenses *= 1.1;
  const b = core(v);
  assert.ok(b.required >= a.required - 1e-6 && b.earliest >= a.earliest - 1e-9);
}));

test("more invested today, or more each month, never delays FIRE", () => each((u) => {
  const a = core(u);
  const v = clone(u); v.quick.investedCorpus = v.quick.investedCorpus * 1.1 + 100000;
  const w = clone(u); w.quick.monthlySip = w.quick.monthlySip * 1.1 + 1000;
  const x = clone(u); x.quick.epfMonthly = x.quick.epfMonthly * 1.1 + 1000;
  for (const y of [v, w, x]) assert.ok(core(y).earliest <= a.earliest + 1e-9);
}));

test("every added cost raises (or keeps) the corpus needed", () => each((u) => {
  const a = core(u);
  const fireAge = u.plan.fireTargetAge;
  const goal = clone(u); goal.goals.push({ id: "gx", templateId: "goal.other", label: "x", atAge: fireAge + 3, costToday: 500000, priority: "must", source: "exact" });
  const loan = clone(u); loan.sectionsDone.push("loans");
  loan.liabilities = [{ id: "lx", type: "car", outstanding: 1e6, emi: 20000, endsOn: `${Number(u.profile.birthYearMonth.slice(0, 4)) + fireAge + 4}-01`, source: "exact" }];
  const longer = clone(u); longer.plan.planUntilAge += 5;
  const premium = clone(u); premium.insurance = { premiumAfterFire: (u.insurance?.premiumAfterFire ?? 40000) + 20000 };
  const health = clone(u); health.assumptionOverrides = { "inflation.health": 0.12 };
  for (const y of [goal, loan, longer, premium, health]) assert.ok(core(y).required >= a.required - 1e-6);
}));

test("every added income or lump sum lowers (or keeps) the corpus needed", () => each((u) => {
  const a = core(u);
  const fireAge = u.plan.fireTargetAge, by = Number(u.profile.birthYearMonth.slice(0, 4));
  const lump = clone(u); lump.inflows.push({ id: "mx", templateId: "inflow.other", label: "x", amount: 1e6, on: `${by + fireAge + 2}-06`, source: "exact" });
  const pension = clone(u); pension.sectionsDone.push("income");
  pension.incomes = [{ id: "i1", type: "salary", monthly: u.quick.takeHomeMonthly, source: "exact" }, { id: "ix", type: "pension", monthly: 10000, continuesAfterFire: true, source: "exact" }];
  for (const y of [lump, pension]) assert.ok(core(y).required <= a.required + 1e-6);
}));

test("stress scenarios never make things better", () => {
  for (let i = 0; i < 25; i++) {
    const r = evaluatePlan(household(i), pack, { today });
    const s = Object.fromEntries(r.scenarios.map((x) => [x.id, x.earliestAge ?? Infinity]));
    for (const k of ["high_inflation", "low_returns", "crash_today", "crash_at_fire"]) assert.ok(s[k] >= s.base - 1e-9, `${k} on household #${i}`);
  }
});

// ---------- 2. same money, different wording ----------
test("the same household entered quick or detailed gives the same answer", () => each((u) => {
  const a = core(u), b = core(asDetailed(u));
  assert.ok(same(a.required, b.required, 1e-9), `required ${a.required} vs ${b.required}`);
  assert.ok(same(a.projected, b.projected, 1e-9), `projected ${a.projected} vs ${b.projected}`);
  assert.equal(a.earliest, b.earliest);
}));

test("monthly vs yearly, one line vs two, and list order don't change the answer", () => each((u) => {
  const d = asDetailed(u), a = core(d);
  const yearly = clone(d); yearly.expenses[0] = { ...yearly.expenses[0], amount: yearly.expenses[0].amount * 12, frequency: "annual" };
  const split = clone(d); const half = split.expenses[0].amount / 2;
  split.expenses[0].amount = half; split.expenses.push({ ...split.expenses[0], id: "e9" });
  const splitHolding = clone(d); const h = splitHolding.holdings[0];
  splitHolding.holdings.push({ ...h, id: "h9", value: h.value / 2, monthlyContribution: h.monthlyContribution / 2 });
  h.value /= 2; h.monthlyContribution /= 2;
  const shuffled = clone(d); for (const k of ["expenses", "holdings", "goals", "inflows"]) shuffled[k]?.reverse();
  for (const y of [yearly, split, splitHolding, shuffled]) {
    const b = core(y);
    assert.ok(same(a.required, b.required, 1e-9) && same(a.projected, b.projected, 1e-9));
  }
}));

// ---------- 3. book-keeping ----------
test("the corpus needed pays every withdrawal and runs out exactly at the end", () => each((u) => {
  const { inp, p } = core(u);
  const t = Math.round(Math.max(0, p.fireTargetAge - p.age));
  const ws = withdrawalsFrom(inp, p, {}, t);
  if (ws.some((w) => w < 0)) return; // lump sums make the need a running maximum; checked below
  const need = ws.reduce((s, w, k) => s + w / (1 + p.rPost) ** k, 0);
  const rows = drawdown(need, ws, { rate: p.rPost });
  assert.ok(rows.every((x) => x.end > -1e-3), "never short");
  assert.ok(Math.abs(rows.at(-1).end) < 1e-3 * Math.max(1, need), "ends at zero");
}));

test("with lump sums, the corpus needed still never runs short", () => each((u) => {
  const { inp, p } = core(u);
  const t = Math.round(Math.max(0, p.fireTargetAge - p.age));
  const ws = withdrawalsFrom(inp, p, {}, t);
  const { requiredAt } = { requiredAt: (x) => x };
  let run = 0, need = 0;
  ws.forEach((w, k) => { run += w / (1 + p.rPost) ** k; need = Math.max(need, run); });
  const rows = drawdown(need, ws, { rate: p.rPost });
  assert.ok(rows.every((x) => x.end > -1e-3 * Math.max(1, need)));
}));

test("results are finite and within range; the breakdown adds up", () => {
  for (let i = 0; i < 30; i++) {
    const u = household(i), r = evaluatePlan(u, pack, { today });
    const vals = [r.target.required, r.target.projected, r.breakdown.net, r.chance.atTarget, r.confidence.score];
    assert.ok(vals.every(Number.isFinite), `non-finite on #${i}`);
    assert.ok(r.earliestAge == null || (r.earliestAge >= r.inputs.age - 1e-9 && r.earliestAge <= r.inputs.planUntilAge), `age out of range on #${i}`);
    assert.ok(r.chance.atTarget >= 0 && r.chance.atTarget <= 1);
    assert.ok(r.target.required >= r.breakdown.net - 1, `required below breakdown on #${i}`);
    if (!r.inputs.inflows.length) assert.ok(Math.abs(r.target.required - r.breakdown.net) <= 1e-6 * r.target.required + 1, `breakdown ≠ required on #${i}`);
  }
});

test("money entered twice is counted once", () => each((u) => {
  const d = asDetailed(u);
  const by = Number(u.profile.birthYearMonth.slice(0, 4));
  d.sectionsDone.push("property");
  d.properties = [{ id: "p1", kind: "secondHome", label: "Flat", value: 1e7, monthlyRent: 20000, plan: "sell", sellOn: `${by + u.plan.fireTargetAge + 5}-04`, source: "exact" }];
  const once = core(d);
  const twice = clone(d);
  twice.incomes.push({ id: "i2", type: "rental", monthly: 20000, continuesAfterFire: true, source: "exact" });
  twice.inflows.push({ id: "m2", templateId: "inflow.property_sale", label: "Flat sale", amount: 1e7, on: `${by + u.plan.fireTargetAge + 5}-04`, source: "exact" });
  const b = core(twice);
  assert.ok(same(once.required, b.required, 1e-9) && same(once.projected, b.projected, 1e-9));
}));

test("school costs stop at 18, so they never overlap a college goal", () => each((u) => {
  if (!u.profile.children.length) return;
  const d = asDetailed(u);
  d.expenses.push({ id: "e5", categoryId: "children.school_fees", amount: 100000, frequency: "annual", source: "exact" });
  const inp = resolveInputs(d, pack, today);
  const fees = inp.expenses.find((e) => e.id === "e5");
  const kid = u.profile.children[0].birthYear, by = Number(u.profile.birthYearMonth.slice(0, 4));
  assert.equal(fees.endsAtAge, kid + 18 - by);
  const college = u.goals.find((g) => g.templateId === "goal.child_ug");
  if (college) assert.ok(college.atAge >= fees.endsAtAge);
}));
