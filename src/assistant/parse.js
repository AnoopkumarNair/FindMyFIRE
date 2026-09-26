// Reads amounts, ages and percentages out of plain English (and Indian number words).
// Used both to understand questions and to check that an answer only repeats known numbers.

const UNIT = { k: 1e3, thousand: 1e3, l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };
const num = (s) => Number(String(s).replace(/,/g, ""));

// A money amount: ₹/Rs prefix and/or a unit suffix (10k, 1.5 lakh, ₹2 Cr, ₹45,000).
const MONEY = /(?:(₹|rs\.?|inr)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr)?\b/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)/gi;

/**
 * Every number in a piece of text, classified.
 * money: rupees · percent: e.g. 8.5 · plain: anything else (ages, years, counts).
 */
export function numbersIn(text) {
  const out = [];
  const taken = [];
  const s = String(text).replace(/−/g, "-");
  for (const m of s.matchAll(PERCENT)) {
    out.push({ kind: "percent", value: num(m[1]), raw: m[0] });
    taken.push([m.index, m.index + m[0].length]);
  }
  for (const m of s.matchAll(MONEY)) {
    const start = m.index, end = start + m[0].length;
    if (taken.some(([a, b]) => start < b && end > a)) continue;
    const [, cur, digits, unit] = m;
    // A bare number right after a letter (e.g. "Q3", "v2") isn't a quantity.
    if (!cur && start > 0 && /[a-z]/i.test(s[start - 1])) continue;
    const value = num(digits) * (unit ? UNIT[unit.toLowerCase()] : 1);
    if (cur || unit) out.push({ kind: "money", value, raw: m[0].trim() });
    else out.push({ kind: "plain", value, raw: m[0].trim() });
  }
  return out;
}

/** The first money amount in text, in rupees, or null. A bare number counts if it's large. */
export function amountIn(text) {
  const all = numbersIn(text);
  const money = all.find((n) => n.kind === "money");
  if (money) return money.value;
  const big = all.find((n) => n.kind === "plain" && n.value >= 500);
  return big ? big.value : null;
}

/** An age mentioned as "at 45", "by 50", "age 48", "when I'm 55", "retire 45". */
export function ageIn(text) {
  const m = String(text).match(/\b(?:at|by|age|aged|turn|turning|i'?m|i am|retire|stop|fire)\s+(?:the\s+)?(?:age\s+(?:of\s+)?)?(\d{2})(?:\.\d)?\b(?!\s*(?:%|k\b|lakh|lac|cr|crore|thousand))/i);
  if (!m) return null;
  const a = Number(m[1]);
  return a >= 18 && a <= 100 ? a : null;
}

/** A percentage in text, as a fraction (8.5% → 0.085), or null. */
export function percentIn(text) {
  const p = numbersIn(text).find((n) => n.kind === "percent");
  return p ? p.value / 100 : null;
}

/** +1 for more/increase, −1 for less/cut, 0 if the text doesn't say. */
export function directionIn(text) {
  const t = String(text).toLowerCase();
  if (/\b(less|reduce|reduced|cut|cutting|lower|decrease|drop|down|stop|pause|fewer|minus|save on)\b/.test(t)) return -1;
  if (/\b(more|increase|increased|raise|add|adding|extra|additional|higher|up|top up|boost|plus|another)\b/.test(t)) return 1;
  return 0;
}
