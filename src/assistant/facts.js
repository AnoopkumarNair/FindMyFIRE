// The assistant's tools. Each one runs the plan engine and returns FACTS: finished sentences
// whose numbers come straight from the engine. The model may reword facts, never add to them,
// and the answer checker holds it to that. Without a model the facts are the answer.

import { inr, inrShort, pct, age1 } from "../ui/format.js";
import { whatIf, solveFor } from "../engine/index.js";
import { GLOSSARY } from "./glossary.js";

const round1 = (x) => Math.round(x * 10) / 10;

function mainDrivers(r) {
  const b = r.breakdown;
  const parts = [
    ["living costs", b.living], ["healthcare", b.health], ["health insurance premiums", b.healthPremium],
    ["EMIs that run past FIRE", b.emi], ["goals after FIRE", b.goals], ["income tax on withdrawals", b.tax],
  ].filter(([, v]) => v > 0.005 * b.costs).sort((a, c) => c[1] - a[1]);
  return parts;
}

function goalsBefore(r) {
  const inp = r.inputs;
  return inp.goals.filter((g) => g.atAge < r.target.age && g.atAge >= inp.age)
    .map((g) => ({ ...g, cost: g.costToday * (1 + g.inflationRate) ** Math.max(0, g.atAge - inp.age) }))
    .sort((a, b) => b.cost - a.cost);
}

const ageText = (a, until) => (a == null ? `not before ${until}` : age1(a));

// ---------------------------------------------------------------- tools

function whyAge(ctx) {
  const r = ctx.result, t = r.target, inp = r.inputs, P = r.params;
  const facts = [];
  facts.push(r.earliestAge == null
    ? `With today's numbers the money doesn't catch up with what you'd need before age ${inp.planUntilAge}.`
    : `Your earliest FIRE age is ${age1(r.earliestAge)} with steady markets. Your target is ${t.age}.`);
  facts.push(`At ${t.age} you would need ${inrShort(t.required)} and are on course to have ${inrShort(t.projected)}: ${t.gap >= 0 ? "a surplus" : "a shortfall"} of ${inrShort(Math.abs(t.gap))}.`);
  facts.push(`You start from ${inrShort(inp.fireCorpus)} invested, add ${inr(inp.monthlySip)} a month (rising ${pct(P.stepUp, 0)} a year)${inp.epfMonthly ? ` plus ${inr(inp.epfMonthly)} a month into PF` : ""}, growing at an assumed ${pct(P.rPre)} a year.`);
  const d = mainDrivers(r);
  if (d.length) facts.push(`The corpus needed pays for ${d.slice(0, 3).map(([k, v]) => `${k} (${inrShort(v)})`).join(", ")} from ${t.age} to ${inp.planUntilAge}.`);
  facts.push(`Costs are assumed to rise ${pct(P.infl.general)} a year (healthcare ${pct(P.infl.health)}), which is why the amount needed is much larger than today's spending suggests.`);
  const gb = goalsBefore(r).slice(0, 2);
  if (gb.length) facts.push(`Goals paid before ${t.age} come out of your investments: ${gb.map((g) => `${g.label} at ${Math.round(g.atAge)} (about ${inrShort(g.cost)} by then)`).join(" and ")}.`);
  const L = r.levers;
  if (L && !L.onTrack && L.investMore != null) facts.push(`Investing ${inr(L.investMore)} more a month would reach ${t.age}.`);
  if (L?.onTrack && L.spendAfterFire) facts.push(`You're on track: you could spend up to ${inr(L.spendAfterFire.to)} a month after FIRE (today's money) and still stop at ${t.age}.`);
  return { title: "Why this age", facts, followUps: ["How likely is it to work?", "What if I invest ₹10k more a month?", "What does the corpus pay for?"] };
}

