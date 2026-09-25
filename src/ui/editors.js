// Refine-section editors, driven by the rules pack's catalogues.
import { h } from "./dom.js";
import { field, control } from "./fields.js";
import { inr, inrShort, pct } from "./format.js";
import { marketNote } from "./market.js";
import { evaluate, getPointer, setPointer, resolveInputs } from "../engine/index.js";

const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * ctx: { user, pack, save() — persist + refresh the live result,
 *        redraw() — persist + re-render this section (after adding/removing rows) }
 */
export function sectionEditor(section, ctx) {
  const input = section.questions[0]?.input;
  if (section.id === "expenses") return expensesEditor(ctx);
  if (section.id === "assumptions") return assumptionsEditor(ctx);
  if (input === "list.holdings") return holdingsEditor(ctx);
  if (input === "list.goals") return goalsEditor(ctx);
  if (input === "list.inflows") return inflowsEditor(ctx);
  if (input === "list.incomes") return incomesEditor(ctx);
  if (input === "list.liabilities") return loansEditor(ctx);
  return scalarEditor(section, ctx);
}

// ---------- generic scalar questions (family, protection, retirement) ----------
function scalarEditor(section, ctx) {
  const { user, pack } = ctx;
  const wrap = h("div", { class: "fields" });
  const draw = () => {
    wrap.replaceChildren(...section.questions.filter((q) => evaluate(q.showIf, user)).map((q) => {
      if (q.input === "list.children") return childrenEditor(ctx, draw);
      const set = (v) => {
        setPointer(user, q.bind, v);
        if (v === undefined) delete user.provenance?.[q.bind];
        else (user.provenance ||= {})[q.bind] = "exact";
        ctx.save();
        if (section.questions.some((o) => o.showIf?.ref === q.bind)) draw();
      };
      const def = q.defaultFrom ? pack.assumptions.find((a) => a.id === q.defaultFrom) : null;
      const type = q.input === "integer" ? "integer" : q.input;
      return field(q.prompt, type, getPointer(user, q.bind), set, {
        options: q.options, min: q.min, max: q.max, help: q.help,
        placeholder: def ? (def.unit === "percent" ? String(def.value * 100) : String(def.value)) : undefined,
      });
    }));
  };
  draw();
  return wrap;
}

function childrenEditor(ctx, redrawParent) {
  const { user } = ctx;
  const kids = (user.profile.children ||= []);
  return h("div", { class: "field wide" },
    h("label", {}, "Children"),
    h("div", { class: "rows" }, ...kids.map((c, i) => h("div", { class: "row" },
      field("Name (optional)", "text", c.label, (v) => { c.label = v; ctx.save(); }),
      field("Birth year", "integer", c.birthYear, (v) => { c.birthYear = v; ctx.save(); }, { min: 1950, max: 2100 }),
      field("Financially independent at", "integer", c.independentAtAge, (v) => { c.independentAtAge = v; ctx.save(); },
        { min: 15, max: 35, placeholder: "22", help: "Their age. Child-related expenses stop then." }),
      h("button", { type: "button", class: "link danger", onClick: () => { kids.splice(i, 1); ctx.save(); redrawParent(); } }, "Remove")))),
    h("button", { type: "button", class: "btn small", onClick: () => {
      kids.push({ id: newId("c"), birthYear: new Date().getFullYear() - 5 }); ctx.save(); redrawParent();
    } }, "+ Add child"));
}

