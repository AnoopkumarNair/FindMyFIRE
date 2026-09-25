// Reference inflation data published alongside the app (see scripts/fetch-market-data.mjs).
import { h } from "./dom.js";
import { pct } from "./format.js";

/** One line comparing the inflation assumption with the latest published data, if loaded. */
export function marketNote(m, used) {
  const a = m?.inflation?.actual, f = m?.inflation?.forecast;
  if (!a && !f) return null;
  const parts = [];
  if (a?.avg10y != null) parts.push(`India CPI averaged ${pct(a.avg10y, 2)} a year over ${a.avg10yFrom}–${a.lastYear} (World Bank)`);
  if (f?.avg != null) parts.push(`the IMF projects ${pct(f.avg, 2)} a year for ${f.from}–${f.to}`);
  const ref = f?.avg ?? a?.avg10y;
  const gap = used != null && ref != null ? used - ref : null;
  return h("p", { class: "small market" }, "Latest data: ", parts.join("; "), ". ",
    gap == null ? "" : gap >= 0.01 ? "Your assumption is more cautious, which is sensible for a 40-year plan."
      : gap <= -0.005 ? "Your assumption is below this; consider raising it." : "Your assumption is close to this.",
    h("span", { class: "muted" }, ` Updated ${m.generatedAt.slice(0, 10)}.`));
}
