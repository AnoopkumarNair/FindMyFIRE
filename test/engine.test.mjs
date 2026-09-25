import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluatePlan, evaluate, fv, pvDue, resolveInputs, makeParams, analyse, withdrawalsFrom, drawdown, requiredAt,
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
  const at = analyse(inp, { ...p, fireTargetAge: a.earliestAge });
  assert.ok(Math.abs(at.gap) / at.required < 0.01, "gap ≈ 0 at the earliest age");
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
  const years = 45 - age - Math.floor(35 - age);
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