// ---------- expenses: one row per catalogue category ----------
function expensesEditor(ctx) {
  const { user, pack } = ctx;
  user.expenses ||= [];
  const total = h("strong", {});
  const quickNote = user.quick?.monthlyExpenses ? h("span", { class: "muted" }, ` · your quick answer was ${inr(user.quick.monthlyExpenses)}`) : null;
  const refreshTotal = () => {
    const m = user.expenses.reduce((s, e) => s + (e.frequency === "annual" ? e.amount / 12 : e.amount), 0);
    total.textContent = `${inr(m)} a month`;
  };
  refreshTotal();
  const save = () => { refreshTotal(); ctx.save(); };

  const groups = [];
  for (const c of pack.expenseCatalog) {
    if (!evaluate(c.showIf, user)) continue;
    let g = groups.find((x) => x.id === c.group);
    if (!g) groups.push((g = { id: c.group, cats: [] }));
    g.cats.push(c);
  }

  const row = (c, item) => {
    const get = () => item || user.expenses.find((e) => e.categoryId === c.id);
    const ensure = () => {
      let e = get();
      if (!e) { e = { id: newId("e"), categoryId: c.id, amount: 0, frequency: c.frequency, source: "estimate" }; user.expenses.push(e); item = e; }
      return e;
    };
    const e = get();
    const post = c.postFireFactor !== 1 ? `After FIRE ×${c.postFireFactor}` : null;
    const endable = c.group === "children" || c.id === "protection.term_premium";
    return h("div", { class: "exp-row" },
      h("div", { class: "exp-label" }, h("span", {}, c.label),
        h("small", { class: "muted" }, [c.essential ? "Essential" : "Lifestyle", c.inflation !== "general" ? `${c.inflation} inflation` : null, post].filter(Boolean).join(" · ")),
        c.hint ? h("small", { class: "help" }, c.hint) : null),
      control("currency", e?.amount || undefined, (v) => {
        if (!v) { user.expenses = user.expenses.filter((x) => x !== get()); item = null; }
        else ensure().amount = v;
        save();
      }, { placeholder: "" }),
      control("select", e?.frequency || c.frequency, (v) => { ensure().frequency = v || c.frequency; save(); },
        { placeholder: false, options: [{ value: "monthly", label: "per month" }, { value: "annual", label: "per year" }] }),
      control("source", e?.source, (v) => { ensure().source = v; save(); }),
      endable ? control("integer", e?.endsAtAge, (v) => { ensure().endsAtAge = v; save(); }, { placeholder: "stops at your age…" }) : h("span", {}));
  };

  return h("div", {},
    h("p", { class: "total" }, "Total: ", total, quickNote),
    h("p", { class: "muted small" }, "Leave a category blank if it doesn't apply."),
    ...groups.map((g) => h("details", { class: "group", open: true },
      h("summary", {}, g.id.replace(/_/g, " ").replace(/^\w/, (s) => s.toUpperCase())),
      ...g.cats.flatMap((c) => {
        const items = user.expenses.filter((e) => e.categoryId === c.id);
        return items.length ? items.map((it) => row(c, it)) : [row(c, null)];
      }))));
}

// ---------- generic list editor ----------
function listEditor(ctx, { items, render, create, addLabel, empty }) {
  return h("div", { class: "rows" },
    items.length ? null : h("p", { class: "muted" }, empty),
    ...items.map((it, i) => h("div", { class: "row card" },
      ...render(it),
      h("button", { type: "button", class: "link danger", onClick: () => { items.splice(i, 1); ctx.redraw(); } }, "Remove"))),
    create);
}

