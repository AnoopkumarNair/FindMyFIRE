// Turns a question into one of a fixed set of intents, plus the numbers it mentions.
// This runs without any model. The model is asked only when this isn't sure, and even then it
// can only pick a label from INTENTS: it never produces numbers or changes to the plan.

import { amountIn, ageIn, percentIn, directionIn } from "./parse.js";
import { termIn } from "./glossary.js";

export const INTENTS = {
  why_age: "why the FIRE age is what it is, or what is driving it",
  chance: "how likely the plan is to work, market risk, the simulation",
  corpus: "how much money is needed and what it pays for",
  withdraw: "how money comes out after FIRE: SWP, buckets, monthly withdrawals, tax after FIRE",
  what_if: "what happens if something changes: invest more or less, spend more or less, skip a goal, returns or inflation change, money received",
  solve_for: "what it would take to stop working at a particular age",
  summary: "an overview: am I on track, how am I doing",
  term: "what a word or idea means (FIRE, corpus, SWP, inflation, step-up…)",
  out_of_scope: "which fund, stock or product to buy, or things outside this plan",
  help: "what the assistant can do",
};
export const LABELS = Object.keys(INTENTS);

const has = (t, re) => re.test(t);

/** Goals in the plan that the text names ("skip the car", "without the wedding"). */
export function goalsNamed(text, goals = []) {
  const t = text.toLowerCase();
  const words = (s) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return goals.filter((g) => words(g.label || "").some((w) => new RegExp(`\\b${w}`, "i").test(t)));
}
const STOP = new Set(["the", "and", "for", "child", "children", "kid", "kids", "new", "my", "our", "with", "every", "years"]);

