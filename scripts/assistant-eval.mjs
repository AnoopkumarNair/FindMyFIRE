// Runs the real model on CPU through the same answer pipeline the app uses, and reports how
// often it helps, how often the checker had to step in, and how fast it is.
//
//   npm i --no-save @huggingface/transformers@4.3.0
//   node scripts/assistant-eval.mjs models-dev/qwen3-0.6b.entry.json models-dev > report.md

import { readFile } from "node:fs/promises";
import { evaluatePlan } from "../src/engine/index.js";
import { answer, understand, SURE } from "../src/assistant/answer.js";
import { route } from "../src/assistant/router.js";

const [entryFile, dir] = process.argv.slice(2);
const entry = JSON.parse(await readFile(entryFile, "utf8"));
const T = await import("@huggingface/transformers");
T.env.allowRemoteModels = false;
T.env.localModelPath = dir.endsWith("/") ? dir : dir + "/";
// Node runs on CPU: use the q4 build (the one GPUs without f16 get), whichever variant lists it.
const variant = entry.variants.wasm || entry.variants.webgpu || entry.variants["webgpu-f16"];
const load0 = Date.now();
const tokenizer = await T.AutoTokenizer.from_pretrained(entry.path);
const lm = await T.AutoModelForCausalLM.from_pretrained(entry.path, { dtype: variant.dtype, device: "cpu" });
const loadMs = Date.now() - load0;

const stats = [];
const llm = {
  async generate(messages, { maxTokens = 140, onToken, signal } = {}) {
    const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, ...(entry.chat || {}) });
    const stop = new T.InterruptableStoppingCriteria();
    signal?.addEventListener("abort", () => stop.interrupt(), { once: true });
    let text = "", n = 0, first = null;
    const t0 = Date.now();
    const streamer = new T.TextStreamer(tokenizer, { skip_prompt: true, skip_special_tokens: true,
      callback_function: (p) => { n++; first ??= Date.now() - t0; text += p; onToken?.(p); } });
    await lm.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.1, streamer, stopping_criteria: stop });
    stats.push({ tokens: n, ms: Date.now() - t0, firstMs: first ?? 0, prompt: inputs.input_ids.dims.at(-1) });
    return text;
  },
};

const pack = JSON.parse(await readFile(new URL("../rules/in.2026.1.json", import.meta.url)));
const today = new Date();
const plans = {};
for (const k of ["detailed", "quick"]) {
  const user = JSON.parse(await readFile(new URL(`../examples/user-${k}.example.json`, import.meta.url)));
  plans[k] = { user, pack, today, result: evaluatePlan(user, pack, { today }) };
}

// Phrasings the rules may not catch: this is where the model should earn its place.
const HARD = [
  ["honestly, is quitting at 50 realistic for me?", "solve_for"], ["my worry is running out of money at 80", "chance"],
  ["break down the big number for me", "corpus"], ["how do I pay myself once the salary stops", "withdraw"],
  ["what's pushing my date out so far", "why_age"], ["give me the gist", "summary"], ["what's this bucket thing", "term"],
  ["is hdfc flexicap good", "out_of_scope"], ["yo", "help"], ["could a bad market in my first years wreck this", "chance"],
  ["where does all that money go", "corpus"], ["am I doing alright", "summary"], ["tell me like I'm five why it's that age", "why_age"],
  ["how will cash flow work in retirement", "withdraw"], ["what if I trim my monthly outgo by 8k", "what_if"],
  ["which term plan should I take", "out_of_scope"], ["what does coast FIRE mean", "term"], ["what's the point of this tool", "help"],
  ["is 45 doable", "solve_for"], ["what makes the target so huge", "corpus"], ["odds this works?", "chance"],
  ["explain my result", "summary"], ["why not earlier", "why_age"], ["do I need to worry about inflation eating it", "chance"],
  ["how is the pension-like income set up", "withdraw"], ["suppose I get a 30 lakh bonus at 40", "what_if"],
];
// Written after the rules were widened using HARD, so the rules were never tuned on these.
const HELD_OUT = [
  ["is my retirement date too far away and why", "why_age"], ["what's slowing me down", "why_age"],
  ["can I really afford to stop at 48", "solve_for"], ["what would make 46 work", "solve_for"],
  ["would I be okay if the sensex tanks right after I quit", "chance"], ["how safe is my plan really", "chance"],
  ["how is that crore figure calculated", "corpus"], ["why do I need so many crores", "corpus"],
  ["how much can I take out every month later", "withdraw"], ["how do I turn my savings into a monthly income", "withdraw"],
  ["what if I increase my SIP by 15000", "what_if"], ["what happens if I don't buy the car", "what_if"],
  ["quick recap please", "summary"], ["where do I stand overall", "summary"],
  ["what's a withdrawal rate", "term"], ["meaning of real return?", "term"],
  ["should I put money in gold ETFs", "out_of_scope"], ["recommend a good SIP fund", "out_of_scope"],
  ["hello there", "help"], ["how do I use this", "help"],
];
const EXPLAIN = ["Why this age?", "Will my money last?", "What does the corpus pay for?", "How does the money come out after FIRE?",
  "What if I invest ₹10k more a month?", "Am I on track?", "What is an SWP?"];

