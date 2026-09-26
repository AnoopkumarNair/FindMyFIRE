// The assistant without a model: routing, the facts it builds from the engine, and the checker
// that stops a model's reply from showing a number the engine didn't produce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluatePlan, whatIf, solveFor } from "../src/engine/index.js";
import { route } from "../src/assistant/router.js";
import { runTool } from "../src/assistant/facts.js";
import { numbersIn, amountIn, ageIn } from "../src/assistant/parse.js";
import { checkReply, checkSentence, allowedNumbers, splitSentences } from "../src/assistant/guard.js";
import { answer } from "../src/assistant/answer.js";
import { parseLabel } from "../src/assistant/prompt.js";
import { inrShort } from "../src/ui/format.js";

const pack = JSON.parse(readFileSync(new URL("../rules/in.2026.1.json", import.meta.url)));
const detailed = JSON.parse(readFileSync(new URL("../examples/user-detailed.example.json", import.meta.url)));
const quick = JSON.parse(readFileSync(new URL("../examples/user-quick.example.json", import.meta.url)));
const today = new Date("2026-09-26");
const ctxFor = (user) => ({ user, pack, today, result: evaluatePlan(user, pack, { today }) });
const ctx = ctxFor(detailed);
const goals = detailed.goals;

test("amounts, ages and percentages are read the Indian way", () => {
  assert.equal(amountIn("invest 10k more"), 10000);
  assert.equal(amountIn("₹45,000 a month"), 45000);
  assert.equal(amountIn("1.5 lakh"), 150000);
  assert.equal(amountIn("an inheritance of 50L"), 5000000);
  assert.equal(amountIn("₹2.35 Cr"), 23500000);
  assert.equal(amountIn("Rs 12000"), 12000);
  assert.equal(ageIn("retire at 45"), 45);
  assert.equal(ageIn("can I stop by 50?"), 50);
  assert.equal(ageIn("invest 45k"), null);
  assert.deepEqual(numbersIn("8.5% after, 9 percent before").map((n) => n.value), [8.5, 9]);
});

const ROUTES = [
  ["Why 57 and not 50?", "why_age"], ["why is my fire age so late", "why_age"], ["what's driving my age", "why_age"],
  ["When can I retire?", "why_age"], ["what's delaying my FIRE?", "why_age"],
  ["how likely is this to work", "chance"], ["what are the chances my money runs out", "chance"], ["is my plan safe", "chance"],
  ["what if markets crash", "chance"],
  ["what does the corpus pay for", "corpus"], ["how much do I need", "corpus"], ["breakdown of the target amount", "corpus"],
  ["how will I get money after I retire", "withdraw"], ["how are my buckets split", "withdraw"], ["how much can I withdraw monthly", "withdraw"],
  ["what if I invest 10k more a month", "what_if"], ["what if I put 20000 extra in SIP", "what_if"], ["spend 5k less", "what_if"],
  ["what if I skip the car", "what_if"], ["what if returns are 8%", "what_if"], ["what if inflation is 7%", "what_if"],
  ["I get an inheritance of 50 lakh at 55", "what_if"], ["what if I stop my SIP", "what_if"],
  ["what would it take to retire at 50", "solve_for"], ["can I stop at 52?", "solve_for"], ["I want to retire at 45", "solve_for"],
  ["am I on track?", "summary"], ["give me an overview", "summary"], ["how am I doing", "summary"],
  ["what is an SWP", "term"], ["what does real return mean", "term"], ["explain step-up", "term"], ["what is NPS", "term"],
  ["which mutual fund should I buy", "out_of_scope"], ["best stocks for FIRE?", "out_of_scope"], ["should I buy bitcoin", "out_of_scope"],
  ["how do I file my ITR", "out_of_scope"],
  ["help", "help"], ["what can you do", "help"],
];

test("the rules route common questions without a model", () => {
  const wrong = [];
  for (const [q, want] of ROUTES) {
    const r = route(q, { goals, age: ctx.result.inputs.age });
    if (r.intent !== want) wrong.push(`${q} → ${r.intent} (want ${want})`);
  }
  assert.deepEqual(wrong, []);
});

