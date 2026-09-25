// Confidence score from the source of each answer (see `confidence` in the rules pack).
// Score = Σ(section weight × mean answer score) ÷ Σ(weights of visible sections) × 100.

import { evaluate, getPointer } from "./conditions.js";

const has = (v) => v !== undefined && v !== null && v !== "";

export function confidence(user, pack, derived = {}) {
  const { sourceScores: S, bands } = pack.confidence;
  const prov = user.provenance || {};
  const done = new Set(user.sectionsDone || []);
  const quickBinds = new Set(pack.questionFlow.quick.questions.map((q) => q.bind));
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const sections = [];
  for (const s of pack.questionFlow.refine) {
    if (!s.weight || !evaluate(s.showIf, user, derived)) continue;
    const isDone = done.has(s.id);
    const scores = [];
    if (!isDone && s.replacesQuick?.length) {
      // Quick answers stand in for this section, and count at most as an estimate.
      for (const ptr of s.replacesQuick) {
        if (!quickBinds.has(ptr)) continue;
        const v = getPointer(user, ptr);
        scores.push(has(v) ? Math.min(S[prov[ptr] || "estimate"], S.estimate) : S.missing);
      }
    } else {
      for (const q of s.questions) {
        if (!evaluate(q.showIf, user, derived)) continue;
        const v = getPointer(user, q.bind);
        if (q.input.startsWith("list.")) {
          const items = Array.isArray(v) ? v : [];
          if (items.length) scores.push(mean(items.map((i) => S[i.source] ?? S.estimate)));
          else scores.push(isDone ? S.exact : S.missing);
        } else if (q.bind === "/assumptionOverrides") {
          scores.push(isDone ? S.exact : S.default);
        } else if (has(v)) {
          scores.push(S[prov[q.bind] || (isDone ? "exact" : "estimate")]);
        } else {
          scores.push(q.defaultFrom ? S.default : S.missing);
        }
      }
    }
    sections.push({ id: s.id, title: s.title, weight: s.weight, done: isDone, score: mean(scores) });
  }
  const totalW = sections.reduce((a, s) => a + s.weight, 0) || 1;
  const score = Math.round((100 * sections.reduce((a, s) => a + s.weight * s.score, 0)) / totalW);
  const band = [...bands].reverse().find((b) => score >= b.min) || bands[0];
  // Points each section could still add if completed with exact answers.
  for (const s of sections) s.potential = Math.round((100 * s.weight * (1 - s.score)) / totalW);
  return { score, band, sections };
}

/** Uncertainty band (e.g. ±15%) for an amount, from the sources behind it. */
export function bandFor(sources, pack) {
  const B = pack.confidence.uncertaintyBand;
  let w = 0, sum = 0;
  for (const { source, weight } of sources) {
    w += weight;
    sum += weight * (B[source] ?? B.estimate);
  }
  return w ? sum / w : B.estimate;
}
