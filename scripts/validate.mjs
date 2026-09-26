// Validates the rules pack and every example user file.
// 1. JSON Schema (structure)  2. Referential integrity (things a schema can't express)
// Usage: npm test
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const rulesSchema = load("schemas/rules-pack.schema.json");
const userSchema = load("schemas/user-file.schema.json");
const validateRules = ajv.compile(rulesSchema);
const validateUser = ajv.compile(userSchema);

let failures = 0;
const fail = (file, msg) => { failures++; console.error(`  ✗ ${file}: ${msg}`); };
const ok = (file, msg) => console.log(`  ✓ ${file}: ${msg}`);
const dupes = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);
const near1 = (n) => Math.abs(n - 1) < 1e-9;

// ---- does a JSON Pointer exist in the user-file schema? ----
function pointerInSchema(pointer) {
  let node = userSchema;
  for (const seg of pointer.split("/").slice(1)) {
    if (node.$ref) node = userSchema.$defs[node.$ref.split("/").pop()];
    if (node.type === "array" && node.items) node = node.items;
    if (!node.properties || !(seg in node.properties)) return false;
    node = node.properties[seg];
  }
  return true;
}

// ================= RULES PACKS =================
const rulesFiles = readdirSync(join(root, "rules")).filter((f) => f.endsWith(".json"));
const packs = {};
console.log("Rules packs");
for (const f of rulesFiles) {
  const file = `rules/${f}`;
  const r = load(file);
  if (!validateRules(r)) {
    validateRules.errors.forEach((e) => fail(file, `${e.instancePath} ${e.message}`));
    continue;
  }
  ok(file, "schema");

  const ids = {
    assumption: r.assumptions.map((a) => a.id),
    assetClass: r.assetClasses.map((a) => a.id),
    tax: r.taxTreatments.map((t) => t.id),
    instrument: r.instruments.map((i) => i.id),
    category: r.expenseCatalog.map((c) => c.id),
    goal: r.goalTemplates.map((g) => g.id),
    inflow: (r.inflowTemplates || []).map((t) => t.id),
    derived: r.derived.map((d) => d.name),
    section: r.questionFlow.refine.map((s) => s.id),
  };
  // A group asks several questions on one screen; its fields are questions too.
  const withFields = (qs) => qs.flatMap((q) => (q.fields ? [q, ...q.fields] : [q]));
  const questions = [r.questionFlow.quick, ...r.questionFlow.refine].flatMap((s) => withFields(s.questions));
  ids.question = questions.map((q) => q.id);
  for (const [k, list] of Object.entries(ids))
    dupes(list).forEach((d) => fail(file, `duplicate ${k} id '${d}'`));

  for (const i of r.instruments) {
    if (!ids.assetClass.includes(i.assetClass)) fail(file, `instrument ${i.id}: unknown assetClass ${i.assetClass}`);
    if (!ids.tax.includes(i.taxTreatment)) fail(file, `instrument ${i.id}: unknown taxTreatment ${i.taxTreatment}`);
  }
  for (const key of ["targetBeforeFire", "targetAfterFire"]) {
    const sum = r.assetClasses.reduce((s, a) => s + a[key], 0);
    if (!near1(sum)) fail(file, `assetClasses ${key} sums to ${sum}, not 1`);
  }
  for (const a of r.assumptions)
    if (a.value < a.min || a.value > a.max) fail(file, `assumption ${a.id}: value outside [min,max]`);

  const checkRef = (where, ref) => {
    if (ref.startsWith("$")) { if (!ids.derived.includes(ref.slice(1))) fail(file, `${where}: unknown derived ${ref}`); }
    else if (!pointerInSchema(ref)) fail(file, `${where}: '${ref}' not in user-file schema`);
  };
  const walkCond = (where, c) => {
    if (!c) return;
    if (c.all) return c.all.forEach((x) => walkCond(where, x));
    if (c.any) return c.any.forEach((x) => walkCond(where, x));
    if (c.not) return walkCond(where, c.not);
    checkRef(where, c.ref);
    if (c.op === "hasInstrument" && !ids.instrument.includes(c.value)) fail(file, `${where}: unknown instrument ${c.value}`);
    if (c.op === "hasCategory" && !ids.category.includes(c.value)) fail(file, `${where}: unknown category ${c.value}`);
  };
  for (const s of [r.questionFlow.quick, ...r.questionFlow.refine]) {
    walkCond(`section ${s.id}`, s.showIf);
    (s.replacesQuick || []).forEach((p) => checkRef(`section ${s.id}.replacesQuick`, p));
    for (const q of withFields(s.questions)) {
      if (q.input === "group") { walkCond(`question ${q.id}.showIf`, q.showIf); continue; }
      checkRef(`question ${q.id}.bind`, q.bind);
      walkCond(`question ${q.id}.showIf`, q.showIf);
      if (q.defaultFrom && !ids.assumption.includes(q.defaultFrom)) fail(file, `question ${q.id}: unknown defaultFrom ${q.defaultFrom}`);
      if (["select", "multiselect"].includes(q.input) && !q.options?.length) fail(file, `question ${q.id}: needs options`);
    }
  }
  r.resolution.forEach((x) => checkRef(`resolution ${x.quantity}.quick`, x.quick));
  r.expenseCatalog.forEach((c) => walkCond(`category ${c.id}`, c.showIf));
  r.goalTemplates.forEach((g) => walkCond(`goal ${g.id}`, g.showIf));
  r.nudges.forEach((n) => {
    walkCond(`nudge ${n.id}`, n.when);
    if (n.section && !ids.section.includes(n.section)) fail(file, `nudge ${n.id}: unknown section ${n.section}`);
  });
  if (r.confidence.bands.some((b, i, a) => i && b.min <= a[i - 1].min)) fail(file, "confidence bands not ascending");
  ok(file, "integrity");
  packs[`${r.packId}@${r.packVersion}`] = { ...r, ids };
}

