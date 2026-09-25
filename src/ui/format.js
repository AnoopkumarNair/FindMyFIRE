// Indian number formatting: ₹1,23,456 · ₹4.5 L · ₹2.35 Cr
const full = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function inr(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n < 0 ? "−₹" : "₹") + full.format(Math.abs(Math.round(n)));
}

export function inrShort(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n), sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7, a >= 1e9 ? 0 : 2)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5, 1)} L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3, 1)}k`;
  return `${sign}₹${Math.round(a)}`;
}

const trim = (x, d) => x.toFixed(d).replace(/\.0+$|(\.\d*?)0+$/, "$1");

export function words(n) {
  if (!n) return "";
  const a = Math.abs(n);
  if (a >= 1e7) return `${trim(a / 1e7, 2)} crore`;
  if (a >= 1e5) return `${trim(a / 1e5, 2)} lakh`;
  if (a >= 1e3) return `${trim(a / 1e3, 1)} thousand`;
  return "";
}

export const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${trim(x * 100, d)}%`);

export const age1 = (a) => (a == null ? "—" : trim(a, 1));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Calendar month when the user reaches `age`, given "YYYY-MM" birth month. */
export function monthAtAge(birthYearMonth, age) {
  const [y, m] = birthYearMonth.split("-").map(Number);
  const total = (m - 1) + Math.round(age * 12);
  return `${MONTHS[((total % 12) + 12) % 12]} ${y + Math.floor(total / 12)}`;
}
