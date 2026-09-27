// Runs the representative households and compares (or, with --update, records) their key
// outputs. Use it before publishing a new rules pack or an engine change:
//   node scripts/regression.mjs                 compare against test/fixtures/regression.json
//   node scripts/regression.mjs --update        record the current outputs (review the diff!)
//   node scripts/regression.mjs --rules <file>  compare using another rules pack
import { readFileSync, writeFileSync } from "node:fs";
import { households, keyOutputs, packFor } from "../test/regression/households.mjs";

const args = process.argv.slice(2);
const rulesFile = args.includes("--rules") ? args[args.indexOf("--rules") + 1] : undefined;
const pack = packFor(rulesFile);
const file = new URL("../test/fixtures/regression.json", import.meta.url);
const now = Object.fromEntries(households().map(({ name, user }) => [name, keyOutputs(user, pack)]));

if (args.includes("--update")) {
  writeFileSync(file, JSON.stringify({ rulesPack: `${pack.packId}@${pack.packVersion}`, households: now }, null, 2) + "\n");
  console.log(`Recorded ${Object.keys(now).length} households.`);
} else {
  const before = JSON.parse(readFileSync(file)).households;
  let changed = 0;
  for (const [name, out] of Object.entries(now)) for (const [k, v] of Object.entries(out)) {
    const b = before[name]?.[k];
    if (b !== v) { changed++; console.log(`${name.padEnd(26)} ${k.padEnd(24)} ${String(b).padStart(9)} → ${v}`); }
  }
  console.log(changed ? `${changed} value(s) changed.` : "No changes.");
}