test("what-if questions carry the right changes", () => {
  const ch = (q) => route(q, { goals, age: 36 }).slots.changes;
  assert.deepEqual(ch("what if I invest 10k more a month"), { sipDelta: 10000 });
  assert.deepEqual(ch("what if I invest 10k less"), { sipDelta: -10000 });
  assert.deepEqual(ch("spend 5k less a month"), { expenseDelta: -5000 });
  assert.deepEqual(ch("what if I skip the car"), { dropGoalIds: ["g2"] });
  assert.deepEqual(ch("what if returns are 8%"), { returnTo: 0.08 });
  assert.deepEqual(ch("inheritance of 50 lakh at 55"), { lumpSum: { amount: 5000000, atAge: 55 } });
  assert.deepEqual(ch("what if I stop my SIP"), { sipTotal: 0 });
});

test("what-if with no changes is the headline result, exactly", () => {
  for (const user of [detailed, quick]) {
    const r = evaluatePlan(user, pack, { today }), w = whatIf(user, pack, {}, { today });
    assert.equal(w.before.earliestAge, r.earliestAge);
    assert.equal(w.after.earliestAge, r.earliestAge);
    assert.equal(w.before.required, r.target.required);
    assert.equal(w.before.chance, r.chance.atTarget);
    assert.equal(w.before.confidentAge, r.chance.confidentAge);
  }
});

test("what-ifs move the result the right way", () => {
  const e = (ch) => whatIf(detailed, pack, ch, { today }).after.earliestAge;
  const base = ctx.result.earliestAge;
  assert.ok(e({ sipDelta: 10000 }) < base);
  assert.ok(e({ sipDelta: -10000 }) > base);
  assert.ok(e({ expenseDelta: -5000 }) < base);
  assert.ok(e({ dropGoalIds: ["g2"] }) < base);
  assert.ok(e({ returnDelta: -0.01 }) > base);
  assert.ok(e({ inflationDelta: 0.01 }) > base);
  assert.ok(e({ lumpSum: { amount: 5e6, atAge: 45 } }) < base);
});

test("solving for the target age matches the results page levers", () => {
  const s = solveFor(detailed, pack, ctx.result.target.age, { today });
  assert.equal(s.levers.investMore, ctx.result.levers.investMore);
  assert.equal(s.required, ctx.result.target.required);
});

test("facts quote the engine's own numbers", () => {
  const r = ctx.result;
  const why = runTool("why_age", {}, ctx).facts.join(" ");
  assert.ok(why.includes(inrShort(r.target.required)));
  assert.ok(why.includes(inrShort(r.target.projected)));
  const ch = runTool("chance", {}, ctx).facts.join(" ");
  assert.ok(ch.includes(`${Math.round(r.chance.atTarget * 100)}%`));
  for (const intent of ["why_age", "chance", "corpus", "withdraw", "summary", "out_of_scope", "help"])
    for (const user of [detailed, quick]) {
      const t = runTool(intent, {}, ctxFor(user));
      assert.ok(t.facts.length > 0, intent);
      for (const f of t.facts) assert.ok(!/undefined|NaN|null|—/.test(f), `${intent}: ${f}`);
    }
});

test("the checker accepts faithful rewording", () => {
  const facts = ["At 50 you would need ₹9.08 Cr and are on course to have ₹4.96 Cr.", "Chance it lasts: 11%.", "Earliest age 57.7."];
  const ok = [
    "You'd need about ₹9.08 Cr by 50, and you're heading for ₹4.96 Cr.",
    "That's roughly 9.1 crore needed.",
    "Right now the chance is 11 percent.",
    "Your earliest age is about 58.",
    "The 3 buckets keep 1 year safe.",
  ];
  for (const s of ok) assert.equal(checkSentence(s, allowedNumbers(facts)), null, s);
});

test("the checker rejects invented numbers, promises and product picks", () => {
  const facts = ["At 50 you would need ₹9.08 Cr and are on course to have ₹4.96 Cr.", "Chance it lasts: 11%.", "Earliest age 57.7."];
  const bad = [
    "You'd need ₹10 Cr.", "You need to save ₹25,000 more.", "Returns of 12% would fix it.", "You could retire at 52.",
    "This plan is guaranteed to work.", "You should buy an index fund.", "Consider investing in bitcoin.", "See https://example.com",
  ];
  for (const s of bad) assert.notEqual(checkSentence(s, allowedNumbers(facts)), null, s);
});

