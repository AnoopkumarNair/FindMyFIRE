import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluatePlan, evaluate, fv, pvDue, resolveInputs, makeParams, analyse, withdrawalsFrom, drawdown, requiredAt,
  withdrawalParts, slabTax, yearTax,
} from "../src/engine/index.js";

const requiredAtFor = (inp, p, t) => requiredAt(inp, p, {}, t);

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const pack = load("../rules/in.2026.1.json");
const quick = load("../examples/user-quick.example.json");
const detailed = load("../examples/user-detailed.example.json");
const today = new Date(2026, 8, 25);
const clone = (x) => structuredClone(x);

test("fv matches known spreadsheet values", () => {
  assert.equal(Math.round(fv(0.1, 10, -1000, 0, 0)), 15937);
  assert.equal(Math.round(fv(0.1, 10, -1000, 0, 1)), 17531);
  assert.equal(fv(0, 5, -100, -1000), 1500);
});

test("conditions: pointers, derived values and ops", () => {
  const u = { plan: { fireTargetAge: 45 }, holdings: [{ instrumentId: "ppf" }], profile: { children: [] } };
  assert.equal(evaluate({ ref: "/plan/fireTargetAge", op: "lt", value: 60 }, u), true);
  assert.equal(evaluate({ ref: "/holdings", op: "hasInstrument", value: "ppf" }, u), true);
  assert.equal(evaluate({ ref: "/profile/children", op: "nonEmpty" }, u), false);
  assert.equal(evaluate({ ref: "/insurance/termCover", op: "missing" }, u), true);
  assert.equal(evaluate({ ref: "$x", op: "gt", value: 0 }, u, { x: 5 }), true);
  assert.equal(evaluate({ all: [{ ref: "$x", op: "gt", value: 0 }, { not: { ref: "$x", op: "eq", value: 5 } }] }, u, { x: 5 }), false);
});

test("quick file: resolves quick answers and splits out healthcare", () => {
  const inp = resolveInputs(quick, pack, today);
  assert.equal(inp.fireCorpus, 900000);
  assert.equal(inp.monthlySip, 30000);
  const total = inp.expenses.reduce((s, e) => s + e.monthly, 0);
  assert.equal(total, 40000);
  assert.equal(inp.expenses.find((e) => e.inflation === "health").monthly, 4000);
});

test("detailed file: detailed sections replace quick answers", () => {
  const inp = resolveInputs(detailed, pack, today);
  // NPS (locked till 60) and the emergency FD are excluded.
  assert.equal(inp.fireCorpus, 1800000 + 1200000 + 1400000 + 600000 + 200000 + 100000);
  assert.equal(inp.emergencyFund, 500000);
  assert.equal(inp.epfMonthly, 14000);
  assert.equal(inp.monthlySip, 25000 + 15000 + 5000);
  assert.ok(inp.detailed.expenses && inp.detailed.holdings);
});

test("required corpus is the present value of withdrawals and is exactly enough", () => {
  const inp = resolveInputs(quick, pack, today);
  const p = makeParams(inp);
  const t = 15;
  const ws = withdrawalsFrom(inp, p, {}, t);
  const need = pvDue(ws, p.rPost);
  const rows = drawdown(need, ws, { rate: p.rPost });
  assert.ok(Math.abs(rows.at(-1).end) < 1e-3, `ends at ${rows.at(-1).end}`);
  assert.ok(rows.slice(0, -1).every((r) => r.end > 0));
  assert.equal(ws.length, Math.floor(p.planUntilAge - (p.age + t)) + 1);
});

test("earliest FIRE age is where projected meets required", () => {
  const inp = resolveInputs(quick, pack, today);
  const p = makeParams(inp);
  const a = analyse(inp, p);
  assert.ok(a.earliestAge > inp.age && a.earliestAge < p.planUntilAge);
  // Between the two plan years around the earliest age, the gap crosses zero.
  const t = a.earliestAge - inp.age, i = Math.floor(t), f = t - i;
  const gap = (k) => a.path[k] - a.req[k];
  assert.ok(gap(i) < 0 && gap(i + 1) >= 0);
  assert.ok(Math.abs(gap(i) * (1 - f) + gap(i + 1) * f) < 1e-6 * a.req[i]);
});