function holdingsEditor(ctx) {
  const { user, pack } = ctx;
  const items = (user.holdings ||= []);
  const insts = Object.fromEntries(pack.instruments.map((i) => [i.id, i]));
  const groups = pack.assetClasses.map((a) => ({ label: a.label,
    options: pack.instruments.filter((i) => i.assetClass === a.id).map((i) => ({ value: i.id, label: i.label })) }));
  const age = resolveInputs(user, pack).age;
  const picker = control("select", "", (v) => {
    if (!v) return;
    items.push({ id: newId("h"), instrumentId: v, value: 0, asOf: todayIso(), source: "exact" });
    ctx.redraw();
  }, { groups, placeholder: "+ Add a holding…" });

  return h("div", {},
    h("p", { class: "muted small" }, `Don't include your own home. Tick "Emergency fund" for money you keep aside for emergencies; it's excluded from the FIRE corpus. You are ${Math.floor(age)} now.`),
    listEditor(ctx, {
      items, create: picker, empty: "No holdings yet. Pick one below.",
      render: (x) => {
        const inst = insts[x.instrumentId] || { fields: ["value"] };
        const has = (f) => inst.fields.includes(f);
        const counts = x.countInFire ?? inst.countInFireByDefault;
        return [
          h("div", { class: "row-head" }, h("strong", {}, inst.label),
            inst.access?.note ? h("small", { class: "help" }, inst.access.note) : null),
          field("Name (optional)", "text", x.label, (v) => { x.label = v; ctx.save(); }),
          field(x.instrumentId === "insurance_traditional" ? "Surrender value today" : "Current value", "currency", x.value, (v) => { x.value = v || 0; ctx.save(); }),
          has("monthlyContribution") ? field(x.instrumentId === "epf" ? "Your monthly contribution" : "Monthly investment", "currency", x.monthlyContribution, (v) => { x.monthlyContribution = v; ctx.save(); }) : null,
          has("employerMonthlyContribution") ? field("Employer's monthly contribution", "currency", x.employerMonthlyContribution, (v) => { x.employerMonthlyContribution = v; ctx.save(); }) : null,
          has("annualContribution") ? field("Yearly investment", "currency", x.annualContribution, (v) => { x.annualContribution = v; ctx.save(); }) : null,
          has("openedOn") ? field("Opened", "month", x.openedOn, (v) => { x.openedOn = v; ctx.save(); }) : null,
          has("maturesOn") ? field("Matures", "month", x.maturesOn, (v) => { x.maturesOn = v; ctx.save(); }) : null,
          field("Value as of", "date", x.asOf, (v) => { x.asOf = v || todayIso(); ctx.save(); }),
          field("Counts toward FIRE", "boolean", !!counts && !x.isEmergencyFund, (v) => { x.countInFire = v; ctx.save(); },
            { help: inst.countInFireByDefault ? null : "Off by default: locked, illiquid or earmarked." }),
          field("Emergency fund", "boolean", !!x.isEmergencyFund, (v) => { x.isEmergencyFund = v || undefined; ctx.save(); }),
          field("How sure?", "source", x.source, (v) => { x.source = v; ctx.save(); }),
        ];
      },
    }));
}

function goalsEditor(ctx) {
  const { user, pack } = ctx;
  const items = (user.goals ||= []);
  const inp = resolveInputs(user, pack);
  const kids = user.profile.children || [];
  const templates = pack.goalTemplates.filter((t) => evaluate(t.showIf, user));
  const picker = control("select", "", (v) => {
    const t = pack.goalTemplates.find((x) => x.id === v);
    if (!t) return;
    const kid = t.suggestAge?.relativeTo === "child" ? kids[0] : null;
    const atAge = kid ? kid.birthYear + t.suggestAge.age - inp.birthYear : Math.ceil(inp.age) + 5;
    items.push({ id: newId("g"), templateId: t.id, label: t.label, atAge, costToday: 0,
      inflationRate: t.defaultInflationRate, priority: "must", childId: kid?.id, source: "estimate" });
    ctx.redraw();
  }, { options: templates.map((t) => ({ value: t.id, label: t.label })), placeholder: "+ Add a goal…" });

  return h("div", {},
    h("p", { class: "muted small" }, "Enter today's cost; it's inflated to the year you need it. Goals before your FIRE age come out of your investments; later ones are added to retirement spending."),
    listEditor(ctx, {
      items, create: picker, empty: "No goals yet.",
      render: (g) => [
        field("Goal", "text", g.label, (v) => { g.label = v || "Goal"; ctx.save(); }),
        field("Your age when it's due", "integer", g.atAge, (v) => { g.atAge = v; ctx.save(); }),
        field("Cost in today's money", "currency", g.costToday, (v) => { g.costToday = v || 0; ctx.save(); }),
        field("Cost inflation", "percent", g.inflationRate, (v) => { g.inflationRate = v; ctx.save(); }),
        field("Priority", "select", g.priority, (v) => { g.priority = v; ctx.save(); }, { placeholder: false,
          options: [{ value: "must", label: "Must have" }, { value: "want", label: "Want" }, { value: "nice", label: "Nice to have" }],
        }),
        kids.length && g.templateId.startsWith("goal.child") ? field("Child", "select", g.childId, (v) => { g.childId = v; ctx.save(); },
          { options: kids.map((k, i) => ({ value: k.id, label: k.label || `Child ${i + 1} (${k.birthYear})` })) }) : null,
        field("How sure?", "source", g.source, (v) => { g.source = v; ctx.save(); }),
      ],
    }));
}