// ================= USER FILES =================
console.log("User files");
for (const f of readdirSync(join(root, "examples")).filter((x) => x.endsWith(".json"))) {
  const file = `examples/${f}`;
  const u = load(file);
  if (!validateUser(u)) {
    validateUser.errors.forEach((e) => fail(file, `${e.instancePath} ${e.message}`));
    continue;
  }
  ok(file, "schema");
  const pack = packs[`${u.app.rulesPack}@${u.app.rulesPackVersion}`];
  if (!pack) { fail(file, `no valid rules pack ${u.app.rulesPack}@${u.app.rulesPackVersion}`); continue; }
  const { ids } = pack;
  const n0 = failures;

  for (const k of ["incomes", "expenses", "liabilities", "holdings", "otherAssets", "goals", "inflows", "properties"])
    dupes((u[k] || []).map((x) => x.id)).forEach((d) => fail(file, `duplicate id '${d}' in ${k}`));
  (u.expenses || []).forEach((e) => ids.category.includes(e.categoryId) || fail(file, `expense ${e.id}: unknown category ${e.categoryId}`));
  (u.holdings || []).forEach((h) => ids.instrument.includes(h.instrumentId) || fail(file, `holding ${h.id}: unknown instrument ${h.instrumentId}`));
  (u.goals || []).forEach((g) => ids.goal.includes(g.templateId) || fail(file, `goal ${g.id}: unknown template ${g.templateId}`));
  (u.inflows || []).forEach((x) => ids.inflow.includes(x.templateId) || fail(file, `inflow ${x.id}: unknown template ${x.templateId}`));
  (u.properties || []).forEach((x) => x.plan === "sell" && !x.sellOn && fail(file, `property ${x.id}: plan is 'sell' but no sellOn date`));
  const childIds = (u.profile.children || []).map((c) => c.id);
  (u.goals || []).forEach((g) => g.childId && !childIds.includes(g.childId) && fail(file, `goal ${g.id}: unknown child ${g.childId}`));
  (u.sectionsDone || []).forEach((s) => ids.section.includes(s) || fail(file, `sectionsDone: unknown section ${s}`));
  Object.keys(u.assumptionOverrides || {}).forEach((k) => ids.assumption.includes(k) || fail(file, `override: unknown assumption ${k}`));
  Object.keys(u.provenance || {}).forEach((p) => pointerInSchema(p) || fail(file, `provenance: '${p}' not in schema`));
  for (const [k, w] of Object.entries(u.allocation || {})) {
    Object.keys(w).forEach((c) => ids.assetClass.includes(c) || fail(file, `allocation.${k}: unknown class ${c}`));
    const sum = Object.values(w).reduce((s, x) => s + x, 0);
    if (!near1(sum)) fail(file, `allocation.${k} sums to ${sum}, not 1`);
  }
  if (u.plan.planUntilAge && u.plan.planUntilAge <= u.plan.fireTargetAge) fail(file, "planUntilAge must exceed fireTargetAge");
  if (failures === n0) ok(file, "integrity");
}

console.log(failures ? `\n${failures} problem(s) found` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
