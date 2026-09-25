import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluatePlan, evaluate, fv, pvDue, resolveInputs, makeParams, analyse, withdrawalsFrom, drawdown,
} from "../src/engine/index.js";

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
