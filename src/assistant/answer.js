// One question in, one checked answer out.
//
//   question ─▶ router (rules) ──sure?──▶ tool (plan engine) ─▶ facts
//                  │ not sure                                      │
//                  ▼                                               ▼
//            model picks a label                     model rewords facts (optional)
//                                                                   │
//                                              every sentence checked ─▶ shown
//
// `llm` is optional: { generate(messages, { maxTokens, onToken, signal }) → Promise<string> }.
// Without it, the facts are the answer. With it, any sentence that fails the check stops the
// reply and the facts are shown instead, so a wrong number never reaches the screen.

import { route } from "./router.js";
import { runTool } from "./facts.js";
import { explainMessages, classifyMessages, parseLabel } from "./prompt.js";
import { checkSentence, allowedNumbers, splitSentences } from "./guard.js";

export const SURE = 0.45;

export async function understand(question, ctx, llm) {
  const r = route(question, { goals: ctx.user?.goals || [], age: ctx.result?.inputs?.age });
  if (r.confidence >= SURE || !llm) return { ...r, by: "rules" };
  try {
    const reply = await llm.generate(classifyMessages(question), { maxTokens: 8 });
    const label = parseLabel(reply);
    if (label) return { ...r, intent: label, by: "model" };
  } catch { /* fall through to the rules' guess */ }
  return { ...r, by: "rules" };
}

/**
 * Answers a question. `onUpdate({ sentences, streaming })` fires as checked sentences arrive.
 * Result: { intent, title, facts, card, followUps, text: [sentences] | null, mode, problem }
 *   mode "facts": facts shown as the answer (no model, or the model's reply failed a check)
 *   mode "model": the model's checked sentences are the answer; facts sit under it as the source
 */
export async function answer(question, ctx, { llm = null, onUpdate = () => {}, onFacts = () => {}, signal } = {}) {
  const u = await understand(question, ctx, llm);
  const tool = runTool(u.intent || "help", u.slots, ctx);
  const base = { ...tool, question, by: u.by, confidence: u.confidence };
  if (!llm || tool.ask || !tool.facts?.length) return { ...base, text: null, mode: "facts" };
  onFacts(base); // the numbers can be shown at once; the wording follows

  const allowed = allowedNumbers(tool.facts, question);
  const r = ctx.result;
  const claims = { age: r?.inputs?.age, onTrack: r ? r.target.gap >= 0 : undefined, chance: r?.chance?.atTarget, ...tool.claims };
  const shown = [];
  let problem = null, buffer = "";
  const ctrl = new AbortController();
  signal?.addEventListener("abort", () => ctrl.abort());
  const take = (final) => {
    const { sentences, rest } = splitSentences(buffer);
    const list = final && rest.trim() ? [...sentences, rest.trim()] : sentences;
    buffer = final ? "" : rest;
    for (const s of list) {
      if (problem) return;
      const why = checkSentence(s, allowed, claims);
      if (why) { problem = { sentence: s, why }; ctrl.abort(); return; }
      shown.push(s);
      onUpdate({ sentences: [...shown], streaming: !final });
    }
  };
  try {
    await llm.generate(explainMessages(question, tool.facts), {
      maxTokens: 140, signal: ctrl.signal,
      onToken: (piece) => { if (!problem) { buffer += piece; take(false); } },
    });
    if (!problem) take(true);
  } catch (e) {
    if (!problem) problem = { why: signal?.aborted ? "stopped" : `model error: ${e?.message || e}` };
  }
  if (problem || !shown.length) return { ...base, text: null, mode: "facts", problem: problem || { why: "empty reply" } };
  return { ...base, text: shown, mode: "model" };
}