function chance(ctx) {
  const r = ctx.result, c = r.chance, t = r.target;
  const facts = [
    `If you stop at ${t.age}, the money lasts to ${r.inputs.planUntilAge} in ${Math.round(c.atTarget * 100)}% of 1,000 simulated market histories.`,
    c.likelyAge != null ? `For a 3 in 4 chance, the age is ${age1(c.likelyAge)}.` : `A 3 in 4 chance isn't reached before ${r.inputs.planUntilAge}.`,
    c.confidentAge != null ? `For a 9 in 10 chance (a safe plan), the age is ${age1(c.confidentAge)}.` : `A 9 in 10 chance isn't reached before ${r.inputs.planUntilAge}.`,
    `With steady markets the earliest age is ${ageText(r.earliestAge, r.inputs.planUntilAge)}; that is roughly a 50/50 point because real markets have good and bad years.`,
    GLOSSARY.sequence_risk.text,
  ];
  return { title: "How likely it is", facts, followUps: ["What would get me to a 9 in 10 chance?", "Why this age?", "What is sequence risk?"] };
}

function corpus(ctx) {
  const r = ctx.result, t = r.target, b = r.breakdown;
  const facts = [`The corpus needed at ${t.age} is ${inrShort(t.required)}. It pays ${b.years} years of withdrawals, to age ${r.inputs.planUntilAge}.`];
  const d = mainDrivers(r);
  if (d.length) facts.push(`Valued at ${t.age}, it covers ${d.map(([k, v]) => `${k} ${inrShort(v)}`).join(", ")}.`);
  if (b.income > 0) facts.push(`Income after FIRE (rent, part-time work) covers ${inrShort(Math.min(b.income, b.costs))} of that.`);
  if (b.inflow > 0) facts.push(`Money arriving after FIRE (maturities, sales, pensions) covers ${inrShort(b.inflow)}.`);
  if (t.firstYearWithdrawal > 0) facts.push(`The first year's withdrawal is ${inrShort(t.firstYearWithdrawal)}, ${pct(t.firstYearWithdrawal / t.required, 2)} of the corpus.`);
  return { title: "What the corpus pays for", facts, followUps: ["How does the money come out after FIRE?", "Why this age?", "What if I spend ₹5k less a month?"] };
}

function withdraw(ctx) {
  const r = ctx.result, s = r.swp;
  const facts = [];
  if (!s?.buckets) {
    facts.push("Income and money coming in cover the first year's costs, so nothing needs to be withdrawn at first.");
  } else {
    facts.push(`At ${s.startAge} you'd withdraw about ${inr(s.firstMonthly)} a month in the first year (${inrShort(s.firstMonthly * 12)} a year), rising with inflation.`);
    facts.push(`It comes out in three buckets: ${inrShort(s.buckets.cash.amount)} in cash for 3 years of withdrawals, ${inrShort(s.buckets.debt.amount)} in debt for the next 5, and ${inrShort(s.buckets.equity.amount)} in equity for the rest.`);
    if (s.buckets.equity.return != null) facts.push(`For the whole corpus to earn the assumed ${pct(s.blendedReturn)} after FIRE, the equity part needs about ${pct(s.buckets.equity.return)} a year.`);
    if (s.firstTax > 0) facts.push(`Income tax in the first year is about ${inrShort(s.firstTax)} (${pct(s.firstTaxRate)} of the withdrawal), already included.`);
    else facts.push("Under the new tax regime the first year's withdrawal attracts little or no income tax.");
  }
  facts.push(GLOSSARY.buckets.text);
  return { title: "How the money comes out", facts, followUps: ["What does the corpus pay for?", "How likely is it to work?", "What is an SWP?"] };
}

function summary(ctx) {
  const r = ctx.result, t = r.target;
  const facts = [
    r.earliestAge == null ? `With today's numbers FIRE isn't reached before ${r.inputs.planUntilAge}.` : `Earliest FIRE age: ${age1(r.earliestAge)} with steady markets; ${age1(r.chance.confidentAge)} for a 9 in 10 chance.`,
    `Target ${t.age}: ${pct(t.funded, 0)} funded (${inrShort(t.projected)} of ${inrShort(t.required)} needed).`,
    `Chance the money lasts if you stop at ${t.age}: ${Math.round(r.chance.atTarget * 100)}%.`,
    `Confidence in the inputs: ${r.confidence.score} out of 100 (${r.confidence.band.label}).`,
  ];
  const next = [...r.confidence.sections].filter((x) => !x.done && x.potential > 0).sort((a, b) => b.potential - a.potential)[0];
  if (next) facts.push(`Filling in "${next.title}" would raise confidence the most.`);
  return { title: "Where you stand", facts, followUps: ["Why this age?", "How likely is it to work?", `What would it take to stop at ${Math.max(Math.ceil(r.inputs.age) + 1, t.age - 3)}?`] };
}

