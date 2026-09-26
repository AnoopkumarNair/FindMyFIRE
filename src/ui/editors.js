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
  if (input === "list.properties") return propertiesEditor(ctx);
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
    const endable = c.endsByDefault === "childLeavesSchool" || c.id === "protection.term_premium";
    const userBirth = Number(user.profile.birthYearMonth.slice(0, 4));
    const userAge = Math.floor(resolveInputs(user, pack).age);
    const kids = (user.profile.children ||= []);
    // School costs end when the youngest child turns 18; ask for a birth year if no child is recorded yet.
    let helper = null;
    if (c.endsByDefault === "childLeavesSchool") {
      helper = kids.length
        ? h("small", { class: "muted" }, `Stops automatically at your age ${Math.max(...kids.map((k) => k.birthYear)) + 18 - userBirth}, when your youngest turns 18.`)
        : h("span", { class: "inline-help" }, "Youngest child's birth year ",
            control("integer", undefined, (v) => { if (v > 1990) { kids.push({ id: newId("c"), birthYear: v }); ctx.redraw(); } },
              { placeholder: String(new Date().getFullYear() - 8), min: 1990, max: 2100 }));
    }
    // Parents' costs: from the parent's age, run to their age 90.
    if (c.id.startsWith("family.parents")) {
      helper = h("span", { class: "inline-help" }, "Elder parent's age now ",
        control("integer", undefined, (v) => { if (v > 40 && v < 110) { ensure().endsAtAge = userAge + Math.max(1, 90 - v); ctx.redraw(); } }, { placeholder: "70" }),
        e?.endsAtAge ? h("small", { class: "muted" }, ` → runs until your age ${e.endsAtAge}`) : null);
    }
    return h("div", { class: "exp-row" },
      h("div", { class: "exp-label" }, h("span", {}, c.label),
        h("small", { class: "muted" }, [c.essential ? "Essential" : "Lifestyle", c.inflation !== "general" ? `${c.inflation} inflation` : null, post].filter(Boolean).join(" · ")),
        c.hint ? h("small", { class: "help" }, c.hint) : null, helper),
      control("currency", e?.amount || undefined, (v) => {
        if (!v) { user.expenses = user.expenses.filter((x) => x !== get()); item = null; }
        else ensure().amount = v;
        save();
      }, { placeholder: "" }),
      control("select", e?.frequency || c.frequency, (v) => { ensure().frequency = v || c.frequency; save(); },
        { placeholder: false, options: [{ value: "monthly", label: "per month" }, { value: "annual", label: "per year" }] }),
      control("source", e?.source, (v) => { ensure().source = v; save(); }),
      control("integer", e?.endsAtAge, (v) => { ensure().endsAtAge = v; save(); }, { placeholder: endable ? "stops at age (auto)" : "stops at age" }));
  };

  return h("div", {},
    h("p", { class: "total" }, "Total: ", total, quickNote),
    h("p", { class: "muted small" }, "Leave a category blank if it doesn't apply. Don't include loan EMIs (add them under Loans) or money you invest. If a cost will stop, such as an insurance premium or school fees, set the age it stops."),
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
    // Property has its own section (value, rent, costs, sale), so it isn't offered here.
    options: pack.instruments.filter((i) => i.assetClass === a.id && i.id !== "property_investment").map((i) => ({ value: i.id, label: i.label })) }));
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
            inst.access?.note ? h("small", { class: "help" }, inst.access.note) : null,
            inst.help ? h("small", { class: "help" }, inst.help) : null),
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
  const tplHint = (id) => pack.goalTemplates.find((t) => t.id === id)?.hint;
  const picker = control("select", "", (v) => {
    const t = pack.goalTemplates.find((x) => x.id === v);
    if (!t) return;
    const kid = t.suggestAge?.relativeTo === "child" ? kids[0] : null;
    const atAge = kid ? kid.birthYear + t.suggestAge.age - inp.birthYear : Math.ceil(inp.age) + 5;
    items.push({ id: newId("g"), templateId: t.id, label: t.label, atAge, costToday: 0,
      inflationRate: t.defaultInflationRate, priority: "must", childId: kid?.id, repeatEveryYears: t.defaultRepeatYears, source: "estimate" });
    ctx.redraw();
  }, { options: templates.map((t) => ({ value: t.id, label: t.label })), placeholder: "+ Add a goal…" });

  // Link a child goal to a child; typing a birth year creates the child and sets the due age.
  const childFields = (g) => {
    const tpl = pack.goalTemplates.find((t) => t.id === g.templateId) || {};
    const kid = kids.find((k) => k.id === g.childId);
    const setYear = (y) => {
      if (!(y > 1990)) return;
      let k = kid;
      if (!k) { k = { id: newId("c"), birthYear: y }; kids.push(k); g.childId = k.id; user.profile.children = kids; }
      else k.birthYear = y;
      if (tpl.suggestAge?.relativeTo === "child") g.atAge = y + tpl.suggestAge.age - inp.birthYear;
      ctx.redraw();
    };
    return [
      kids.length > 1 ? field("Which child", "select", g.childId, (v) => {
        g.childId = v; const k = kids.find((x) => x.id === v);
        if (k && tpl.suggestAge?.relativeTo === "child") g.atAge = k.birthYear + tpl.suggestAge.age - inp.birthYear;
        ctx.redraw();
      }, { options: kids.map((k, i) => ({ value: k.id, label: k.label || `Child ${i + 1} (born ${k.birthYear})` })) }) : null,
      field("Child's birth year", "integer", kid?.birthYear, setYear,
        { placeholder: String(new Date().getFullYear() - 8), help: tpl.suggestAge ? `Due age is set for when they turn ${tpl.suggestAge.age}.` : null }),
    ];
  };

  return h("div", {},
    h("p", { class: "muted small" }, "Enter today's cost; it's inflated to the year you need it. Goals before your FIRE age come out of your investments; later ones are added to retirement spending."),
    items.some((g) => g.templateId.startsWith("goal.child")) ? null
      : h("p", { class: "overlap-warn tip" }, "💡 Children? Their college is usually the biggest goal. Add “Child's undergraduate education” below."),
    listEditor(ctx, {
      items, create: picker, empty: "No goals yet.",
      render: (g) => [
        h("div", { class: "row-head" }, tplHint(g.templateId) ? h("small", { class: "help" }, tplHint(g.templateId)) : null),
        field("Goal", "text", g.label, (v) => { g.label = v || "Goal"; ctx.save(); }),
        field("Your age when it's due", "integer", g.atAge, (v) => { g.atAge = v; ctx.save(); }),
        field("Cost in today's money", "currency", g.costToday, (v) => { g.costToday = v || 0; ctx.save(); }),
        field("Cost inflation", "percent", g.inflationRate, (v) => { g.inflationRate = v; ctx.save(); }),
        field("Repeats every", "integer", g.repeatEveryYears, (v) => { g.repeatEveryYears = v > 0 ? v : undefined; ctx.redraw(); },
          { min: 1, max: 40, placeholder: "once", help: "Years. For a car every 8, renovation every 12…" }),
        g.repeatEveryYears ? field("Until your age", "integer", g.untilAge, (v) => { g.untilAge = v; ctx.save(); },
          { placeholder: String(user.plan.planUntilAge ?? 90), help: "Last time it can happen." }) : null,
        field("Priority", "select", g.priority, (v) => { g.priority = v; ctx.save(); }, { placeholder: false,
          options: [{ value: "must", label: "Must have" }, { value: "want", label: "Want" }, { value: "nice", label: "Nice to have" }],
        }),
        ...(g.templateId.startsWith("goal.child") ? childFields(g) : []),
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
  }, { options: templates.filter((t) => t.id !== "inflow.property_sale").map((t) => ({ value: t.id, label: t.label })), placeholder: "+ Add money coming in…" });

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

function propertiesEditor(ctx) {
  const { user, pack } = ctx;
  const items = (user.properties ||= []);
  const P = pack.property || {};
  const kinds = [["home", "Home you live in"], ["secondHome", "Second home / flat"], ["land", "Land or plot"], ["commercial", "Shop or office"]];
  const inp = resolveInputs(user, pack);
  const fireYear = new Date().getFullYear() + Math.round((user.plan.fireTargetAge ?? inp.age) - inp.age);
  const add = (kind) => {
    items.push({ id: newId("p"), kind, label: kinds.find((k) => k[0] === kind)[1], value: 0, plan: "keep", source: "estimate" });
    ctx.redraw();
  };
  // What the row adds up to, recomputed as the user types.
  const summary = (x) => {
    const r = resolveInputs({ ...user, properties: [x] }, pack).properties[0];
    const parts = [];
    if (r.sale) parts.push(`Sale at ${Math.floor(r.sale.atAge)}: ~${inrShort(r.sale.price)}, minus ${inrShort(r.sale.costs)} costs and ${inrShort(r.sale.tax)} tax = ${inrShort(r.sale.net)} into your corpus.`);
    else if (x.value) parts.push(`Worth ~${inrShort(x.value * (1 + r.growth) ** Math.max(0, (user.plan.fireTargetAge ?? inp.age) - inp.age))} at your FIRE age; not spent by the plan.`);
    const net = 12 * r.rentMonthly - r.costsYearly;
    if (net) parts.push(`${net > 0 ? "Rent adds" : "Costs take"} ${inrShort(Math.abs(net))} a year after FIRE${r.sale ? " until the sale" : ""}, rising with inflation.`);
    return parts.join(" ");
  };
  return h("div", {},
    h("p", { class: "muted small" }, "Property isn't part of your FIRE corpus. What counts: rent it earns, costs it keeps adding, and money from a sale. The home you live in usually just stays (no rent, costs already in your spending), unless you plan to sell or move."),
    P.growthHint ? h("p", { class: "muted small" }, h("strong", {}, "Price growth by location: "), P.growthHint) : null,
    listEditor(ctx, {
      items, empty: "No property yet.",
      create: h("div", { class: "chips" }, ...kinds.map(([k, label]) => h("button", { type: "button", class: "chip", onClick: () => add(k) }, `+ ${label}`))),
      render: (x) => {
        const note = h("small", {}, summary(x));
        const save = () => { note.textContent = summary(x); ctx.save(); };
        const selling = x.plan === "sell";
        return [
          h("div", { class: "row-head" }, h("strong", {}, kinds.find((k) => k[0] === x.kind)?.[1])),
          field("Name", "text", x.label, (v) => { x.label = v || "Property"; save(); }),
          field("City / area", "text", x.city, (v) => { x.city = v; save(); }, { placeholder: "e.g. Whitefield, Bengaluru" }),
          field("Worth today", "currency", x.value, (v) => { x.value = v || 0; save(); }, { help: "What it would sell for now, not what you paid." }),
          field("Price growth a year", "percent", x.growthRate, (v) => { x.growthRate = v; save(); },
            { placeholder: String((P.defaultGrowthRate ?? 0.05) * 100), help: "For this location. Blank = the default." }),
          x.kind !== "home" ? field("Rent received a month", "currency", x.monthlyRent, (v) => { x.monthlyRent = v; save(); }) : null,
          field("Yearly costs not in your spending", "currency", x.annualCosts, (v) => { x.annualCosts = v; save(); },
            { help: "Maintenance, property tax, insurance for this property." }),
          field("Plan", "select", x.plan, (v) => {
            x.plan = v || "keep";
            if (x.plan === "sell" && !x.sellOn) x.sellOn = `${fireYear}-04`;
            ctx.redraw();
          }, { placeholder: false, options: [{ value: "keep", label: "Keep" }, { value: "sell", label: "Sell" }] }),
          selling ? field("Sell in", "month", x.sellOn, (v) => { if (v) { x.sellOn = v; save(); } }) : null,
          selling ? field("Bought for", "currency", x.purchasePrice, (v) => { x.purchasePrice = v; save(); },
            { help: "For capital-gains tax (12.5% of the gain). Blank = today's value." }) : null,
          field("How sure?", "source", x.source, (v) => { x.source = v; save(); }),
          h("div", { class: "field wide" }, note),
        ];
      },
    }));
}

function incomesEditor(ctx) {
  const { user } = ctx;
  const items = (user.incomes ||= []);
  // Take-home types are entered after tax; income that you'll be taxed on after FIRE is entered before tax.
  const types = [
    ["salary", "Your salary", "take-home"], ["spouse_salary", "Spouse's salary", "take-home"],
    ["business", "Business / professional", "take-home"], ["pension", "Pension", "before tax"],
    ["annuity", "Annuity", "before tax"], ["part_time", "Part-time or consulting work", "before tax"],
    ["interest", "Interest / dividends", "before tax"], ["rental", "Rent (not from a listed property)", "before tax"],
    ["other", "Other", "before tax"]];
  const meta = Object.fromEntries(types.map(([v, label, basis]) => [v, { label, basis }]));
  return h("div", {},
    h("p", { class: "muted small" }, "Your salary and a spouse's are take-home amounts. Mark anything that continues after you stop working: a spouse who keeps working, a pension (a government pension usually rises with DA, so set its growth), an annuity, part-time work. It reduces what you draw from the corpus. A spouse's salary is taxed in their name; pensions and part-time income are taxed with your withdrawals. Rent from a property goes under Property."),
    listEditor(ctx, {
      items, empty: "No income sources yet.",
      create: h("button", { type: "button", class: "btn small", onClick: () => {
        items.push({ id: newId("i"), type: "salary", monthly: 0, source: "exact" }); ctx.redraw(); } }, "+ Add income"),
      render: (x) => {
        const m = meta[x.type] || meta.other;
        const later = ["pension", "annuity", "part_time"].includes(x.type);
        return [
          field("Type", "select", x.type, (v) => { x.type = v || "other"; if (["pension", "annuity", "part_time"].includes(x.type)) x.continuesAfterFire = true; ctx.redraw(); },
            { placeholder: false, options: types.map(([value, label]) => ({ value, label })) }),
          field("Name (optional)", "text", x.label, (v) => { x.label = v; ctx.save(); }),
          field(`Monthly (${m.basis}, today's ₹)`, "currency", x.monthly, (v) => { x.monthly = v || 0; ctx.save(); }),
          field("Grows each year by", "percent", x.annualGrowth, (v) => { x.annualGrowth = v; ctx.save(); }),
          field("Continues after FIRE", "boolean", !!x.continuesAfterFire, (v) => { x.continuesAfterFire = v; ctx.save(); }),
          later || x.fromAge != null ? field("Starts at your age", "integer", x.fromAge, (v) => { x.fromAge = v; ctx.save(); },
            { help: "Leave blank if it's already coming in." }) : null,
          field(x.type === "spouse_salary" ? "Stops at your age (when they stop working)" : "Stops at your age", "integer", x.endsAtAge, (v) => { x.endsAtAge = v; ctx.save(); }),
          field("How sure?", "source", x.source, (v) => { x.source = v; ctx.save(); }),
        ];
      },
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