test("stress scenarios move the answer the right way", () => {
  const r = evaluatePlan(quick, pack, { today });
  const s = Object.fromEntries(r.scenarios.map((x) => [x.id, x]));
  assert.ok(s.high_inflation.earliestAge > s.base.earliestAge);
  assert.ok(s.low_returns.earliestAge > s.base.earliestAge);
  assert.ok(s.crash_today.earliestAge > s.base.earliestAge);
  assert.ok(s.sip_plus_25.earliestAge < s.base.earliestAge);
  assert.ok(r.range.from <= r.earliestAge && r.earliestAge <= r.range.to);
});

test("more spending means a later FIRE age; more SIP means earlier", () => {
  const base = evaluatePlan(quick, pack, { today }).earliestAge;
  const spend = clone(quick); spend.quick.monthlyExpenses *= 1.2;
  const invest = clone(quick); invest.quick.monthlySip *= 1.5;
  assert.ok(evaluatePlan(spend, pack, { today }).earliestAge > base);
  assert.ok(evaluatePlan(invest, pack, { today }).earliestAge < base);
});

test("tiers: Lean needs detailed expenses; Lean < Standard < Fat", () => {
  const q = evaluatePlan(quick, pack, { today });
  assert.equal(q.tiers.find((t) => t.id === "lean").available, false);
  const d = evaluatePlan(detailed, pack, { today });
  const T = Object.fromEntries(d.tiers.map((t) => [t.id, t]));
  assert.ok(T.lean.requiredAtTarget < T.standard.requiredAtTarget);
  assert.ok(T.standard.requiredAtTarget < T.fat.requiredAtTarget);
  assert.ok(T.barista.requiredAtTarget < T.standard.requiredAtTarget);
  assert.ok(T.coast.requiredAtTarget < T.standard.requiredAtTarget);
});

test("confidence: detailed answers score higher than the quick pass", () => {
  const q = evaluatePlan(quick, pack, { today }).confidence.score;
  const d = evaluatePlan(detailed, pack, { today }).confidence.score;
  assert.ok(q > 0 && q < d && d <= 100);
});

test("nudges fire from rules-pack conditions", () => {
  const ids = evaluatePlan(detailed, pack, { today }).nudges.map((n) => n.id);
  assert.ok(ids.includes("nps_locked"));
  assert.ok(ids.includes("no_health_cover"));
  assert.ok(ids.includes("emergency_short"));
});

test("a goal before FIRE reduces the projected corpus", () => {
  const u = clone(quick);
  const before = evaluatePlan(u, pack, { today }).target.projected;
  u.goals = [{ id: "g", templateId: "goal.car", label: "Car", atAge: 35, costToday: 1000000, source: "estimate" }];
  assert.ok(evaluatePlan(u, pack, { today }).target.projected < before);
});

test("inflows: before FIRE they compound, after FIRE they cut the corpus needed", () => {
  const base = evaluatePlan(quick, pack, { today });
  const u = clone(quick);
  // Born 1996-07 → age 30.2 on the test date; target 45.
  u.inflows = [{ id: "a", templateId: "inflow.gratuity", label: "Early", amount: 1000000, on: "2031-07", source: "exact" }];
  const early = evaluatePlan(u, pack, { today });
  // Credited at the start of the plan year it falls in (as the sheet does), then invested to the target.
  const age = early.inputs.age;
  const years = Math.round(45 - age) - Math.floor(35 - age); // target valued at a whole plan year
  const expected = 1000000 * (1 + early.params.rPre) ** years;
  assert.ok(Math.abs(early.target.projected - base.target.projected - expected) / expected < 0.01);
  assert.equal(early.target.required, base.target.required);

  u.inflows = [{ id: "b", templateId: "inflow.gratuity", label: "Late", amount: 1000000, on: "2046-07", source: "exact" }];
  const late = evaluatePlan(u, pack, { today });
  assert.equal(late.target.projected, base.target.projected);
  assert.ok(late.target.required < base.target.required);
  assert.ok(late.earliestAge < base.earliestAge);
});