function inflowsEditor(ctx) {
  const { user, pack } = ctx;
  const items = (user.inflows ||= []);
  const templates = pack.inflowTemplates || [];
  const byId = Object.fromEntries(templates.map((t) => [t.id, t]));
  const inp = resolveInputs(user, pack);
  const fireYear = new Date().getFullYear() + Math.round((user.plan.fireTargetAge ?? inp.age) - inp.age);
  const picker = control("select", "", (v) => {
    const t = byId[v];
    if (!t) return;
    items.push({ id: newId("m"), templateId: t.id, label: t.label, amount: 0,
      on: `${t.id === "inflow.gratuity" ? fireYear : new Date().getFullYear() + 1}-04`,
      taxRate: t.defaultTaxRate || undefined, growthRate: t.defaultGrowthRate, source: "estimate" });
    ctx.redraw();
  }, { options: templates.map((t) => ({ value: t.id, label: t.label })), placeholder: "+ Add money coming in…" });

  // What each row adds up to, in the year(s) received, after tax.
  const summary = (x) => {
    const ev = resolveInputs({ ...user, inflows: [x] }, pack).inflows;
    const total = ev.reduce((s, e) => s + e.net, 0);
    return total ? `≈ ${inrShort(total)} after tax${(x.years || 1) > 1 ? ` over ${x.years} years` : ""}` : "Not counted: the date has passed or the amount is 0.";
  };

  return h("div", {},
    h("p", { class: "muted small" }, "Money received before your FIRE age is invested and grows. Money received after it pays part of your spending that year, so you need a smaller corpus. Amounts are what you'll actually receive, unless you set a growth rate (for example, a property's value today growing until you sell)."),
    listEditor(ctx, {
      items, create: picker, empty: "Nothing yet. Gratuity, insurance payouts and property sales go here.",
      render: (x) => {
        const t = byId[x.templateId] || {};
        const note = h("small", { class: "muted" }, summary(x));
        const save = () => { note.textContent = summary(x); ctx.save(); };
        return [
          h("div", { class: "row-head" }, h("strong", {}, t.label || "Money coming in"), t.hint ? h("small", { class: "help" }, t.hint) : null),
          field("Name", "text", x.label, (v) => { x.label = v || t.label || "Inflow"; save(); }),
          field(x.growthRate != null ? "Value today" : "Amount", "currency", x.amount, (v) => { x.amount = v || 0; save(); }),
          field("When (first payment)", "month", x.on, (v) => { if (v) { x.on = v; save(); } }),
          field("Paid yearly for", "integer", x.years, (v) => { x.years = v && v > 1 ? v : undefined; save(); },
            { min: 1, max: 50, placeholder: "1", help: "Years. Use this for payouts like 25% of the sum assured each year." }),
          field("Grows until received", "percent", x.growthRate, (v) => { x.growthRate = v; ctx.redraw(); },
            { help: "Leave blank if the amount is fixed." }),
          field("Tax on it", "percent", x.taxRate, (v) => { x.taxRate = v || undefined; save(); }, { placeholder: "0" }),
          field("How sure?", "source", x.source, (v) => { x.source = v; save(); }),
          h("div", { class: "field wide" }, note),
        ];
      },
    }));
}

function incomesEditor(ctx) {
  const { user } = ctx;
  const items = (user.incomes ||= []);
  const types = [["salary", "Salary"], ["business", "Business / professional"], ["rental", "Rent"], ["interest", "Interest / dividends"], ["pension", "Pension"], ["other", "Other"]];
  return h("div", {},
    h("p", { class: "muted small" }, "Take-home amounts. Mark income that continues after you stop working (rent, pension); it reduces what you draw from the corpus."),
    listEditor(ctx, {
      items, empty: "No income sources yet.",
      create: h("button", { type: "button", class: "btn small", onClick: () => {
        items.push({ id: newId("i"), type: "salary", monthly: 0, source: "exact" }); ctx.redraw(); } }, "+ Add income"),
      render: (x) => [
        field("Type", "select", x.type, (v) => { x.type = v || "other"; ctx.save(); }, { placeholder: false, options: types.map(([value, label]) => ({ value, label })) }),
        field("Name (optional)", "text", x.label, (v) => { x.label = v; ctx.save(); }),
        field("Monthly (take-home)", "currency", x.monthly, (v) => { x.monthly = v || 0; ctx.save(); }),
        field("Grows each year by", "percent", x.annualGrowth, (v) => { x.annualGrowth = v; ctx.save(); }),
        field("Continues after FIRE", "boolean", !!x.continuesAfterFire, (v) => { x.continuesAfterFire = v; ctx.save(); }),
        field("Stops at your age", "integer", x.endsAtAge, (v) => { x.endsAtAge = v; ctx.save(); }),
        field("How sure?", "source", x.source, (v) => { x.source = v; ctx.save(); }),
      ],
    }));
}

