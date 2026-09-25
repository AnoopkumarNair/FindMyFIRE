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
    const lastChildIndependent = children.length
      ? Math.max(...children.map((c) => c.birthYear + (c.independentAtAge ?? 22) - birthYear))
      : null;
    expenses = user.expenses.map((e) => {
      const cat = cats[e.categoryId] || {};
      let endsAtAge = e.endsAtAge ?? null;
      if (endsAtAge == null && cat.group === "children") endsAtAge = lastChildIndependent;
      if (endsAtAge == null && e.categoryId === "protection.term_premium")
        endsAtAge = user.insurance?.termCoverEndsAtAge ?? null;
      return {
        id: e.id,
        label: e.label || cat.label || e.categoryId,
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

  // ---- holdings ----
  let fireCorpus, emergencyFund = 0, excludedCorpus = 0, monthlySip, epfMonthly;
  const excluded = [];
  if (detailed.holdings) {
    fireCorpus = 0; monthlySip = 0; epfMonthly = 0;
    for (const h of user.holdings) {
      const inst = insts[h.instrumentId] || {};
      const counts = !h.isEmergencyFund && (h.countInFire ?? inst.countInFireByDefault ?? true);
      if (h.isEmergencyFund) emergencyFund += h.value;
      else if (counts) fireCorpus += h.value;
      else { excludedCorpus += h.value; excluded.push({ label: h.label || inst.label, value: h.value, instrumentId: h.instrumentId }); }
      if (!counts) continue;
      const contrib = (h.monthlyContribution || 0) + (h.annualContribution || 0) / 12;
      if (h.instrumentId === "epf" || h.instrumentId === "vpf")
        epfMonthly += contrib + (h.employerMonthlyContribution || 0);
      else monthlySip += contrib;
    }
  } else {
    fireCorpus = q.investedCorpus ?? 0;
    monthlySip = q.monthlySip ?? 0;
    epfMonthly = q.epfMonthly ?? 0;
  }

  // ---- income ----
  const takeHomeMonthly = detailed.income
    ? user.incomes.filter((i) => i.type === "salary" || i.type === "business").reduce((s, i) => s + i.monthly, 0)
    : q.takeHomeMonthly ?? 0;
  const incomesAfterFire = detailed.income
    ? user.incomes.filter((i) => i.continuesAfterFire).map((i) => ({
        label: i.label || i.type, monthly: i.monthly, growth: i.annualGrowth ?? 0, endsAtAge: i.endsAtAge ?? null,
      }))
    : [];

  const goals = (user.goals || []).map((g) => {
    const tpl = pack.goalTemplates.find((t) => t.id === g.templateId) || {};
    return {
      label: g.label, atAge: g.atAge, costToday: g.costToday, priority: g.priority || "must",
      inflationRate: g.inflationRate ?? tpl.defaultInflationRate ?? A["inflation.general"],
    };
  });

  const plan = user.plan || {};
  return {
    age,
    birthYear,
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
    partTime: plan.partTimeIncomeMonthly > 0
      ? { monthly: plan.partTimeIncomeMonthly, untilAge: plan.partTimeUntilAge ?? 60, assumed: false }
      : null,
  };
}