function term(ctx, slots) {
  const g = GLOSSARY[slots.term];
  if (!g) return help(ctx);
  return { title: g.names[0].toUpperCase() === g.names[0] ? g.names[0] : g.names[0][0].toUpperCase() + g.names[0].slice(1), facts: [g.text], followUps: ["Why this age?", "How does the money come out after FIRE?"] };
}

/** Turns "returns of 8%" or "inflation at 7%" into changes relative to the plan's own values. */
function normaliseChanges(ch, r) {
  const out = { ...ch };
  if (out.returnTo != null) { out.returnDelta = out.returnTo - r.params.rPre; delete out.returnTo; }
  if (out.inflationTo != null) { out.inflationDelta = out.inflationTo - r.params.infl.general; delete out.inflationTo; }
  return out;
}

function describeChanges(ch, r, goals) {
  const bits = [];
  if (ch.sipTotal != null) bits.push(`investing ${inr(ch.sipTotal)} a month in total`);
  if (ch.sipDelta) bits.push(`investing ${inr(Math.abs(ch.sipDelta))} ${ch.sipDelta > 0 ? "more" : "less"} a month`);
  if (ch.expenseDelta) bits.push(`spending ${inr(Math.abs(ch.expenseDelta))} ${ch.expenseDelta > 0 ? "more" : "less"} a month`);
  if (ch.dropGoalIds?.length) bits.push(`skipping ${goals.filter((g) => ch.dropGoalIds.includes(g.id)).map((g) => g.label).join(" and ")}`);
  if (ch.returnDelta) bits.push(`returns of ${pct(r.params.rPre + ch.returnDelta)} before FIRE and ${pct(r.params.rPost + ch.returnDelta)} after`);
  if (ch.inflationDelta) bits.push(`inflation of ${pct(r.params.infl.general + ch.inflationDelta)}`);
  if (ch.lumpSum) bits.push(`receiving ${inrShort(ch.lumpSum.amount)} at ${ch.lumpSum.atAge}`);
  if (ch.fireAge != null) bits.push(`stopping at ${ch.fireAge}`);
  return bits.join(", ");
}

function whatIfTool(ctx, slots) {
  const r = ctx.result, goals = ctx.user.goals || [];
  const ch = normaliseChanges(slots.changes || {}, r);
  if (ch.lumpSum && ch.lumpSum.atAge == null) delete ch.lumpSum;
  if (!Object.keys(ch).length) {
    return { title: "What would you like to try?", ask: true,
      facts: ["Tell me one change to try, with an amount. For example: invest ₹10k more a month, spend ₹5k less a month, skip a goal, or returns of 9%."],
      followUps: ["What if I invest ₹10k more a month?", "What if I spend ₹5k less a month?", "What if returns are 1% lower?"] };
  }
  const w = whatIf(ctx.user, ctx.pack, ch, { today: ctx.today });
  const B = w.before, A = w.after, label = describeChanges(w.changes, r, goals);
  const until = r.inputs.planUntilAge;
  const facts = [
    `With ${label}: earliest FIRE age ${ageText(A.earliestAge, until)} instead of ${ageText(B.earliestAge, until)}.`,
    `Chance the money lasts if you stop at ${A.targetAge}: ${Math.round(A.chance * 100)}% instead of ${Math.round(B.chance * 100)}%.`,
    `At ${A.targetAge}: ${inrShort(A.projected)} projected against ${inrShort(A.required)} needed (was ${inrShort(B.projected)} against ${inrShort(B.required)}).`,
  ];
  if ((A.confidentAge != null || B.confidentAge != null) && A.confidentAge !== B.confidentAge)
    facts.push(`Age for a 9 in 10 chance: ${ageText(A.confidentAge, until)} instead of ${ageText(B.confidentAge, until)}.`);
  if (B.earliestAge != null && A.earliestAge != null) {
    const d = round1(B.earliestAge - A.earliestAge);
    if (Math.abs(d) >= 0.1) facts.push(`That's about ${Math.abs(d)} years ${d > 0 ? "sooner" : "later"}.`);
    else facts.push("That barely moves the earliest age.");
  }
  return { title: "What if…", facts, card: { type: "whatif", label, changes: w.changes, before: B, after: A },
    followUps: ["Why this age?", "What would it take to stop 2 years earlier?"] };
}