function loansEditor(ctx) {
  const { user } = ctx;
  const items = (user.liabilities ||= []);
  const types = [["home", "Home loan"], ["car", "Car loan"], ["personal", "Personal loan"], ["education", "Education loan"], ["gold", "Gold loan"], ["creditCard", "Credit card"], ["other", "Other"]];
  return h("div", {},
    h("p", { class: "muted small" }, "An EMI that runs past your FIRE age is paid from the corpus until the loan ends."),
    listEditor(ctx, {
      items, empty: "No loans. If that's right, mark this section complete.",
      create: h("button", { type: "button", class: "btn small", onClick: () => {
        items.push({ id: newId("l"), type: "home", outstanding: 0, emi: 0, endsOn: `${new Date().getFullYear() + 10}-03`, source: "exact" }); ctx.redraw(); } }, "+ Add loan"),
      render: (x) => [
        field("Type", "select", x.type, (v) => { x.type = v || "other"; ctx.save(); }, { placeholder: false, options: types.map(([value, label]) => ({ value, label })) }),
        field("Name (optional)", "text", x.label, (v) => { x.label = v; ctx.save(); }),
        field("Outstanding", "currency", x.outstanding, (v) => { x.outstanding = v || 0; ctx.save(); }),
        field("Monthly EMI", "currency", x.emi, (v) => { x.emi = v || 0; ctx.save(); }),
        field("Interest rate", "percent", x.interestRate, (v) => { x.interestRate = v; ctx.save(); }),
        field("Last EMI", "month", x.endsOn, (v) => { if (v) { x.endsOn = v; ctx.save(); } }),
        field("How sure?", "source", x.source, (v) => { x.source = v; ctx.save(); }),
      ],
    }));
}

// ---------- assumptions ----------
function assumptionsEditor(ctx) {
  const { user, pack } = ctx;
  user.assumptionOverrides ||= {};
  const planKey = { "plan.untilAge": "planUntilAge", "sip.stepUp": "sipStepUp" };
  const rows = pack.assumptions.map((a) => {
    const extra = a.id === "inflation.general" ? marketNote(ctx.market, user.assumptionOverrides[a.id] ?? a.value) : null;
    const get = () => (planKey[a.id] ? user.plan[planKey[a.id]] : user.assumptionOverrides[a.id]);
    const set = (v) => {
      if (v != null && (v < a.min || v > a.max)) v = Math.min(a.max, Math.max(a.min, v));
      if (planKey[a.id]) { if (v == null) delete user.plan[planKey[a.id]]; else user.plan[planKey[a.id]] = v; }
      else if (v == null) delete user.assumptionOverrides[a.id];
      else user.assumptionOverrides[a.id] = v;
      ctx.redraw();
    };
    const type = a.unit === "percent" ? "percent" : a.unit === "age" || a.unit === "months" ? "integer" : "number";
    const show = (v) => (a.unit === "percent" ? pct(v, 2) : String(v));
    const changed = get() != null && get() !== a.value;
    return h("div", { class: ["assumption", changed && "changed"] },
      h("div", {}, h("strong", {}, a.label), h("small", { class: "help" }, a.help),
        h("small", { class: "muted" }, `Default ${show(a.value)} · allowed ${show(a.min)}–${show(a.max)}`)),
      h("div", { class: "assumption-ctl" },
        control(type, get() ?? a.value, set, { min: a.min, max: a.max, step: a.step }),
        changed ? h("button", { type: "button", class: "link", onClick: () => set(undefined) }, "Reset") : null),
      extra ? h("div", { class: "wide-note" }, extra) : null);
  });
  return h("div", { class: "assumptions" }, ...rows);
}
