// What the model is asked. Two small jobs only: pick a label, or reword given facts.

import { INTENTS, LABELS } from "./router.js";

export const SYSTEM_EXPLAIN = [
  "You explain a person's FIRE (financial independence) plan in India, in plain, warm English.",
  "Rules:",
  "- Use ONLY the FACTS. Copy every number exactly as written in the FACTS. Never calculate, estimate or invent a number.",
  "- If the FACTS don't answer the question, say you can't tell from this plan.",
  "- At most 3 short sentences. No lists, no headings.",
  "- Never recommend a fund, stock or product, and never promise returns.",
].join("\n");

export function explainMessages(question, facts) {
  return [
    { role: "system", content: SYSTEM_EXPLAIN },
    { role: "user", content: `FACTS:\n${facts.map((f) => `- ${f}`).join("\n")}\n\nQUESTION: ${question}` },
  ];
}

const EXAMPLES = [
  ["why am I retiring so late", "why_age"],
  ["will my money last if markets crash", "chance"],
  ["how much money do I need in total", "corpus"],
  ["how will I pay myself every month once I quit", "withdraw"],
  ["what happens if I put 20k extra every month", "what_if"],
  ["what do I need to do to quit at 45", "solve_for"],
  ["give me the big picture", "summary"],
  ["what does corpus mean", "term"],
  ["which mutual fund is best", "out_of_scope"],
  ["what can you do", "help"],
];

export function classifyMessages(question) {
  return [
    { role: "system", content: `Classify the question about a FIRE plan into exactly one label. Reply with the label only.\nLabels:\n${LABELS.map((l) => `${l}: ${INTENTS[l]}`).join("\n")}` },
    ...EXAMPLES.flatMap(([q, l]) => [{ role: "user", content: q }, { role: "assistant", content: l }]),
    { role: "user", content: question },
  ];
}

/** The label in a model reply, or null if it named none. */
export function parseLabel(reply) {
  const t = String(reply).toLowerCase();
  let best = null, at = Infinity;
  for (const l of LABELS) {
    const i = t.indexOf(l);
    if (i >= 0 && i < at) { best = l; at = i; }
  }
  return best;
}