test("inflows: repeating payouts, growth and tax", () => {
  const u = clone(quick);
  u.inflows = [{ id: "a", templateId: "inflow.insurance_payout", label: "LIC", amount: 100000, on: "2030-01", years: 3, source: "exact" },
    { id: "b", templateId: "inflow.property_sale", label: "Flat", amount: 10000000, on: "2036-07", growthRate: 0.05, taxRate: 0.1, source: "estimate" }];
  const ev = resolveInputs(u, pack, today).inflows;
  assert.equal(ev.length, 4);
  assert.deepEqual(ev.slice(0, 3).map((e) => e.net), [100000, 100000, 100000]);
  const flat = ev[3];
  assert.ok(Math.abs(flat.net - 10000000 * 1.05 ** (flat.atAge - resolveInputs(u, pack, today).age) * 0.9) < 1);
});

test("a late inflow cannot rescue the years before it arrives", () => {
  const inp = resolveInputs(quick, pack, today);
  const p = makeParams(inp);
  const t = 15;
  const plain = withdrawalsFrom(inp, p, {}, t);
  const huge = { ...inp, inflows: [{ atAge: p.age + t + 20, net: 1e12 }] };
  const need = requiredAtFor(huge, p, t);
  // Must still fund the first 20 years on its own.
  assert.ok(Math.abs(need - pvDue(plain.slice(0, 20), p.rPost)) < 1);
  const rows = drawdown(need, withdrawalsFrom(huge, p, {}, t), { rate: p.rPost });
  assert.ok(rows.every((r) => r.end >= -1e-3));
});

test("SWP plan: pays every withdrawal, ends at zero, and buckets average the post-FIRE return", () => {
  const r = evaluatePlan(quick, pack, { today });
  const s = r.swp;
  assert.ok(Math.abs(s.rows.at(-1).end) < 1, "corpus ends at ~0");
  assert.ok(s.rows.every((x) => x.shortfall === 0));
  assert.ok(Math.abs(s.firstMonthly * 12 - s.rows[0].withdrawal) < 1e-6);
  const b = s.buckets, total = b.cash.amount + b.debt.amount + b.equity.amount;
  const blended = (b.cash.amount * b.cash.return + b.debt.amount * b.debt.return + b.equity.amount * b.equity.return) / total;
  assert.ok(Math.abs(blended - r.params.rPost) < 1e-9);
  assert.ok(Math.abs(b.cash.amount - 3 * s.rows[0].withdrawal) < 1e-6);
});

// ---- property, locked money, relocation, sequence risk, levers ----
const sheetLike = () => ({ ...clone(quick), profile: { birthYearMonth: "1981-09" }, plan: { fireTargetAge: 50, planUntilAge: 90 },
  quick: { takeHomeMonthly: 300000, monthlyExpenses: 150000, emiMonthly: 0, investedCorpus: 16000000, monthlySip: 90000 } });

test("property sale: price grows, selling costs and LTCG on the gain come off", () => {
  const u = sheetLike();
  u.properties = [{ id: "p", kind: "secondHome", label: "Flat", value: 10000000, growthRate: 0.05, purchasePrice: 6000000, plan: "sell", sellOn: "2031-09", source: "exact" }];
  const inp = resolveInputs(u, pack, today);
  const sale = inp.properties[0].sale;
  const price = 10000000 * 1.05 ** 5;
  assert.ok(Math.abs(sale.price - price) < 1);
  assert.ok(Math.abs(sale.net - (price * (1 - pack.property.saleCostRate) - pack.property.ltcgRate * (price - 6000000))) < 1);
  assert.ok(evaluatePlan(u, pack, { today }).earliestAge < evaluatePlan(sheetLike(), pack, { today }).earliestAge);
});

test("property kept: rent lowers the corpus needed, costs raise it", () => {
  const base = evaluatePlan(sheetLike(), pack, { today }).target.required;
  const u = sheetLike();
  u.properties = [{ id: "p", kind: "secondHome", label: "Flat", value: 10000000, monthlyRent: 25000, plan: "keep", source: "exact" }];
  assert.ok(evaluatePlan(u, pack, { today }).target.required < base);
  u.properties[0] = { ...u.properties[0], monthlyRent: 0, annualCosts: 60000 };
  assert.ok(evaluatePlan(u, pack, { today }).target.required > base);
});

