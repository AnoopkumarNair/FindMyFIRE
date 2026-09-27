// Two ways of explaining a result: which inputs move it most (sensitivity), and the chain of
// calculations from today's spending to the corpus needed (the math). Steady returns throughout.

import { analyse, withdrawalParts, preFireFlows } from "./project.js";

/**
 * How much the earliest FIRE age and the corpus needed change when one input moves by a
 * realistic amount, each on its own. Sorted with the biggest effect on the FIRE age first.
 */
export function sensitivity(inp, p, base = analyse(inp, p)) {
  const levers = [
    { id: "spending", label: "Spending", lo: "10% less", hi: "10% more", apply: (q, s) => ({ ...q, expenseScale: q.expenseScale * (1 + 0.1 * s) }) },
    { id: "returns", label: "Returns", lo: "1 point lower", hi: "1 point higher", apply: (q, s) => ({ ...q, rPre: q.rPre + 0.01 * s, rPost: q.rPost + 0.01 * s }) },
    { id: "inflation", label: "Inflation", lo: "1 point lower", hi: "1 point higher", apply: (q, s) => ({ ...q, infl: { ...q.infl, general: q.infl.general + 0.01 * s } }) },
    { id: "investing", label: "Monthly investing", lo: "20% less", hi: "20% more", apply: (q, s) => ({ ...q, sip: q.sip * (1 + 0.2 * s) }) },
    { id: "horizon", label: "How long the money must last", lo: "5 years less", hi: "5 years more", apply: (q, s) => ({ ...q, planUntilAge: q.planUntilAge + 5 * s }) },
    { id: "target", label: "Target age", lo: "2 years earlier", hi: "2 years later", apply: (q, s) => ({ ...q, fireTargetAge: q.fireTargetAge + 2 * s }) },
  ];
  const rows = levers.map((l) => {
    const side = (s) => {
      const a = analyse(inp, l.apply(p, s));
      return {
        earliestAge: a.earliestAge,
        ageDelta: a.earliestAge == null || base.earliestAge == null ? null : a.earliestAge - base.earliestAge,
        requiredDelta: a.required - base.required,
      };
    };
    return { id: l.id, label: l.label, lo: { label: l.lo, ...side(-1) }, hi: { label: l.hi, ...side(1) } };
  });
  const size = (r) => Math.max(Math.abs(r.lo.ageDelta ?? 99), Math.abs(r.hi.ageDelta ?? 99));
  return rows.sort((a, b) => size(b) - size(a) || Math.abs(b.hi.requiredDelta) - Math.abs(a.hi.requiredDelta));
}

/** The steps from today's numbers to the corpus needed and the corpus projected at the target age. */
export function mathTrail(inp, p, base = analyse(inp, p)) {
  const T = base.tTarget;
  const first = withdrawalParts(inp, p, {}, T);
  const yearsRetired = Math.max(0, p.planUntilAge - p.fireTargetAge);
  const flows = preFireFlows(inp, p, T);
  const contributions = flows.contributions.reduce((s, x) => s + x, 0);
  const lumps = flows.lumps.reduce((s, x) => s + x, 0); // money received less goals paid, before FIRE
  return {
    fireAge: p.fireTargetAge, yearsToFire: T, yearsRetired,
    inflation: p.infl, returnBefore: p.rPre, returnAfter: p.rPost,
    firstYear: first,
    required: base.required,
    savingsToday: p.corpus,
    contributions, lumps,
    projected: base.projected,
    growth: base.projected - p.corpus - contributions - lumps,
  };
}
