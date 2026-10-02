// The simulation after FIRE: cash, debt and equity buckets, each on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluatePlan } from "../src/engine/index.js";
import { chanceModel, bucketReturns, bucketSplit, CASH_YEARS, DEBT_YEARS } from "../src/engine/risk.js";
import { households } from "./regression/households.mjs";

const pack = JSON.parse(readFileSync(new URL("../rules/in.2026.1.json", import.meta.url)));
const today = new Date("2026-10-01");
const ret = { cash: 0.05, debt: 0.07, equity: 0.11 };

test("the buckets hold 3 years of withdrawals in cash, 5 in debt, the rest in equity", () => {
  assert.deepEqual(bucketSplit(100, 4), { cash: 4 * CASH_YEARS, debt: 4 * DEBT_YEARS, equity: 100 - 32 });
  assert.deepEqual(bucketSplit(20, 4), { cash: 12, debt: 8, equity: 0 }, "too little: cash first, then debt");
  assert.deepEqual(bucketSplit(50, -2), { cash: 0, debt: 0, equity: 50 }, "nothing to draw: all equity");
});

test("bucket returns average the assumed post-FIRE return at the start", () => {
  for (const [split, r] of [[bucketSplit(300, 4), 0.085], [bucketSplit(60, 4), 0.07], [bucketSplit(33, 4), 0.06]]) {
    const b = bucketReturns(split, r, ret), total = split.cash + split.debt + split.equity;
    const avg = (split.cash * b.cash + split.debt * b.debt + split.equity * b.equity) / total;
    assert.ok(Math.abs(avg - r) < 1e-12, `${avg} ≠ ${r}`);
  }
  const usual = bucketReturns(bucketSplit(300, 4), 0.085, ret);
  assert.equal(usual.cash, ret.cash, "with a normal equity share, cash and debt keep their own returns");
  assert.equal(usual.debt, ret.debt);
});

test("searching for the 75% and 90% ages gives the same answer as checking every age", () => {
  for (const { name, user } of households()) {
    const r = evaluatePlan(user, pack, { today });
    const all = r.chance.byAge;
    for (const x of [0.5, 0.75, 0.9]) {
      const scan = all.find((c) => c.chance >= x) ?? null;
      const m = chanceModel(r.inputs, r.params);
      assert.deepEqual(m.firstWith(x), scan, `${name} at ${x}`);
    }
    assert.equal(r.chance.likelyAge, all.find((c) => c.chance >= 0.75)?.age ?? null);
    assert.equal(r.chance.confidentAge, all.find((c) => c.chance >= 0.9)?.age ?? null);
    for (let i = 1; i < all.length; i++) assert.ok(all[i].chance >= all[i - 1].chance, `${name}: stopping later never lowers the chance`);
  }
});

test("each bucket is simulated: debt's ups and downs and equity's both move the chance", () => {
  const { user } = households().find((h) => h.name === "quick-typical");
  const r = evaluatePlan(user, pack, { today });
  const t = Math.round(r.earliestAge - r.inputs.age);
  const chanceWith = (over, at = t) => chanceModel({ ...r.inputs, assumptions: { ...r.inputs.assumptions, ...over } }, r.params).at(at).chance;
  const base = chanceWith({});
  assert.ok(base > 0.3 && base < 0.6, `at the steady-returns age it's roughly a coin flip: ${base}`);
  // A few years later most histories last; wilder markets then mean more of them don't.
  const later = chanceWith({}, t + 6);
  assert.ok(chanceWith({ "risk.volatilityEquity": 0.3 }, t + 6) < later - 0.02, "wilder equity lowers it");
  assert.ok(chanceWith({ "risk.volatilityEquity": 0.08 }, t + 6) > later + 0.02, "calmer equity raises it");
  assert.notEqual(chanceWith({ "risk.volatilityDebt": 0.1 }, t + 6), later, "debt has its own ups and downs");
  assert.equal(r.chance.atEarliest, base);
});

test("with no ups and downs after FIRE, the money lasts when the savings cover the buckets' needs", () => {
  const { user } = households().find((h) => h.name === "quick-typical");
  const r = evaluatePlan(user, pack, { today });
  const calm = { ...r.inputs.assumptions, "risk.volatilityBeforeFire": 0, "risk.volatilityEquity": 0, "risk.volatilityDebt": 0 };
  const m = chanceModel({ ...r.inputs, assumptions: calm }, r.params, { runs: 50 });
  const t = Math.round(r.earliestAge - r.inputs.age);
  for (const c of m.all()) assert.ok(c.chance === 0 || c.chance === 1, "every history is the same");
  assert.equal(m.at(t - 2).chance, 0, "well before the steady-returns age it fails");
  assert.equal(m.at(t + 2).chance, 1, "well after it lasts");
});
