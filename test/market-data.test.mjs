import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise } from "../scripts/fetch-market-data.mjs";

// Shapes copied from the real APIs; values are made up.
const worldBank = [{ page: 1 }, Array.from({ length: 12 }, (_, i) => ({ date: String(2024 - i), value: 4 + i * 0.1 })).concat([{ date: "2025", value: null }])];
const imf = { values: { PCPIPCH: { IND: { 2024: 4.9, 2025: 4.2, 2026: 4.0, 2027: 4.1, 2028: 4.0, 2029: 4.0, 2030: 4.0, 2031: 4.0, 2032: 3.9 } } } };

test("summarise: 10-year actual average and IMF projections from the current year", () => {
  const d = summarise({ worldBank, imf }, new Date("2026-09-25T00:00:00Z"));
  assert.equal(d.inflation.actual.lastYear, 2024);
  assert.equal(d.inflation.actual.avg10yFrom, 2015);
  assert.equal(d.inflation.actual.avg10y, 0.0445); // mean of 4.0…4.9 %
  assert.equal(d.inflation.forecast.from, 2026);
  assert.equal(d.inflation.forecast.to, 2031);
  assert.equal(d.inflation.forecast.avg, 0.0402);
});

test("summarise: tolerates a missing source", () => {
  const d = summarise({ imf }, new Date("2026-01-01T00:00:00Z"));
  assert.equal(d.inflation.actual, undefined);
  assert.ok(d.inflation.forecast.avg > 0);
});