test("locked NPS: excluded now, arrives at 60 as a lump sum plus a pension", () => {
  const u = clone(detailed);
  const inp = resolveInputs(u, pack, today);
  const nps = inp.inflows.find((x) => x.label.includes("unlocks at 60"));
  assert.ok(nps && nps.atAge === 60 && nps.net > 500000 * 0.6);
  const pension = inp.incomesAfterFire.find((x) => x.label.includes("pension"));
  assert.ok(pension && pension.fromAge === 60 && pension.monthly > 0);
});

test("spending after FIRE scales living costs (not the health premium)", () => {
  const parts = (u) => { const inp = resolveInputs(u, pack, today); return withdrawalParts(inp, makeParams(inp), {}, 5); };
  const a = parts(sheetLike());
  const u = sheetLike(); u.plan.postFireSpending = 0.8;
  const b = parts(u);
  assert.ok(Math.abs((b.spend - b.healthPremium) / (a.spend - a.healthPremium) - 0.8) < 1e-9);
  assert.equal(b.healthPremium, a.healthPremium);
  assert.ok(b.tax < a.tax, "less to withdraw, less tax");
});

test("a crash just after retiring delays FIRE", () => {
  const s = Object.fromEntries(evaluatePlan(sheetLike(), pack, { today }).scenarios.map((x) => [x.id, x]));
  assert.ok(s.crash_at_fire.earliestAge > s.base.earliestAge);
});

test("market simulation: ~50/50 at the steady-return FIRE age, rising with later ages", () => {
  const r = evaluatePlan(sheetLike(), pack, { today });
  const near = r.chance.byAge.reduce((b, c) => (Math.abs(c.age - r.earliestAge) < Math.abs(b.age - r.earliestAge) ? c : b));
  assert.ok(near.chance > 0.3 && near.chance < 0.7, `chance ${near.chance}`);
  assert.ok(r.chance.confidentAge > r.earliestAge);
  const later = r.chance.byAge.filter((c) => c.age > r.earliestAge).map((c) => c.chance);
  assert.ok(later.at(-1) >= later[0]);
  assert.deepEqual(evaluatePlan(sheetLike(), pack, { today }).chance.byAge, r.chance.byAge, "same plan, same answer");
});

test("levers: each one on its own closes the gap", () => {
  const u = sheetLike();
  const r = evaluatePlan(u, pack, { today });
  assert.equal(r.levers.onTrack, false);
  const more = clone(u); more.quick.monthlySip += r.levers.investMore;
  assert.ok(Math.abs(evaluatePlan(more, pack, { today }).target.gap) / r.target.required < 0.01);
  const less = clone(u); less.plan.postFireSpending = r.levers.spendAfterFire.to / r.levers.spendAfterFire.from;
  assert.ok(Math.abs(evaluatePlan(less, pack, { today }).target.gap) / r.target.required < 0.01);
});

// ---- tax, health cover, repeating goals ----
test("slab tax: new-regime slabs and the 12 lakh rebate", () => {
  const T = pack.incomeTax;
  assert.equal(slabTax(1200000, T), 0);
  // 13 lakh: 4–8 at 5% + 8–12 at 10% + 1 lakh at 15%
  assert.equal(slabTax(1300000, T), 20000 + 40000 + 15000);
  assert.equal(slabTax(3000000, T), 20000 + 40000 + 60000 + 80000 + 100000 + 600000 * 0.3);
});

test("withdrawal tax: equity gains above the exemption at 12.5%, interest at slab, plus cess", () => {
  const ctx = { tax: pack.incomeTax, gainShare: 0.5, interestPerRupee: 0.5 };
  // 20 lakh withdrawn: 10 lakh interest (under the rebate), 10 lakh gains → 12.5% of 8.75 lakh
  assert.ok(Math.abs(yearTax(2000000, 0, ctx) - 0.125 * 875000 * 1.04) < 1e-6);
  const p = withdrawalParts(resolveInputs(sheetLike(), pack, today), makeParams(resolveInputs(sheetLike(), pack, today)), {}, 5);
  assert.ok(Math.abs(p.gross - p.need - p.tax) < 1e-6 && p.tax > 0);
});

