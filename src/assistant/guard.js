// The answer checker. A model's sentence is shown only if every number in it is one the plan
// engine produced (or the user typed), and it makes no promise or product call.

import { numbersIn } from "./parse.js";

// Promises, product picks and trading talk the app never makes.
const BANNED = [
  /\bguarantee(d|s)?\b/i, /\brisk[- ]free\b/i, /\bassured returns?\b/i, /\bsure[- ]shot\b/i, /\bcan'?t lose\b/i,
  /\b(you should|i recommend|i suggest|consider) (buy|sell|invest in|switch to|put money in)\b/i,
  /\b(buy|sell)\b.{0,20}\b(fund|stock|shares?|etf|bitcoin|crypto|gold|policy)\b/i,
  /\b(bitcoin|crypto|intraday|f&o|options trading|penny stock)/i,
  /https?:\/\/|www\./i, /<[a-z/!]/i,
];

/** Numbers a reply may use: the facts', the question's, and small counting words. */
export function allowedNumbers(facts, question = "") {
  return [...facts.flatMap((f) => numbersIn(f)), ...numbersIn(question)];
}

function close(n, a) {
  const v = n.value, x = a.value;
  if (n.kind === "percent" || a.kind === "percent") {
    // "8.5%" may be written "8.5 percent"; a percent can also match a plain number in the facts ("9 in 10").
    return Math.abs(v - x) <= 0.051 && (n.kind === a.kind || n.kind === "percent");
  }
  if (n.kind === "money" || x >= 1000) {
    // ₹1.23 Cr may be rounded to ₹1.2 crore; never more than 3% off.
    return x !== 0 ? Math.abs(v - x) / Math.abs(x) <= 0.03 : v === 0;
  }
  // Ages and years: 56.9 may be written "about 57".
  return Math.abs(v - x) <= 0.51;
}

/** Why a sentence can't be shown, or null if it's fine. */
export function checkSentence(sentence, allowed) {
  for (const re of BANNED) if (re.test(sentence)) return `banned: ${re}`;
  for (const n of numbersIn(sentence)) {
    if (n.kind === "plain" && Number.isInteger(n.value) && n.value <= 12) continue; // "3 buckets", "1 in 4"
    if (!allowed.some((a) => close(n, a))) return `unknown number: ${n.raw}`;
  }
  return null;
}

/** Splits streaming text into finished sentences plus the unfinished rest. */
export function splitSentences(text) {
  const out = [];
  let rest = text;
  const re = /^([\s\S]*?[.!?])(\s+|$)(?=\S|$)/;
  for (;;) {
    const m = rest.match(re);
    // Don't split inside numbers like "₹1.2 Cr" or "8.5%": a sentence end is punctuation then space.
    if (!m || (m[2] === "" && rest.length === m[1].length && !/[.!?]\s*$/.test(rest))) break;
    if (m[2] === "") break;
    out.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  return { sentences: out, rest };
}

/** Checks a whole reply. Returns the sentences that pass and, if any failed, why. */
export function checkReply(text, facts, question = "") {
  const allowed = allowedNumbers(facts, question);
  const { sentences, rest } = splitSentences(text.trim() + " ");
  const all = rest.trim() ? [...sentences, rest.trim()] : sentences;
  const ok = [], problems = [];
  for (const s of all) {
    const why = checkSentence(s, allowed);
    if (why) problems.push({ sentence: s, why }); else ok.push(s);
  }
  return { ok, problems, passed: problems.length === 0 && ok.length > 0 };
}