/** Plan changes a what-if question asks for, from the text alone. */
export function changesIn(text, { goals = [], age = null } = {}) {
  const t = text.toLowerCase();
  const ch = {};
  const amount = amountIn(t);
  const dir = directionIn(t);
  const aboutInvesting = has(t, /\b(sip|sips|invest|investing|investment|save|saving|savings|put in|contribut)/);
  const aboutSpending = has(t, /\b(spend|spending|expense|expenses|cost of living|lifestyle|household|live on)\b/);
  const aboutInflation = has(t, /\binflation\b/);
  const aboutReturns = has(t, /\b(return|returns|market|markets|growth|cagr)\b/);
  const aboutLump = has(t, /\b(inherit|inheritance|bonus|windfall|lump ?sum|gift|receive|get|sell|sale|payout|gratuity|esop|rsu)/);

  if (aboutInflation) {
    const p = percentIn(t);
    if (p != null) ch.inflationTo = p;
    else if (dir) ch.inflationDelta = dir * 0.01;
  } else if (aboutReturns && !aboutInvesting) {
    const p = percentIn(t);
    if (p != null) ch.returnTo = p;
    else if (dir) ch.returnDelta = dir * 0.01;
  }
  if (aboutInvesting && amount != null && !aboutLump) {
    if (/\b(total|in all|altogether|to)\b/.test(t) && !dir) ch.sipTotal = amount;
    else ch.sipDelta = (dir || 1) * amount;
  } else if (aboutInvesting && /\b(stop|pause|no more)\b/.test(t)) ch.sipTotal = 0;
  if (aboutSpending && amount != null && !aboutInvesting) ch.expenseDelta = (dir || 1) * amount;
  const named = goalsNamed(t, goals);
  if (named.length && has(t, /\b(skip|drop|remove|cancel|without|no|forget|don'?t|dont|not|avoid)\b/)) ch.dropGoalIds = named.map((g) => g.id);
  if (aboutLump && amount != null && !aboutSpending && ch.sipDelta == null && ch.sipTotal == null) {
    const at = ageIn(t);
    ch.lumpSum = { amount, atAge: at ?? (age != null ? Math.ceil(age) + 1 : null) };
  }
  if (!Object.keys(ch).length) {
    const a = ageIn(t);
    if (a != null && has(t, /\b(retire|stop|fire|quit)\b/)) ch.fireAge = a;
  }
  return ch;
}

/**
 * Best guess at what the question is about, with a confidence 0–1.
 * slots: { changes, age, term }.
 */
export function route(text, ctx = {}) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return { intent: "help", confidence: 1, slots: {} };
  const age = ageIn(t);
  const term = termIn(t);
  const changes = changesIn(t, ctx);
  const nChanges = Object.keys(changes).length;
  const scores = Object.fromEntries(LABELS.map((l) => [l, 0]));
  const add = (label, x) => { scores[label] += x; };

  if (has(t, /\b(which|what|best|good|recommend|suggest)\b.*\b(fund|funds|stock|stocks|share|shares|etf|scheme|policy|crypto|bitcoin|gold bond|nfo|smallcase|portfolio)\b/) ||
      has(t, /\b(should i|shall i)\b.*\b(buy|sell|switch)\b/) || has(t, /\b(crypto|bitcoin|stock tips?|intraday|f&o|options trading)\b/) ||
      has(t, /\b(file|filing)\b.*\b(itr|return|returns|tax)\b|\bitr\b/) ||
      has(t, /\b(which|what|best|good)\b.*\b(term plan|insurance plan|ulip|annuity plan|bank|broker|app)\b/) ||
      has(t, /\b(hdfc|sbi|icici|axis|kotak|nippon|parag parikh|ppfas|mirae|quant|tata|uti|zerodha|groww|flexi ?cap|small ?cap|mid ?cap|large ?cap)\b.*\b(good|better|best|buy|worth|safe)\b|\b(good|better|best|buy|worth)\b.*\b(hdfc|sbi|icici|axis|kotak|nippon|flexi ?cap|small ?cap|mid ?cap)\b/)) add("out_of_scope", 3);
  if (has(t, /^(hi|hello|hey|yo|hii+|help|what can you do|how do (i|you) use|what do you do)\b|\bpoint of this (tool|app|site)\b|\bwhat (is|does) this (tool|app|site)\b/)) add("help", 2.5);

  if (has(t, /\bwhat if\b|\bwhat happens if\b|\bif i\b|\bsuppose\b|\bimagine\b|\binstead\b/)) add("what_if", 1.5);
  if (nChanges && !changes.fireAge) add("what_if", 1.5);

  if (age != null && has(t, /\b(retire|stop|fire|quit|financially free)\b/)) {
    if (has(t, /\b(what|how)\b.*\b(take|need|do|change|required|would it)\b|\bcan i\b|\bpossible\b|\bis it\b|\bto retire at\b|\bto stop at\b|\bwant to\b/)) add("solve_for", 2.5);
    else add("solve_for", 1.5);
  }
  if (age != null && has(t, /\b(doable|realistic|possible|feasible|achievable|enough)\b/)) add("solve_for", 2);
  if (has(t, /^\s*(is|can i do|what about)\s+\d{2}\b/)) add("solve_for", 2);

  if (has(t, /\bwhy\b/)) add("why_age", 1.2);
  if (has(t, /\b(fire age|earliest|when can i|how soon|what age|this age|my age|so late|so early|later than|pushes? .*back|pushing|driving|drives|holding me back|what'?s? delaying|delay|my date|that date|not earlier|why not sooner)\b/)) add("why_age", 1.5);
  if (has(t, /\b(chance|chances|likely|likelihood|probability|risk|risky|safe|safer|sure|monte carlo|simulat|crash|bad market|9 in 10|3 in 4|odds|confident|lasts?|run out|running out|runs out|worry|worried|wreck|collapse|go broke|outlive)\b/)) add("chance", 1.6);
  if (has(t, /\b(corpus|how much (do i|will i|money)|need to have|target amount|pays? for|made up of|breakdown|break down|number i need|big number|so huge|so big|so high|so much money|all that money|where does (all )?(that|the) money go)\b/)) add("corpus", 1.6);
  if (has(t, /\b(swp|withdraw|withdrawal|withdrawals|bucket|buckets|draw ?down|monthly income after|after (i )?retire|pension|take out|tax after|pay myself|salary stops|cash ?flow|income in retirement|live off|paycheck)\b/)) add("withdraw", 1.6);
  if (has(t, /\b(on track|how am i doing|summary|summarise|summarize|overview|big picture|am i ok|am i okay|am i (doing )?(alright|fine|good)|status|gist|tl;?dr|explain my (plan|result))\b/)) add("summary", 2);
  if (term && has(t, /\b(what is|what's|whats|what are|meaning|mean|means|define|explain|how does|how do)\b/) && !has(t, /\bmy\b/)) add("term", 2.2);
  else if (term) add("term", 0.6);

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, s1] = ranked[0], s2 = ranked[1][1];
  const confidence = s1 <= 0 ? 0 : Math.min(1, (s1 - s2 * 0.5) / 2.5);
  return { intent: s1 > 0 ? best : null, confidence, slots: { changes, age, term } };
}