test("health cover after FIRE: estimated by default, 0 switches it off, a quote rescales it", () => {
  const withEst = withdrawalParts(resolveInputs(sheetLike(), pack, today), makeParams(resolveInputs(sheetLike(), pack, today)), {}, 5);
  assert.ok(withEst.healthPremium > 0);
  const none = sheetLike(); none.insurance = { premiumAfterFire: 0 };
  const inpN = resolveInputs(none, pack, today);
  assert.equal(withdrawalParts(inpN, makeParams(inpN), {}, 5).healthPremium, 0);
  const quote = sheetLike(); quote.insurance = { premiumAfterFire: 2 * resolveInputs(sheetLike(), pack, today).health.premiumNow };
  const inpQ = resolveInputs(quote, pack, today);
  assert.ok(Math.abs(withdrawalParts(inpQ, makeParams(inpQ), {}, 5).healthPremium / withEst.healthPremium - 2) < 1e-9);
});

test("repeating goals expand until the chosen age", () => {
  const u = sheetLike();
  u.goals = [{ id: "g", templateId: "goal.car", label: "Car", atAge: 48, costToday: 1000000, repeatEveryYears: 8, untilAge: 75, source: "estimate" }];
  const ages = resolveInputs(u, pack, today).goals.map((g) => g.atAge);
  assert.deepEqual(ages, [48, 56, 64, 72]);
  assert.ok(evaluatePlan(u, pack, { today }).earliestAge > evaluatePlan(sheetLike(), pack, { today }).earliestAge);
});

// ---- one rupee, counted once ----
const household = () => ({ schemaVersion: 1, app: { rulesPack: "in", rulesPackVersion: "2026.1" }, provenance: {},
  profile: { birthYearMonth: "1981-09" }, plan: { fireTargetAge: 50, planUntilAge: 90 } });
const quickHH = () => ({ ...household(), sectionsDone: [],
  quick: { takeHomeMonthly: 312617, monthlyExpenses: 150000, emiMonthly: 72000, investedCorpus: 16239063, monthlySip: 51000, epfMonthly: 41698 } });
const detailedHH = () => ({ ...household(), quick: {}, sectionsDone: ["expenses", "holdings", "income", "loans"],
  expenses: [{ id: "e1", categoryId: "other.misc", amount: 135000, frequency: "monthly", source: "exact" },
             { id: "e2", categoryId: "health.out_of_pocket", amount: 15000, frequency: "monthly", source: "exact" }],
  holdings: [{ id: "h1", instrumentId: "mf_equity_index", value: 16239063, monthlyContribution: 51000, asOf: "2026-09-01", source: "exact" },
             { id: "h2", instrumentId: "epf", value: 0, monthlyContribution: 20849, employerMonthlyContribution: 20849, asOf: "2026-09-01", source: "exact" }],
  incomes: [{ id: "i1", type: "salary", monthly: 312617, source: "exact" }],
  liabilities: [{ id: "l1", type: "home", outstanding: 3000000, emi: 72000, endsOn: "2031-01", source: "exact" }] });
const ev = (u) => evaluatePlan(u, pack, { today });

test("the same household entered quick or detailed gives the same answer", () => {
  const a = ev(quickHH()), b = ev(detailedHH());
  assert.ok(Math.abs(a.earliestAge - b.earliestAge) < 1e-9);
  assert.ok(Math.abs(a.target.required - b.target.required) < 1);
  assert.equal(a.derived.monthlySurplus, b.derived.monthlySurplus);
  assert.equal(a.derived.monthlySurplus, 312617 - 150000 - 72000 - 51000, "PF is not taken out of take-home again");
});

