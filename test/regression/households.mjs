// Representative households, run through the whole engine on a fixed date. Their key outputs are
// recorded in test/fixtures/regression.json; any change to them (engine or rules pack) shows up
// as a reviewed diff instead of slipping through. Re-record with: node scripts/regression.mjs --update
import { readFileSync, readdirSync } from "node:fs";
import { evaluatePlan } from "../../src/engine/index.js";

const root = new URL("../../", import.meta.url);
export const TODAY = new Date("2026-09-26T12:00:00Z");
const load = (p) => JSON.parse(readFileSync(new URL(p, root)));

export function households() {
  const dir = "test/fixtures/households/";
  return readdirSync(new URL(dir, root)).filter((f) => f.endsWith(".json")).sort()
    .map((f) => ({ name: f.replace(/\.json$/, ""), user: load(dir + f) }));
}

/** The outputs worth guarding, rounded so float noise doesn't count as a change. */
export function keyOutputs(user, pack) {
  const r = evaluatePlan(user, pack, { today: TODAY });
  const age = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const lakh = (x) => (x == null ? null : Math.round(x / 1e4) / 10);
  return {
    earliestAge: age(r.earliestAge),
    requiredLakh: lakh(r.target.required),
    projectedLakh: lakh(r.target.projected),
    firstYearWithdrawalLakh: lakh(r.target.firstYearWithdrawal),
    chanceAtTarget: Math.round(r.chance.atTarget * 1000) / 1000,
    likelyAge: age(r.chance.likelyAge),
    confidentAge: age(r.chance.confidentAge),
    confidence: r.confidence.score,
  };
}

export const packFor = (rulesFile = "rules/in.2026.1.json") => load(rulesFile);
