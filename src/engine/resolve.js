// Turns a user file + rules pack into the plain numbers the projection needs.
// Quick-pass answers are used until the matching refine section is in
// `sectionsDone`; then the detailed lists win (see `resolution` in the pack).

const monthlyOf = (amount, frequency) => (frequency === "annual" ? amount / 12 : amount);

export function ageAt(birthYearMonth, today) {
  const [y, m] = birthYearMonth.split("-").map(Number);
  return today.getFullYear() - y + (today.getMonth() + 1 - m) / 12;
}

/** Age the user will be on the first day of a "YYYY-MM" month. */
function ageOnMonth(birthYearMonth, yearMonth) {
  const [by, bm] = birthYearMonth.split("-").map(Number);
  const [y, m] = yearMonth.split("-").map(Number);
  return y - by + (m - bm) / 12;
}

export function assumptionValues(user, pack) {
  const out = {};
  for (const a of pack.assumptions) out[a.id] = a.value;
  Object.assign(out, user.assumptionOverrides || {});
  if (user.plan?.planUntilAge != null) out["plan.untilAge"] = user.plan.planUntilAge;
  if (user.plan?.sipStepUp != null) out["sip.stepUp"] = user.plan.sipStepUp;
  return out;
}

export function resolveInputs(user, pack, today = new Date()) {
  const done = new Set(user.sectionsDone || []);
  const detailed = {
    expenses: done.has("expenses") && (user.expenses || []).length > 0,
    holdings: done.has("holdings") && (user.holdings || []).length > 0,
    income: done.has("income") && (user.incomes || []).length > 0,
    loans: done.has("loans"),
  };
  const A = assumptionValues(user, pack);
  const q = user.quick || {};
  const prov = user.provenance || {};
  const age = ageAt(user.profile.birthYearMonth, today);
  const birthYear = Number(user.profile.birthYearMonth.slice(0, 4));
  const cats = Object.fromEntries(pack.expenseCatalog.map((c) => [c.id, c]));
  const insts = Object.fromEntries(pack.instruments.map((i) => [i.id, i]));

  // ---- expenses (today's ₹ per month, one row per inflation stream) ----
  let expenses;
  if (detailed.expenses) {
    const children = user.profile.children || [];
    // Child costs stop when the youngest child finishes school (18) or becomes independent;
    // expressed as the user's own age.
    const lastChildAt = (childAge) => children.length
      ? Math.max(...children.map((c) => c.birthYear + (childAge ?? c.independentAtAge ?? 22) - birthYear))
      : null;
    expenses = user.expenses.map((e) => {
      const cat = cats[e.categoryId] || {};
      let endsAtAge = e.endsAtAge ?? null;
      if (endsAtAge == null && cat.endsByDefault === "childLeavesSchool") endsAtAge = lastChildAt(18);
      if (endsAtAge == null && cat.endsByDefault === "childIndependent") endsAtAge = lastChildAt(null);
      if (endsAtAge == null && e.categoryId === "protection.term_premium")
        endsAtAge = user.insurance?.termCoverEndsAtAge ?? null;
      return {
        id: e.id,
        label: e.label || cat.label || e.categoryId,
        categoryId: e.categoryId,
        monthly: monthlyOf(e.amount, e.frequency),
        inflation: cat.inflation || "general",
        essential: cat.essential ?? true,
        postFireFactor: e.postFireFactor ?? cat.postFireFactor ?? 1,
        endsAtAge,
        source: e.source,
      };
    });
  } else {
    const living = q.monthlyExpenses ?? 0;
    const health = Math.min(living, q.healthcareMonthly ?? living * 0.1);
    const src = prov["/quick/monthlyExpenses"] || "estimate";
    expenses = [
      { id: "quick.living", label: "Household spending", monthly: living - health, inflation: "general", essential: true, postFireFactor: 1, endsAtAge: null, source: src },
      { id: "quick.health", label: "Healthcare (assumed share)", monthly: health, inflation: "health", essential: true, postFireFactor: 1, endsAtAge: null, source: src },
    ];
  }

  // ---- loans: EMIs only matter after FIRE if they run past it ----
  const emis = detailed.loans
    ? (user.liabilities || []).map((l) => ({
        label: l.label || l.type,
        monthly: l.emi,
        endsAtAge: ageOnMonth(user.profile.birthYearMonth, l.endsOn),
      }))
    : [];
  const emiMonthlyNow = detailed.loans
    ? emis.filter((e) => e.endsAtAge > age).reduce((s, e) => s + e.monthly, 0)
    : q.emiMonthly ?? 0;

  // ---- the same money entered in two places is counted once (and reported) ----
  const overlaps = [];
  const props = user.properties || [];
  const hasRentedProperty = props.some((x) => x.monthlyRent > 0);
  const hasSale = props.some((x) => x.plan === "sell");
  const payoutInflow = (user.inflows || []).some((x) => x.templateId === "inflow.insurance_payout");

  // ---- holdings ----
  let fireCorpus, emergencyFund = 0, excludedCorpus = 0, monthlySip, epfMonthly;
  const excluded = [];
  const locked = []; // excluded now, but unlocks at an age (e.g. NPS at 60)
  let foreignValue = 0; // counted holdings taxed as foreign shares
  if (detailed.holdings) {
    fireCorpus = 0; monthlySip = 0; epfMonthly = 0;
    for (const h of user.holdings) {
      const inst = insts[h.instrumentId] || {};
      let counts = !h.isEmergencyFund && (h.countInFire ?? inst.countInFireByDefault ?? true);
      if (props.length && h.instrumentId === "property_investment") {
        overlaps.push({ section: "holdings", message: `"${h.label || inst.label}" is listed under Investments and you also have properties under Property. It's counted only under Property.` });
        continue;
      }
      if (counts && h.instrumentId === "insurance_traditional" && payoutInflow) {
        counts = false;
        overlaps.push({ section: "holdings", message: `"${h.label || inst.label}" is counted through its payout under Money coming in, so its surrender value isn't added again.` });
      }
      if (h.isEmergencyFund) emergencyFund += h.value;
      else if (counts) fireCorpus += h.value;
      else {
        excludedCorpus += h.value;
        excluded.push({ label: h.label || inst.label, value: h.value, instrumentId: h.instrumentId });
        if (inst.unlock && h.countInFire !== false) locked.push({
          label: h.label || inst.label, value: h.value, rate: inst.defaultReturn ?? 0.08, unlock: inst.unlock,
          yearlyContribution: 12 * ((h.monthlyContribution || 0) + (h.employerMonthlyContribution || 0)) + (h.annualContribution || 0),
        });
      }
      if (!counts) continue;
      if (inst.taxTreatment === "foreign_equity") foreignValue += h.value;
      const contrib = (h.monthlyContribution || 0) + (h.annualContribution || 0) / 12;
      if (h.instrumentId === "epf" || h.instrumentId === "vpf")
        epfMonthly += contrib + (h.employerMonthlyContribution || 0);
      else monthlySip += contrib;
    }
  } else {
    if (q.totalSavings != null) {
      // One simple total: the emergency fund (months of spending + EMIs) is kept aside first,
      // and only what's left counts toward FIRE. If there isn't enough, it all stays aside.
      const need = (A["emergency.months"] ?? 6) * (expenses.reduce((s, e) => s + e.monthly, 0) + emiMonthlyNow);
      emergencyFund = Math.min(q.totalSavings, need);
      fireCorpus = q.totalSavings - emergencyFund;
    } else fireCorpus = q.investedCorpus ?? 0; // older plan files: already excluded the emergency fund
    // NPS from the quick questions: locked until it unlocks (60), then a lump sum plus a pension.
    const npsInst = insts.nps_tier1;
    if (q.npsBalance > 0 && npsInst?.unlock) {
      excludedCorpus += q.npsBalance;
      excluded.push({ label: npsInst.label, value: q.npsBalance, instrumentId: "nps_tier1" });
      locked.push({ label: npsInst.label, value: q.npsBalance, rate: npsInst.defaultReturn ?? 0.09, unlock: npsInst.unlock,
        yearlyContribution: 12 * (q.npsMonthly || 0) });
    }
    monthlySip = q.monthlySip ?? 0;
    epfMonthly = q.epfMonthly ?? 0;
  }

  // ---- income ----
  // Take-home types are entered after tax and aren't taxed again; a spouse's salary is taxed in
  // their name. Pensions, annuities, part-time work and interest are entered before tax and are
  // taxed with your withdrawals. Rent is 70% taxable (30% standard deduction).
  const TAX_SHARE = { salary: 0, business: 0, spouse_salary: 0, rental: 0.7, interest: 1, pension: 1, annuity: 1, part_time: 1, other: 1 };
  const DEFAULT_GROWTH = { salary: A["income.growth"], spouse_salary: A["income.growth"], business: A["income.growth"],
    part_time: A["inflation.general"], rental: A["inflation.general"], pension: 0, annuity: 0, interest: 0, other: 0 };
  const takeHomeMonthly = detailed.income
    ? user.incomes.filter((i) => i.type === "salary" || i.type === "business" || i.type === "spouse_salary").reduce((s, i) => s + i.monthly, 0)
    : q.takeHomeMonthly ?? 0;
  const incomesAfterFire = detailed.income
    ? user.incomes.filter((i) => {
        if (i.continuesAfterFire && i.type === "rental" && hasRentedProperty) {
          overlaps.push({ section: "income", message: `Rent "${i.label || "rental income"}" under Income is ignored because rent is already entered under Property.` });
          return false;
        }
        return i.continuesAfterFire;
      }).map((i) => ({
        label: i.label || i.type, monthly: i.monthly, growth: i.annualGrowth ?? DEFAULT_GROWTH[i.type] ?? 0,
        endsAtAge: i.endsAtAge ?? null, fromAge: i.fromAge ?? null, taxShare: TAX_SHARE[i.type] ?? 1,
      }))
    : q.incomeAfterFireMonthly > 0
      // Quick answer: after tax, in today's money, from FIRE until the age given.
      ? [{ label: "Income after FIRE", monthly: q.incomeAfterFireMonthly, growth: A["inflation.general"],
          endsAtAge: q.incomeAfterFireUntilAge ?? null, fromAge: null, taxShare: 0 }]
      : [];
  const plan = user.plan || {};

  // Goals, with repeating ones (a car every 8 years) expanded into one event per occurrence.
  const goals = [];
  for (const g of user.goals || []) {
    const tpl = pack.goalTemplates.find((t) => t.id === g.templateId) || {};
    const one = { goalId: g.id, label: g.label, atAge: g.atAge, costToday: g.costToday, priority: g.priority || "must",
      inflationRate: g.inflationRate ?? tpl.defaultInflationRate ?? A["inflation.general"] };
    if (!g.repeatEveryYears) { goals.push(one); continue; }
    const last = g.untilAge ?? A["plan.untilAge"];
    for (let a = g.atAge, n = 1; a <= last; a += g.repeatEveryYears, n++)
      goals.push({ ...one, atAge: a, label: n > 1 ? `${g.label} (${n})` : g.label });
  }

  // Lump sums received, expanded to one event per payment, in nominal rupees after tax.
  const inflows = [];
  for (const x of user.inflows || []) {
    if (x.templateId === "inflow.property_sale" && hasSale) {
      overlaps.push({ section: "inflows", message: `"${x.label}" under Money coming in is ignored because a sale is planned under Property. If it's a different property, add it under Property instead.` });
      continue;
    }
    const start = ageOnMonth(user.profile.birthYearMonth, x.on);
    for (let k = 0; k < (x.years || 1); k++) {
      const atAge = start + k;
      if (atAge < age) continue;
      const gross = x.growthRate != null ? x.amount * (1 + x.growthRate) ** (atAge - age) : x.amount;
      inflows.push({ label: x.label, atAge, net: gross * (1 - (x.taxRate || 0)), source: x.source });
    }
  }

  // Locked money: grows (with contributions until FIRE) to its unlock age, then arrives as a
  // lump sum plus, for NPS, a pension from the annuity share.
  for (const l of locked) {
    const years = l.unlock.age - age;
    if (years <= 0) continue;
    const payingYears = Math.max(0, Math.min(years, (plan.fireTargetAge ?? l.unlock.age) - age));
    let v = l.value;
    for (let y = 0; y < years; y++) v = (v + (y < payingYears ? l.yearlyContribution : 0)) * (1 + l.rate);
    const lump = v * (l.unlock.lumpSumShare ?? 1);
    inflows.push({ label: `${l.label} (unlocks at ${l.unlock.age})`, atAge: l.unlock.age, net: lump, source: "estimate" });
    if (l.unlock.annuityShare)
      incomesAfterFire.push({ taxShare: 1, label: `${l.label} pension`, monthly: (v * l.unlock.annuityShare * (l.unlock.annuityRate ?? 0.06)) / 12,
        growth: 0, fromAge: l.unlock.age, endsAtAge: null, nominal: true });
  }

  // Property: value grows by location; rent and costs continue while owned; a sale arrives as
  // a lump sum net of selling costs and capital-gains tax.
  const P = pack.property || { defaultGrowthRate: 0.05, saleCostRate: 0.02, ltcgRate: 0.125 };
  const properties = (user.properties || []).map((x) => {
    const g = x.growthRate ?? P.defaultGrowthRate;
    const sellAge = x.plan === "sell" && x.sellOn ? ageOnMonth(user.profile.birthYearMonth, x.sellOn) : null;
    const out = { label: x.label, kind: x.kind, city: x.city, value: x.value, growth: g, sellAge,
      rentMonthly: x.monthlyRent || 0, costsYearly: x.annualCosts || 0 };
    if (sellAge != null && sellAge >= age) {
      const price = x.value * (1 + g) ** (sellAge - age);
      const tax = P.ltcgRate * Math.max(0, price - (x.purchasePrice ?? x.value));
      out.sale = { atAge: sellAge, price, tax, costs: price * P.saleCostRate, net: price * (1 - P.saleCostRate) - tax };
      inflows.push({ label: `Sale of ${x.label}`, atAge: sellAge, net: out.sale.net, source: x.source });
    }
    return out;
  });

  // Health cover after FIRE: employer cover stops, so a family floater is needed. Its premium
  // rises with age bands and medical inflation; only the part beyond any premium already in
  // the user's spending is added.
  const HC = pack.healthCover;
  let health = null;
  if (HC) {
    const entered = user.insurance?.premiumAfterFire;
    const atNow = premiumAt(HC.premiumByAge, age);
    const existingYearly = detailed.expenses
      ? expenses.filter((e) => e.categoryId === "health.insurance_premium").reduce((s, e) => s + 12 * e.monthly * e.postFireFactor, 0)
      : 0;
    health = { table: HC.premiumByAge, scale: entered == null ? 1 : atNow ? entered / atNow : 0,
      estimated: entered == null, existingYearly, premiumNow: entered ?? atNow };
  }

  // Tax on withdrawals: interest on the 3-year cash and 5-year debt buckets per rupee withdrawn.
  const ret = Object.fromEntries(pack.assetClasses.map((a) => [a.id, a.expectedReturn]));
  const taxCtx = pack.incomeTax
    ? { tax: pack.incomeTax, gainShare: A["tax.equityGainShare"] ?? 0.5, interestPerRupee: 3 * (ret.cash ?? 0.05) + 5 * (ret.debt ?? 0.07),
        foreignShare: fireCorpus > 0 ? Math.min(1, foreignValue / fireCorpus) : 0 }
    : null;

  // A finished detailed section replaces the quick answer. Flag big drops: usually something's missing.
  const drop = (section, what, detailedValue, quickValue) => {
    if (quickValue > 0 && detailedValue < 0.75 * quickValue)
      overlaps.push({ section, kind: "drop", message: `Your ${what} add up to ${Math.round(detailedValue).toLocaleString("en-IN")} but your quick answer was ${Math.round(quickValue).toLocaleString("en-IN")}. The quick answer is no longer used; add anything missing.` });
  };
  if (detailed.expenses) drop("expenses", "expenses", expenses.reduce((a, e) => a + e.monthly, 0), q.monthlyExpenses);
  if (detailed.holdings) {
    drop("holdings", "investments", fireCorpus + excludedCorpus + emergencyFund, q.totalSavings ?? q.investedCorpus);
    drop("holdings", "monthly investments (incl. PF)", monthlySip + epfMonthly, (q.monthlySip || 0) + (q.epfMonthly || 0));
  }
  if (detailed.income) drop("income", "take-home incomes", takeHomeMonthly, q.takeHomeMonthly);

  return {
    age,
    birthYear,
    overlaps,
    fireTargetAge: plan.fireTargetAge,
    planUntilAge: A["plan.untilAge"],
    assumptions: A,
    detailed,
    takeHomeMonthly,
    expenses,
    emis,
    emiMonthlyNow,
    fireCorpus,
    emergencyFund,
    excludedCorpus,
    excluded,
    monthlySip,
    epfMonthly,
    incomesAfterFire,
    goals,
    inflows,
    health,
    taxCtx,
    properties,
    locked,
    postFireSpending: plan.postFireSpending ?? 1,
    otherAssetsValue: (user.otherAssets || []).reduce((s, a) => s + a.value, 0),
    loansOutstanding: (user.liabilities || []).reduce((s, l) => s + l.outstanding, 0),
    partTime: plan.partTimeIncomeMonthly > 0
      ? { monthly: plan.partTimeIncomeMonthly, untilAge: plan.partTimeUntilAge ?? 60, assumed: false }
      : null,
  };
}

/** Indicative premium at an age, interpolated from the rules pack's table (flat beyond its ends). */
export function premiumAt(table, a) {
  if (!table?.length) return 0;
  if (a <= table[0].age) return table[0].premium;
  for (let i = 1; i < table.length; i++) {
    const lo = table[i - 1], hi = table[i];
    if (a <= hi.age) return lo.premium + ((a - lo.age) / (hi.age - lo.age)) * (hi.premium - lo.premium);
  }
  return table.at(-1).premium;
}