test("a changed number in any fact is caught (every tool, both example plans)", () => {
  let checked = 0;
  for (const user of [detailed, quick]) {
    const c = ctxFor(user);
    for (const intent of ["why_age", "chance", "corpus", "withdraw", "summary"]) {
      const facts = runTool(intent, {}, c).facts, allowed = allowedNumbers(facts);
      for (const f of facts)
        for (const n of numbersIn(f)) {
          if (n.kind === "plain" && n.value <= 12) continue;
          // Move the number 10% (and at least 1 for ages) and put it back in the sentence.
          const moved = n.kind === "money" ? `₹${inrShort(n.value * 1.1).slice(1)}` : n.kind === "percent" ? `${(n.value * 1.1 + 0.2).toFixed(1)}%` : `${Math.round(n.value + Math.max(1, n.value * 0.1))}`;
          const s = f.replace(n.raw, moved);
          // Known limit: a number moved onto another real fact (₹2.92 Cr → ₹3.2 Cr when ₹3.16 Cr is also a fact)
          // passes. The checker stops invented numbers, not swapped ones; the facts shown under every answer cover that.
          const landed = numbersIn(moved)[0];
          if (landed && allowed.some((a) => a !== n && a.kind === landed.kind && Math.abs(a.value - landed.value) <= Math.max(0.51, 0.03 * a.value))) continue;
          assert.notEqual(checkSentence(s, allowed), null, `${intent}: "${s}" should fail`);
          checked++;
        }
    }
  }
  assert.ok(checked > 40, `only ${checked} numbers checked`);
});

test("sentences are split without breaking decimals", () => {
  const { sentences, rest } = splitSentences("You need ₹1.2 Cr by 50. That's 8.5% a year. And then");
  assert.deepEqual(sentences, ["You need ₹1.2 Cr by 50.", "That's 8.5% a year."]);
  assert.equal(rest, "And then");
});

test("checkReply passes a good reply and flags a bad one", () => {
  const facts = ["Chance it lasts: 11%."];
  assert.equal(checkReply("The chance is 11%. That is low.", facts).passed, true);
  assert.equal(checkReply("The chance is 11%. It could be 40% with luck.", facts).passed, false);
});

// ---- the whole pipeline with a stand-in model ----
const fakeModel = (reply, label = "chance") => ({
  calls: [],
  async generate(messages, { onToken, signal } = {}) {
    this.calls.push(messages);
    if (messages[0].content.startsWith("Classify")) return label;
    const text = typeof reply === "function" ? reply(messages) : reply;
    for (const piece of text.match(/.{1,6}/gs)) {
      if (signal?.aborted) throw new Error("aborted");
      onToken?.(piece);
    }
    return text;
  },
});

test("a faithful model reply is shown, sentence by sentence", async () => {
  const pct = `${Math.round(ctx.result.chance.atTarget * 100)}%`;
  const updates = [];
  const a = await answer("how likely is this to work", ctx, {
    llm: fakeModel(`If you stop at ${ctx.result.target.age}, your money lasts in ${pct} of simulated markets. That's low, so waiting a few years helps.`),
    onUpdate: (u) => updates.push(u.sentences.length),
  });
  assert.equal(a.mode, "model");
  assert.equal(a.text.length, 2);
  assert.deepEqual(updates, [1, 2]);
});

test("a reply with an invented number falls back to the facts", async () => {
  const a = await answer("how likely is this to work", ctx, { llm: fakeModel("Your chance is decent. It is about 64% overall.") });
  assert.equal(a.mode, "facts");
  assert.match(a.problem.why, /unknown number/);
  assert.equal(a.text, null);
});

test("a reply that recommends a product falls back to the facts", async () => {
  const a = await answer("how likely is this to work", ctx, { llm: fakeModel("You should buy a large-cap fund to be safe.") });
  assert.equal(a.mode, "facts");
});

test("the model only picks a label when the rules aren't sure, and can't invent one", async () => {
  const m = fakeModel("Fine.", "chance");
  const a = await answer("hmm my worry is the whole thing collapsing", ctx, { llm: m });
  assert.equal(a.by, "model");
  assert.equal(a.intent, "chance");
  const sure = fakeModel("Fine.");
  await answer("what if I invest 10k more a month", ctx, { llm: sure });
  assert.ok(!sure.calls.some((c) => c[0].content.startsWith("Classify")));
  assert.equal(parseLabel("I think: summary"), "summary");
  assert.equal(parseLabel("delete_everything"), null);
});

test("without a model the facts are the answer", async () => {
  const a = await answer("why this age?", ctx);
  assert.equal(a.mode, "facts");
  assert.ok(a.facts.length >= 4);
});
