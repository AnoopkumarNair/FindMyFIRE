// Replaying market history. The histories here are made up for the tests (steady years, one
// crash); real data comes from data/market-history.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { evaluatePlan } from "../src/engine/index.js";
import { historyRows, replayHistory, historySafe, replayYear, survivesYear, MIN_HISTORY_YEARS } from "../src/engine/history.js";
import { households } from "./regression/households.mjs";

const pack = JSON.parse(readFileSync(new URL("../rules/in.2026.1.json", import.meta.url)));
const today = new Date("2026-10-01");
const plan = () => evaluatePlan(households().find((h) => h.name === "quick-typical").user, pack, { today });

/** `n` years from 1990 at the given equity return and inflation, with optional overrides by year. */
function made(n, equity, inflation, over = {}) {
  const years = {}, infl = {};
  for (let i = 0; i < n; i++) { const y = 1990 + i; years[y] = { equity, ...(over[y] || {}) }; infl[y] = inflation; }
  return historyRows({ years }, infl);
}

test("history rows keep the latest unbroken run of years and attach inflation", () => {
  const rows = historyRows({ years: { 2001: { equity: 0.1 }, 2003: { equity: 0.2 }, 2004: { equity: -0.1, debt: 0.07 } } }, { 2004: 0.05 });
  assert.deepEqual(rows, [{ year: 2003, equity: 0.2, debt: null, inflation: null }, { year: 2004, equity: -0.1, debt: 0.07, inflation: 0.05 }]);
});

test("too little history says nothing", () => {
  const r = plan();
  assert.equal(replayHistory(r.inputs, r.params, made(MIN_HISTORY_YEARS - 1, 0.1, 0.06), 10), null);
});

test("a history as good as the assumptions lasts from every start year at a workable age", () => {
  const r = plan(), p = r.params;
  // Equity good enough that the buckets earn at least the post-FIRE return; inflation as assumed.
  const rows = made(30, 0.12, p.infl.general);
  const t = Math.ceil(r.earliestAge - p.age) + 1;
  const h = replayHistory(r.inputs, p, rows, t);
  assert.equal(h.total, 30 - MIN_HISTORY_YEARS + 1);
  assert.equal(h.lasted, h.total);
  assert.equal(h.worst, null);
  const early = replayHistory(r.inputs, p, rows, Math.floor(r.earliestAge - p.age) - 4);
  assert.equal(early.lasted, 0, "well before the steady age it can't last");
});

test("a crash in the first year hurts more than the same crash later, and higher prices hurt", () => {
  const r = plan(), p = r.params;
  const t = Math.ceil(r.earliestAge - p.age) + 2;
  const crashFirst = made(30, 0.1, p.infl.general, { 1990: { equity: -0.5 } });
  const h = replayHistory(r.inputs, p, crashFirst, t);
  const first = h.starts[0], later = h.starts.find((s) => s.year === 1991);
  assert.ok(!first.lasts || first.end < later.end, "starting into the crash leaves less");
  const dearer = made(30, 0.1, p.infl.general + 0.03);
  const cheap = made(30, 0.1, p.infl.general);
  const a = replayHistory(r.inputs, p, dearer, t).starts[0], b = replayHistory(r.inputs, p, cheap, t).starts[0];
  assert.ok(!a.lasts || a.end < b.end, "faster price rises raise spending");
});

test("the history-safe age is the first age every start year lasts", () => {
  const r = plan(), p = r.params;
  const rows = made(30, 0.1, p.infl.general, { 1995: { equity: -0.45 }, 1996: { equity: -0.2 } });
  const from = Math.floor(r.earliestAge - p.age);
  const safe = historySafe(r.inputs, p, rows, from);
  assert.ok(safe, "found");
  assert.equal(safe.lasted, safe.total);
  const before = replayHistory(r.inputs, p, rows, safe.t - 1);
  assert.ok(safe.t === from || before.lasted < before.total, "a year earlier, some start year fails");
});

test("the published market history, when present, is complete and plausible", { skip: !existsSync(new URL("../data/market-history.json", import.meta.url)) }, () => {
  const h = JSON.parse(readFileSync(new URL("../data/market-history.json", import.meta.url)));
  assert.ok(h.source?.equity?.name && h.source?.equity?.url, "says where the equity figures come from");
  const years = Object.keys(h.years).map(Number).sort((a, b) => a - b);
  assert.ok(years.length >= MIN_HISTORY_YEARS);
  years.forEach((y, i) => { if (i) assert.equal(y, years[i - 1] + 1, `no gap before ${y}`); });
  for (const y of years) {
    const x = h.years[y];
    assert.ok(x.equity > -0.8 && x.equity < 3, `${y} equity ${x.equity}`);
    if (x.debt != null) assert.ok(x.debt > -0.3 && x.debt < 0.5, `${y} debt ${x.debt}`);
  }
  assert.equal(historyRows(h).length, years.length);
});

test("one crash year replayed the year you stop, and the first age that lasts through it", () => {
  const r = plan(), p = r.params;
  const rows = made(20, 0.1, p.infl.general, { 2000: { equity: -0.5 }, 2001: { equity: 0.6 } });
  const t = Math.ceil(r.earliestAge - p.age);
  assert.equal(replayYear(r.inputs, p, rows, 1980, t), null, "a year outside the history");
  const at = replayYear(r.inputs, p, rows, 2000, t);
  assert.equal(at.year, 2000);
  assert.equal(at.t, t);
  const same = replayHistory(r.inputs, p, rows, t).starts.find((s) => s.year === 2000);
  assert.equal(at.lasts, same.lasts, "the same replay as the start-year table");
  const ok = survivesYear(r.inputs, p, rows, 2000, t);
  assert.ok(ok && ok.lasts && ok.t >= t);
  if (ok.t > t) assert.equal(replayYear(r.inputs, p, rows, 2000, ok.t - 1).lasts, false, "a year earlier it doesn't");
  const calm = replayYear(r.inputs, p, rows, 2005, t);
  assert.ok(calm.lasts || !at.lasts, "a calm start does at least as well as the crash");
});