test("rent entered under Income and Property counts once", () => {
  const onlyProperty = detailedHH();
  onlyProperty.properties = [{ id: "p", kind: "secondHome", label: "Flat", value: 8000000, monthlyRent: 25000, plan: "keep", source: "exact" }];
  const both = structuredClone(onlyProperty);
  both.incomes.push({ id: "i2", type: "rental", monthly: 25000, continuesAfterFire: true, source: "exact" });
  const r = ev(both);
  assert.equal(r.target.required, ev(onlyProperty).target.required);
  assert.ok(r.overlaps.some((o) => o.section === "income"));
});

test("a sale entered under Property and Money coming in counts once", () => {
  const onlyProperty = detailedHH();
  onlyProperty.properties = [{ id: "p", kind: "secondHome", label: "Flat", value: 15000000, plan: "sell", sellOn: "2031-09", source: "exact" }];
  const both = structuredClone(onlyProperty);
  both.inflows = [{ id: "m", templateId: "inflow.property_sale", label: "Flat sale", amount: 15000000, on: "2031-09", source: "exact" }];
  assert.equal(ev(both).earliestAge, ev(onlyProperty).earliestAge);
});

test("an endowment policy counted in Investments and paid out under Money coming in counts once", () => {
  const u = detailedHH();
  u.holdings.push({ id: "h3", instrumentId: "insurance_traditional", value: 880000, countInFire: true, asOf: "2026-09-01", source: "exact" });
  u.inflows = [{ id: "m", templateId: "inflow.insurance_payout", label: "LIC", amount: 1031250, on: "2031-09", source: "exact" }];
  assert.equal(resolveInputs(u, pack, today).fireCorpus, 16239063);
});

test("a finished section that drops most of the quick answer is flagged", () => {
  const u = { ...quickHH(), sectionsDone: ["holdings"],
    holdings: [{ id: "h1", instrumentId: "mf_equity_index", value: 5000000, monthlyContribution: 51000, asOf: "2026-09-01", source: "exact" }] };
  assert.ok(ev(u).overlaps.some((o) => o.kind === "drop" && o.section === "holdings"));
});

test("breakdown of the corpus needed adds up to it", () => {
  const r = ev(quickHH());
  assert.ok(Math.abs(r.breakdown.net - r.target.required) / r.target.required < 0.01);
});

test("one total-savings answer: the emergency fund is set aside first, the rest counts toward FIRE", async () => {
  const { resolveInputs } = await import("../src/engine/index.js");
  const pack = JSON.parse(readFileSync(new URL("../rules/in.2026.1.json", import.meta.url)));
  const base = { schemaVersion: "1.0.0", profile: { birthYearMonth: "1990-01" }, plan: { fireTargetAge: 50 },
    quick: { takeHomeMonthly: 150000, monthlyExpenses: 60000, emiMonthly: 10000, monthlySip: 30000 } };
  const at = (q) => resolveInputs({ ...base, quick: { ...base.quick, ...q } }, pack, new Date("2026-09-26"));
  const plenty = at({ totalSavings: 2000000 });
  assert.equal(plenty.emergencyFund, 6 * 70000);           // 6 months of spending + EMIs
  assert.equal(plenty.fireCorpus, 2000000 - 6 * 70000);
  const little = at({ totalSavings: 200000 });             // less than the cushion: all of it stays aside
  assert.equal(little.emergencyFund, 200000);
  assert.equal(little.fireCorpus, 0);
  const old = at({ investedCorpus: 2000000 });             // older files already left it out
  assert.equal(old.fireCorpus, 2000000);
});

