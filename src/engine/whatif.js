// "What if…" and "what would it take…" questions, answered by the same projection as the
// headline. Nothing here is estimated: each answer is a full re-run with one thing changed.

import { resolveInputs } from "./resolve.js";
import { makeParams, analyse } from "./project.js";
import { chanceByFireYear, levers } from "./risk.js";

/**
 * Changes a what-if can make. All money is today's rupees a month unless noted.
 *   sipDelta / sipTotal     – invest more (or less) from pay each month
 *   expenseDelta            – spend more (or less) each month, spread over every expense
 *   fireAge                 – stop working at this age instead
 *   dropGoalIds             – leave these goals out
 *   returnDelta             – returns before and after FIRE move by this much (0.01 = 1 point)
 *   inflationDelta          – general inflation moves by this much
 *   lumpSum {amount, atAge} – one-off money received (after tax), e.g. an inheritance
 */
export const WHATIF_KEYS = ["sipDelta", "sipTotal", "expenseDelta", "fireAge", "dropGoalIds", "returnDelta", "inflationDelta", "lumpSum"];

function applyChanges(inp, ch) {
  const out = { ...inp };
  if (ch.sipTotal != null) out.monthlySip = Math.max(0, ch.sipTotal);
  else if (ch.sipDelta) out.monthlySip = Math.max(0, inp.monthlySip + ch.sipDelta);
  if (ch.expenseDelta) {
    const total = inp.expenses.reduce((s, e) => s + e.monthly, 0);
    const f = total > 0 ? Math.max(0, (total + ch.expenseDelta) / total) : 1;
    out.expenses = inp.expenses.map((e) => ({ ...e, monthly: e.monthly * f }));
  }
  if (ch.fireAge != null) out.fireTargetAge = ch.fireAge;
  if (ch.dropGoalIds?.length) {
    const drop = new Set(ch.dropGoalIds);
    out.goals = inp.goals.filter((g) => !drop.has(g.goalId));
  }
  if (ch.lumpSum?.amount > 0 && ch.lumpSum.atAge > inp.age)
    out.inflows = [...inp.inflows, { label: "What-if lump sum", atAge: ch.lumpSum.atAge, net: ch.lumpSum.amount, source: "estimate" }];
  return out;
}

function outcome(inp, ch) {
  const p = makeParams(inp, {
    returnBeforeFireDelta: ch.returnDelta || 0,
    returnAfterFireDelta: ch.returnDelta || 0,
    generalInflationDelta: ch.inflationDelta || 0,
  });
  const a = analyse(inp, p);
  const chances = chanceByFireYear(inp, p);
  const at = chances[Math.min(Math.max(0, a.tTarget), chances.length - 1)];
  const first = (x) => chances.find((c) => c.chance >= x)?.age ?? null;
  return {
    inp, p, a,
    summary: {
      targetAge: inp.fireTargetAge,
      earliestAge: a.earliestAge,
      required: a.required,
      projected: a.projected,
      gap: a.gap,
      chance: at.chance,
      likelyAge: first(0.75),
      confidentAge: first(0.9),
      monthlySip: inp.monthlySip,
      monthlyExpenses: inp.expenses.reduce((s, e) => s + e.monthly, 0),
    },
  };
}

/** Before and after for one set of changes. Unknown keys are ignored. */
export function whatIf(user, pack, changes = {}, { today = new Date() } = {}) {
  const inp = resolveInputs(user, pack, today);
  const ch = Object.fromEntries(Object.entries(changes).filter(([k]) => WHATIF_KEYS.includes(k)));
  const before = outcome(inp, {}).summary;
  const after = outcome(applyChanges(inp, ch), ch).summary;
  return { changes: ch, before, after };
}

/** What it takes to stop at `age`: the same three levers the results page shows, at that age. */
export function solveFor(user, pack, age, { today = new Date() } = {}) {
  const inp = { ...resolveInputs(user, pack, today), fireTargetAge: age };
  const o = outcome(inp, {});
  return { age, ...o.summary, levers: levers(o.inp, o.p, o.a) };
}
