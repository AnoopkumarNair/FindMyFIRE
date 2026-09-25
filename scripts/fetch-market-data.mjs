// Fetches public India inflation data and writes a small JSON file the app reads from its own
// origin. Runs at deploy time (GitHub Actions) and weekly on a schedule. The browser never
// calls these APIs itself, so the page's "connect only to self" policy stays intact.
//
// Usage: node scripts/fetch-market-data.mjs [out.json]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SOURCES = {
  worldBank: {
    name: "World Bank, consumer price inflation (FP.CPI.TOTL.ZG)",
    url: "https://api.worldbank.org/v2/country/IND/indicator/FP.CPI.TOTL.ZG?format=json&per_page=80",
    page: "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG?locations=IN",
  },
  imf: {
    name: "IMF World Economic Outlook, inflation (PCPIPCH)",
    url: "https://www.imf.org/external/datamapper/api/v1/PCPIPCH/IND",
    page: "https://www.imf.org/external/datamapper/PCPIPCH@WEO/IND",
  },
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);

/** Pure: turn raw API responses into the file the app reads. Percent values become fractions. */
export function summarise({ worldBank, imf }, now = new Date()) {
  const year = now.getUTCFullYear();
  const out = { generatedAt: now.toISOString(), country: "IN", inflation: {} };

  if (Array.isArray(worldBank?.[1])) {
    const values = {};
    for (const row of worldBank[1]) if (row?.value != null) values[row.date] = round4(row.value / 100);
    const years = Object.keys(values).map(Number).sort((a, b) => a - b);
    const last10 = years.slice(-10);
    out.inflation.actual = {
      source: SOURCES.worldBank.name, link: SOURCES.worldBank.page, values,
      lastYear: years.at(-1) ?? null,
      avg10y: round4(mean(last10.map((y) => values[y]))),
      avg10yFrom: last10[0] ?? null,
    };
  }

  const series = imf?.values?.PCPIPCH?.IND;
  if (series) {
    const values = {};
    for (const [y, v] of Object.entries(series)) if (v != null) values[y] = round4(v / 100);
    // WEO rows from the current year on are IMF projections.
    const ahead = Object.keys(values).map(Number).filter((y) => y >= year).sort((a, b) => a - b).slice(0, 6);
    out.inflation.forecast = {
      source: SOURCES.imf.name, link: SOURCES.imf.page,
      values: Object.fromEntries(ahead.map((y) => [y, values[y]])),
      from: ahead[0] ?? null, to: ahead.at(-1) ?? null,
      avg: round4(mean(ahead.map((y) => values[y]))),
    };
  }
  return out;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "FindMyFIRE data refresh" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outFile = process.argv[2] || "market/india.json";
  const raw = {};
  for (const [key, src] of Object.entries(SOURCES)) {
    try { raw[key] = await getJson(src.url); console.log(`✓ ${src.name}`); }
    catch (e) { console.warn(`✗ ${src.name}: ${e.message}`); }
  }
  const data = summarise(raw);
  if (!data.inflation.actual && !data.inflation.forecast) {
    console.error("No source responded; keeping the previous file.");
    process.exit(1);
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(data, null, 1) + "\n");
  const a = data.inflation.actual, f = data.inflation.forecast;
  if (a) console.log(`CPI ${a.avg10yFrom}–${a.lastYear} average: ${(a.avg10y * 100).toFixed(2)}%`);
  if (f) console.log(`IMF forecast ${f.from}–${f.to} average: ${(f.avg * 100).toFixed(2)}%`);
  console.log(`wrote ${outFile}`);
}