async function routing(set) {
  let rules = 0, model = 0, asked = 0;
  const rows = [];
  for (const [q, want] of set) {
    const r = route(q, { goals: plans.detailed.user.goals, age: plans.detailed.result.inputs.age });
    const u = await understand(q, plans.detailed, llm);
    if (r.intent === want) rules++;
    if (u.intent === want) model++;
    if (r.confidence < SURE) asked++;
    rows.push(`| ${q} | ${want} | ${r.intent ?? "–"} (${r.confidence.toFixed(2)}) | ${u.intent ?? "–"} ${u.by === "model" ? "🤖" : ""} |`);
  }
  return { rules, model, asked, rows };
}
const held = await routing(HELD_OUT);
let rulesRight = 0, modelRight = 0, asked = 0;
const routeRows = [];
for (const [q, want] of HARD) {
  const r = route(q, { goals: plans.detailed.user.goals, age: plans.detailed.result.inputs.age });
  const u = await understand(q, plans.detailed, llm);
  if (r.intent === want) rulesRight++;
  if (u.intent === want) modelRight++;
  if (r.confidence < SURE) asked++;
  routeRows.push(`| ${q} | ${want} | ${r.intent ?? "–"} (${r.confidence.toFixed(2)}) | ${u.intent ?? "–"} ${u.by === "model" ? "🤖" : ""} |`);
}

const explainRows = [];
let passed = 0, total = 0;
stats.length = 0;
for (const k of Object.keys(plans))
  for (const q of EXPLAIN) {
    const a = await answer(q, plans[k], { llm });
    total++;
    if (a.mode === "model") passed++;
    explainRows.push(`| ${k} | ${q} | ${a.mode === "model" ? "✓ " + a.text.join(" ").replace(/\|/g, "/") : `✗ facts shown (${a.problem?.why?.replace(/\|/g, "/")})`} |`);
  }

const sum = (f) => stats.reduce((s, x) => s + f(x), 0);
const tps = sum((x) => x.tokens) / (sum((x) => x.ms) / 1000);
const bytes = (v) => (v.files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(0);
console.log(`## ${entry.name} (${entry.repo}@${entry.revision.slice(0, 7)}, ${entry.license})

Download: ${Object.entries(entry.variants).map(([n, v]) => `${n} ${typeof v.dtype === "string" ? v.dtype : JSON.stringify(v.dtype)} **${bytes(v)} MB**`).join(" · ")}
Load on this CPU: ${(loadMs / 1000).toFixed(1)} s · Speed on this CPU (${JSON.stringify(variant.dtype)}): **${tps.toFixed(1)} tokens/s**, first token after ${(sum((x) => x.firstMs) / stats.length / 1000).toFixed(1)} s on average

### Understanding new phrasings the rules were not tuned on (${HELD_OUT.length})
Rules alone: **${held.rules}/${HELD_OUT.length}** · Rules + model (asked for ${held.asked}): **${held.model}/${HELD_OUT.length}**

| Question | Expected | Rules | With model |
|---|---|---|---|
${held.rows.join("\n")}

### Understanding the phrasings the rules were tuned on (${HARD.length})
Rules alone: **${rulesRight}/${HARD.length}** · Rules + model (asked for ${asked}): **${modelRight}/${HARD.length}**

| Question | Expected | Rules | With model |
|---|---|---|---|
${routeRows.join("\n")}

### Explanations: model reply passed the checker in **${passed}/${total}**
| Plan | Question | Answer |
|---|---|---|
${explainRows.join("\n")}
`);
