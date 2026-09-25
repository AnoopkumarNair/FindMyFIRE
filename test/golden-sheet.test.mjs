// Golden tests: the engine's building blocks must reproduce the original Google Sheet.
// Fixture = synthetic inputs recalculated in the real workbook (scripts/golden-from-sheet.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fv, pmt, nper, accumulate, drawdown } from "../src/engine/index.js";

const g = JSON.parse(readFileSync(new URL("./fixtures/sheet-golden.json", import.meta.url)));
const I = g.inputs, O = g.outputs;
const close = (actual, expected, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)), `${actual} ≠ ${expected}`);

const n = I.fireAge - I.currentAge;
const blended = (1 - I.healthShare) * I.generalInflation + I.healthShare * I.healthInflation;
const spendAtFire = I.annualExpenses * (1 + blended) ** n;
const target = spendAtFire / I.swr;
const milestonesFv = I.milestones.reduce((s, m) => s + m.amount * (1 + I.returnBefore) ** (I.fireAge - m.age), 0);

test("macro assumptions (B6, B11, B14, B15, B16)", () => {
  assert.equal(n, O.B6);
  close(blended, O.B11);
  close((1 + I.returnAfter) / (1 + blended) - 1, O.B14);
  close(spendAtFire, O.B15);
  close(target, O.B16);
  close(target - I.corpus, O.B17);
});

test("projected corpus: FV(..., type 1) + milestone FVs (E11, M9)", () => {
  close(milestonesFv, O.M9);
  close(fv(I.returnBefore, n, -I.annualSip, -I.corpus, 1) + milestonesFv, O.E11);
});

test("year-by-year accumulation equals the sheet's FV formula", () => {
  const inp = {
    goals: I.milestones.map((m) => ({ atAge: m.age, costToday: -m.amount, inflationRate: 0, priority: "must" })),
  };
  const p = { age: I.currentAge, corpus: I.corpus, sip: I.annualSip / 12, epf: 0, stepUp: 0, incomeGrowth: 0, rPre: I.returnBefore };
  // A milestone at the FIRE age lands in year n, i.e. after the path ends; the sheet adds it undiscounted.
  const atFire = I.milestones.filter((m) => m.age === I.fireAge).reduce((s, m) => s + m.amount, 0);
  close(accumulate(inp, p, n).at(-1) + atFire, O.E11);
});

test("tier targets: Lean, Fat, Coast (E15, E16, E17)", () => {
  close((I.annualExpenses * I.leanShare * (1 + blended) ** n) / 0.035, O.E15);
  close((I.annualExpenses * 1.5 * (1 + blended) ** n) / 0.03, O.E16);
  close(target / (1 + I.returnBefore) ** n, O.E17);
});

test("required monthly SIP: PMT (E18)", () => {
  close(Math.abs(pmt(I.returnBefore / 12, n * 12, -I.corpus, target, 1)), O.E18);
});

test("feasible age: NPER on the real return (F14)", () => {
  const real = (1 + I.returnBefore) / (1 + blended) - 1;
  const years = nper(real, -I.annualSip, -(I.corpus + milestonesFv / (1 + I.returnBefore) ** n), I.annualExpenses / I.swr, 1);
  assert.equal(`Age ${(I.currentAge + years).toFixed(1)}`, O.F14);
});

test("three-bucket split (E4..E7, F6, F7)", () => {
  close(spendAtFire * 3, O.E4);
  close(spendAtFire * 5, O.E5);
  close(target - spendAtFire * 8, O.E6);
  const equity = (I.returnAfter * target - (O.E4 * I.bucketReturns.cash + O.E5 * I.bucketReturns.debt)) / O.E6;
  close(equity, O.F6);
  close((O.E4 * I.bucketReturns.cash + O.E5 * I.bucketReturns.debt + O.E6 * equity) / target, O.F7);
});

test("41-year retirement schedule, row by row (rows 22–62)", () => {
  const withdrawals = g.schedule.map((_, k) => spendAtFire * (1 + blended) ** k);
  const rows = drawdown(target, withdrawals, {
    bucketRates: { cash: I.bucketReturns.cash, debt: I.bucketReturns.debt, equity: O.F6 },
  });
  assert.equal(rows.length, g.schedule.length);
  g.schedule.forEach((s, k) => {
    for (const key of ["begin", "withdrawal", "cash", "debt", "equity", "growth", "end"]) close(rows[k][key], s[key], 1e-9);
  });
});