test("NPS from the quick questions is locked until 60, then pays a lump sum and a pension", async () => {
  const { resolveInputs, evaluatePlan } = await import("../src/engine/index.js");
  const pack = JSON.parse(readFileSync(new URL("../rules/in.2026.1.json", import.meta.url)));
  const today = new Date("2026-09-26");
  const u = { schemaVersion: "1.0.0", profile: { birthYearMonth: "1990-01" }, plan: { fireTargetAge: 50 },
    quick: { takeHomeMonthly: 200000, monthlyExpenses: 80000, emiMonthly: 0, totalSavings: 3000000, monthlySip: 40000, epfMonthly: 15000 } };
  const withNps = { ...u, quick: { ...u.quick, npsBalance: 800000, npsMonthly: 10000 } };
  const a = resolveInputs(u, pack, today), b = resolveInputs(withNps, pack, today);
  assert.equal(b.fireCorpus, a.fireCorpus, "NPS isn't spendable before 60");
  assert.ok(b.inflows.some((x) => x.atAge === 60 && x.net > 800000), "lump sum at 60");
  assert.ok(b.incomesAfterFire.some((x) => /pension/.test(x.label) && x.fromAge === 60), "pension from 60");
  const ea = evaluatePlan(u, pack, { today }).earliestAge, eb = evaluatePlan(withNps, pack, { today }).earliestAge;
  assert.ok(eb <= ea, "money arriving at 60 can only help");
  assert.equal(evaluatePlan(withNps, pack, { today }).balance.today.locked, 800000, "shown as locked in Where you stand");
});

// ---- money after FIRE, taxed the right way ----
const pk = () => JSON.parse(readFileSync(new URL("../rules/in.2026.1.json", import.meta.url)));
const day = new Date("2026-09-26");
const quickBase = { schemaVersion: "1.0.0", profile: { birthYearMonth: "1986-01" }, plan: { fireTargetAge: 50 },
  quick: { takeHomeMonthly: 250000, monthlyExpenses: 120000, emiMonthly: 0, totalSavings: 20000000, monthlySip: 80000, epfMonthly: 20000 } };

test("quick 'income after FIRE' lowers the corpus needed, and only until the age given", async () => {
  const { evaluatePlan } = await import("../src/engine/index.js");
  const req = (q) => evaluatePlan({ ...quickBase, quick: { ...quickBase.quick, ...q } }, pk(), { today: day }).target.required;
  const none = req({}), toSixty = req({ incomeAfterFireMonthly: 50000, incomeAfterFireUntilAge: 60 }), forLife = req({ incomeAfterFireMonthly: 50000 });
  assert.ok(toSixty < none, "some income helps");
  assert.ok(forLife < toSixty, "income for life helps more than income to 60");
});

test("part-time income from an older plan file is never counted on top of income after FIRE", async () => {
  const { evaluatePlan, resolveInputs } = await import("../src/engine/index.js");
  const u = (q, plan) => ({ ...quickBase, plan: { ...quickBase.plan, ...plan }, quick: { ...quickBase.quick, ...q } });
  const oldPartTime = { partTimeIncomeMonthly: 40000, partTimeUntilAge: 60 };
  assert.ok(resolveInputs(u({}, oldPartTime), pk(), day).partTime, "on its own, an old part-time answer still counts");
  const both = u({ incomeAfterFireMonthly: 40000, incomeAfterFireUntilAge: 60 }, oldPartTime);
  assert.equal(resolveInputs(both, pk(), day).partTime, null, "not added a second time");
  const once = u({ incomeAfterFireMonthly: 40000, incomeAfterFireUntilAge: 60 }, {});
  assert.equal(evaluatePlan(both, pk(), { today: day }).target.required, evaluatePlan(once, pk(), { today: day }).target.required);
});

test("a spouse's salary isn't taxed as yours; a pension is; a pension counts only from its start age", async () => {
  const { evaluatePlan } = await import("../src/engine/index.js");
  const done = { sectionsDone: ["income"] };
  const plan = (inc) => evaluatePlan({ ...quickBase, ...done, incomes: [
    { id: "s", type: "salary", monthly: 250000, source: "exact" }, { id: "x", monthly: 60000, source: "exact", continuesAfterFire: true, ...inc }] }, pk(), { today: day });
  const spouse = plan({ type: "spouse_salary", annualGrowth: 0 }), pension = plan({ type: "pension", annualGrowth: 0 });
  assert.ok(pension.target.required > spouse.target.required, "the pension's tax needs a bigger corpus");
  // Above the ₹12 lakh rebate, the pension shows up in the very first year's tax too.
  const bigSpouse = plan({ type: "spouse_salary", monthly: 150000, annualGrowth: 0 }), bigPension = plan({ type: "pension", monthly: 150000, annualGrowth: 0 });
  assert.ok(bigPension.swp.firstTax > bigSpouse.swp.firstTax);
  const later = plan({ type: "pension", annualGrowth: 0, fromAge: 60 });
  assert.ok(later.target.required > pension.target.required, "a pension from 60 helps less than one from 50");
});

