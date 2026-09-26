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
  if (n.kind !== a.kind && !(n.kind === "plain" && a.kind === "money" && n.value >= 1000)) return false;
  const v = n.value, x = a.value;
  if (n.kind === "money" || x >= 1000) {
    // ₹1.23 Cr may be rounded to ₹1.2 crore; never more than 3% off.
    return x !== 0 ? Math.abs(v - x) / Math.abs(x) <= 0.03 : v === 0;
  }
  // A whole number may round a decimal ("about 58" for 57.7); a decimal must match to the decimal.
  return Number.isInteger(v) && !Number.isInteger(x) ? Math.abs(v - x) <= 0.5 : Math.abs(v - x) <= 0.051;
}

/**
 * Claims a reply can't make, given what the plan says. The model can be wrong without using a
 * number ("you're in your 50s", "yes, you're on track"); these catch the ones that matter most.
 * claims: { age, onTrack, chance }
 */
function contradicts(sentence, claims = {}) {
  const t = sentence.toLowerCase();
  const decade = t.match(/\b(?:your|his|her|their) (\d0)s\b/);
  if (decade && claims.age != null && Number(decade[1]) !== Math.floor(claims.age / 10) * 10) return "wrong age";
  const negated = /\b(not|n't|isn't|aren't|off|behind|short)\b/.test(t);
  if (claims.onTrack === false && /\b(on track|ahead of|enough (money|savings)|comfortably)\b/.test(t) && !negated) return "says on track";
  if (claims.onTrack === false && /^(yes|yep|absolutely|definitely)\b/.test(t.trim())) return "says yes to a shortfall";
  if (claims.onTrack === true && /\b(shortfall|not on track|off track|behind)\b/.test(t) && !/\bno shortfall\b/.test(t)) return "says off track";
  if (claims.chance != null && claims.chance < 0.5 &&
      /\b(high|good|strong|excellent|great)\b.{0,20}\b(chance|chances|likelihood|probability|odds)\b|\b(chances?|likelihood|probability|odds)\b.{0,15}\b(high|good|strong)\b/.test(t)) return "says the chance is high";
  return null;
}

/** Why a sentence can't be shown, or null if it's fine. */
export function checkSentence(sentence, allowed, claims) {
  for (const re of BANNED) if (re.test(sentence)) return `banned: ${re}`;
  const c = contradicts(sentence, claims);
  if (c) return `contradicts the plan: ${c}`;
  for (const n of numbersIn(sentence)) {
    // "3 buckets", "1 in 4": tiny counts are fine, but never as a number of years or months.
    const after = sentence.slice(sentence.indexOf(n.raw) + n.raw.length);
    if (n.kind === "plain" && Number.isInteger(n.value) && n.value <= 3 && !/^\s*(years?|yrs?|months?|decades?)\b/i.test(after)) continue;
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
export function checkReply(text, facts, question = "", claims) {
  const allowed = allowedNumbers(facts, question);
  const { sentences, rest } = splitSentences(text.trim() + " ");
  const all = rest.trim() ? [...sentences, rest.trim()] : sentences;
  const ok = [], problems = [];
  for (const s of all) {
    const why = checkSentence(s, allowed, claims);
    if (why) problems.push({ sentence: s, why }); else ok.push(s);
  }
  return { ok, problems, passed: problems.length === 0 && ok.length > 0 };
}
