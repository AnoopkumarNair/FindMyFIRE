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
export const MAX_SENTENCES = 3;

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
  let problem = null, buffer = "", enough = false;
  const ctrl = new AbortController();
  signal?.addEventListener("abort", () => ctrl.abort());
  const take = (final) => {
    const { sentences, rest } = splitSentences(buffer);
    const list = final && rest.trim() ? [...sentences, rest.trim()] : sentences;
    buffer = final ? "" : rest;
    for (const raw of list.flatMap((x) => x.split(/\n+/))) {
      if (problem || enough) return;
      // Plain prose only: no markdown, no "Here is the explanation:" openers.
      const s = raw.replace(/\*\*|__|`/g, "").replace(/^\s*(?:[*\-•]|\d+\.)\s+/, "").trim();
      if (!s || /:$/.test(s)) continue;
      // Reasoning that leaked out (a thinking block whose markers were stripped) is never an answer.
      if (/^(thought|thinking|<\/?think>|let me think|okay,? (so|let's)|first,? i (need|will))\b/i.test(s)) {
        problem = { sentence: s, why: "model wrote its reasoning" }; ctrl.abort(); return;
      }
      const why = checkSentence(s, allowed, claims);
      if (why) { problem = { sentence: s, why }; ctrl.abort(); return; }
      shown.push(s);
      onUpdate({ sentences: [...shown], streaming: !final });
      if (shown.length >= MAX_SENTENCES) { enough = true; ctrl.abort(); return; }
    }
  };
  try {
    await llm.generate(explainMessages(question, tool.facts), {
      maxTokens: 140, signal: ctrl.signal,
      onToken: (piece) => { if (!problem) { buffer += piece; take(false); } },
    });
    if (!problem && !enough) take(true);
  } catch (e) {
    if (!problem && !enough) problem = { why: signal?.aborted ? "stopped" : `model error: ${e?.message || e}` };
  }
  if (problem || !shown.length) return { ...base, text: null, mode: "facts", problem: problem || { why: "empty reply" } };
  return { ...base, text: shown, mode: "model" };
}
