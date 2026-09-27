// Mathematical invariants: contribution timing, returns of zero or below, boundary ages, tax
// bracket edges and long horizons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accumulate, contributionGrowth } from "../src/engine/project.js";
import { slabTax } from "../src/engine/tax.js";
import { evaluatePlan } from "../src/engine/index.js";

const pack = JSON.parse(readFileSync(new URL("../rules/in.2026.1.json", import.meta.url)));
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const noGoals = { goals: [], inflows: [] };
const base = { age: 30, corpus: 1000000, sip: 20000, epf: 0, stepUp: 0, incomeGrowth: 0 };

test("monthly contributions equal investing month by month", () => {
  for (const r of [0.12, 0.07, 0, -0.1]) {
    const years = 10, m = (1 + r) ** (1 / 12) - 1;
    let c = base.corpus;
    for (let k = 0; k < years * 12; k++) c = (c + base.sip) * (1 + m);
    near(accumulate(noGoals, { ...base, rPre: r }, years).at(-1), c);
  }
});

test("monthly timing sits between investing at the year's start and at its end", () => {
  for (const r of [0.15, 0.08, 0.01]) {
    const k = contributionGrowth(r);
    assert.ok(k > 1 && k < 1 + r, `r=${r}: ${k}`);
  }
  assert.equal(contributionGrowth(0.12, "yearStart"), 1.12, "the sheet's timing is still available");
  near(contributionGrowth(0), 1);
  assert.ok(contributionGrowth(-0.2) < 1 && contributionGrowth(-0.2) > 0.8, "losses hit later instalments less");
});

test("zero return just adds up; zero contribution just compounds", () => {
  near(accumulate(noGoals, { ...base, rPre: 0 }, 5).at(-1), base.corpus + 5 * 12 * base.sip);
  near(accumulate(noGoals, { ...base, sip: 0, rPre: 0.1 }, 5).at(-1), base.corpus * 1.1 ** 5);
  assert.ok(accumulate(noGoals, { ...base, rPre: -0.05 }, 5).at(-1) < base.corpus + 5 * 12 * base.sip, "losses lose money");
});

test("tax has no cliffs: every slab edge and the rebate limit are continuous", () => {
  const t = pack.incomeTax;
  const edges = [...t.slabs.map((s) => s.upTo).filter(Boolean), t.rebateUpTo];
  for (const e of edges) {
    const below = slabTax(e, t), above = slabTax(e + 100, t);
    assert.ok(above >= below && above - below <= 100, `jump at ₹${e}: ${below} → ${above}`);
  }
  assert.equal(slabTax(t.rebateUpTo, t), 0, "no tax up to the rebate limit");
  assert.equal(slabTax(t.rebateUpTo + 10000, t), 10000, "just above it, tax is capped at the excess (marginal relief)");
  // Tax never takes all of an extra rupee.
  for (let x = 0; x <= 5e6; x += 25000) assert.ok(slabTax(x + 1000, t) - slabTax(x, t) <= 1000);
});

const plan = (over = {}) => ({ schemaVersion: 1, profile: { birthYearMonth: "1986-01" }, plan: { fireTargetAge: 50, ...over.plan },
  quick: { takeHomeMonthly: 250000, monthlyExpenses: 120000, emiMonthly: 0, totalSavings: 20000000, monthlySip: 80000, epfMonthly: 20000, ...over.quick } });
const day = { today: new Date("2026-09-26") };

test("boundary ages and long horizons give finite, ordered answers", () => {
  const r = evaluatePlan(plan({ plan: { fireTargetAge: 41 } }), pack, day);
  assert.ok(Number.isFinite(r.target.required) && r.target.required > 0, "stopping next year");
  const long = evaluatePlan(plan({ plan: { planUntilAge: 110 } }), pack, day), usual = evaluatePlan(plan(), pack, day);
  assert.ok(Number.isFinite(long.target.required) && long.target.required > usual.target.required, "living to 110 needs more");
  assert.ok(long.chance.atTarget <= usual.chance.atTarget);
  const c = usual.chance;
  assert.ok(usual.earliestAge <= c.likelyAge && c.likelyAge <= c.confidentAge, "steady ≤ 3 in 4 ≤ 9 in 10");
});

test("money arriving later can't pay for earlier years", () => {
  const withInflow = (on) => evaluatePlan({ ...plan(), sectionsDone: [], inflows: [{ id: "x", templateId: "inflow.other", label: "Lump", amount: 5000000, on, source: "exact" }] }, pack, day).target.required;
  const none = evaluatePlan(plan(), pack, day).target.required;
  assert.ok(withInflow("2036-06") < none, "a lump sum after FIRE lowers what's needed");
  assert.ok(withInflow("2036-06") <= withInflow("2060-06"), "the later it comes, the less it helps");
});