function solveForTool(ctx, slots) {
  const r = ctx.result, inp = r.inputs;
  const age = slots.age ?? slots.changes?.fireAge;
  if (age == null) return whyAge(ctx);
  if (age <= inp.age) return { title: "That age has passed", facts: [`You're ${age1(inp.age)} now, so pick an age after that.`], followUps: [] };
  if (age >= inp.planUntilAge) return { title: "Past the plan", facts: [`Your plan runs to ${inp.planUntilAge}; pick an age before that.`], followUps: [] };
  const s = solveFor(ctx.user, ctx.pack, age, { today: ctx.today }), L = s.levers;
  const facts = [];
  if (L.onTrack) {
    facts.push(`Stopping at ${age} already works with steady markets: ${inrShort(s.projected)} projected against ${inrShort(s.required)} needed.`);
    facts.push(`Chance the money lasts: ${Math.round(s.chance * 100)}%.`);
    if (L.spendAfterFire) facts.push(`You could even spend up to ${inr(L.spendAfterFire.to)} a month after FIRE (today's money).`);
  } else {
    facts.push(`At ${age} you'd need ${inrShort(s.required)} and are on course for ${inrShort(s.projected)}: short by ${inrShort(-s.gap)}.`);
    facts.push(`Chance the money lasts if you stop at ${age}: ${Math.round(s.chance * 100)}%.`);
    const ways = [];
    if (L.investMore != null) ways.push(`invest ${inr(L.investMore)} more a month (${inr(inp.monthlySip + L.investMore)} in total)`);
    if (L.spendAfterFire) ways.push(`live on ${inr(L.spendAfterFire.to)} a month after FIRE instead of ${inr(L.spendAfterFire.from)} (today's money)`);
    if (ways.length) facts.push(`Any one of these closes the gap on its own: ${ways.join("; or ")}.`);
    if (L.investMore != null && ctx.result.inputs.takeHomeMonthly > 0 && inp.monthlySip + L.investMore > ctx.result.inputs.takeHomeMonthly)
      facts.push(`That investment is more than your take-home pay of ${inr(ctx.result.inputs.takeHomeMonthly)}, so it would take a mix of changes.`);
  }
  return { title: `Stopping at ${age}`, facts, card: { type: "solve", age }, followUps: ["How likely is it to work?", "What if I spend ₹10k less a month?"] };
}

function outOfScope() {
  return { title: "Not something I can pick for you", facts: [
    "I can't recommend specific funds, stocks or products; that needs a SEBI-registered adviser who knows your full situation.",
    "I can explain your plan, try what-ifs, and show what it would take to stop at a particular age.",
  ], followUps: ["How does the money come out after FIRE?", "What is the bucket method?", "Why this age?"] };
}

function help() {
  return { title: "What I can help with", facts: [
    "I answer questions about the plan on this page, using the same calculations as the results.",
    "Try: \"Why this age?\", \"How likely is it to work?\", \"What if I invest ₹10k more a month?\", \"What would it take to stop at 50?\", or \"What is an SWP?\"",
  ], followUps: ["Why this age?", "How likely is it to work?", "What if I invest ₹10k more a month?"] };
}

export const TOOLS = { why_age: whyAge, chance, corpus, withdraw, summary, term, what_if: whatIfTool, solve_for: solveForTool, out_of_scope: outOfScope, help };

/** Runs the tool for an intent. Always returns something showable. */
export function runTool(intent, slots, ctx) {
  const fn = TOOLS[intent] || help;
  if (!ctx.result) return { intent: "help", title: "Answer the quick questions first", facts: ["Once your plan has a result, I can explain it and try what-ifs."], followUps: [] };
  return { intent, ...fn(ctx, slots || {}) };
}