test("foreign shares lose the ₹1.25 lakh exemption on gains", async () => {
  const { yearTax } = await import("../src/engine/index.js");
  const tax = pk().incomeTax, ctx = { tax, gainShare: 0.5, interestPerRupee: 0 };
  const indian = yearTax(2000000, 0, { ...ctx, foreignShare: 0 }), foreign = yearTax(2000000, 0, { ...ctx, foreignShare: 1 });
  assert.ok(Math.abs((foreign - indian) - 0.125 * 125000 * (1 + tax.cess)) < 1, "difference is exactly the lost exemption");
});

test("superannuation is locked until 58, then a one-third lump sum and a pension", async () => {
  const { resolveInputs } = await import("../src/engine/index.js");
  const u = { ...quickBase, sectionsDone: ["holdings"], holdings: [
    { id: "a", instrumentId: "mf_equity_index", value: 5000000, asOf: "2026-09-01", source: "exact" },
    { id: "b", instrumentId: "superannuation", value: 900000, employerMonthlyContribution: 5000, asOf: "2026-09-01", source: "exact" }] };
  const inp = resolveInputs(u, pk(), day);
  assert.equal(inp.fireCorpus, 5000000);
  const lump = inp.inflows.find((x) => x.atAge === 58), pension = inp.incomesAfterFire.find((x) => x.fromAge === 58);
  assert.ok(lump && pension, "lump sum and pension at 58");
  assert.ok(Math.abs(lump.net / (lump.net + pension.monthly * 12 / 0.06) - 1 / 3) < 0.01, "one-third lump sum");
});

test("future money that might be entered twice is flagged where it's entered", async () => {
  const { evaluatePlan } = await import("../src/engine/index.js");
  const run = (u) => evaluatePlan({ ...quickBase, ...u, quick: { ...quickBase.quick, ...(u.quick || {}) } }, pk(), { today: day }).overlaps || [];
  const flat = { id: "p", label: "Flat", value: 8000000, monthlyRent: 25000, plan: "keep", source: "exact" };
  assert.ok(run({ quick: { incomeAfterFireMonthly: 40000 }, properties: [flat] }).some((o) => o.section === "property" && o.kind === "maybe"), "quick income + rent");
  assert.ok(!run({ properties: [flat] }).some((o) => o.kind === "maybe"), "rent alone is fine");
  const pension = run({ quick: { npsBalance: 800000 }, sectionsDone: ["income"], incomes: [
    { id: "s", type: "salary", monthly: 250000, source: "exact" },
    { id: "n", type: "pension", label: "NPS pension", monthly: 20000, continuesAfterFire: true, fromAge: 60, source: "exact" }] });
  assert.ok(pension.some((o) => o.section === "income" && /NPS/.test(o.message)), "a pension next to NPS");
  const pf = run({ inflows: [{ id: "x", templateId: "inflow.other", label: "PF withdrawal", amount: 1500000, on: "2036-01", source: "estimate" }] });
  assert.ok(pf.some((o) => o.section === "inflows"), "PF entered as money coming in");
});

test("locked money says where it came from and what it pays at unlock; none when there's none", async () => {
  const { resolveInputs } = await import("../src/engine/index.js");
  const none = resolveInputs({ ...quickBase, quick: { ...quickBase.quick, npsBalance: 0 } }, pk(), day);
  assert.equal(none.locked.length, 0, "no NPS, no NPS step");
  const nps = resolveInputs({ ...quickBase, quick: { ...quickBase.quick, npsBalance: 800000, npsMonthly: 10000 } }, pk(), day).locked[0];
  assert.match(nps.from, /NPS question/);
  assert.ok(nps.atUnlock.total > 800000 && Math.abs(nps.atUnlock.lump - 0.6 * nps.atUnlock.total) < 1 && nps.atUnlock.pensionMonthly > 0);
});
