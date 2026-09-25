import { h, mount } from "./dom.js";
import { control } from "./fields.js";
import { inr, inrShort, pct, age1, monthAtAge } from "./format.js";
import { corpusChart } from "./chart.js";
import { sectionEditor } from "./editors.js";
import { marketNote } from "./market.js";
import * as store from "./store.js";
import { evaluatePlan, evaluate, getPointer, setPointer, ageAt } from "../engine/index.js";

const APP_VERSION = "0.3.0";
// Replaced with the commit id at deploy time; also appended to every file URL so browsers
// fetch the new version right after a deploy instead of reusing a cached copy.
const BUILD = "dev";
const PACK_URL = `rules/in.2026.1.json?v=${BUILD}`;
const S = { pack: null, user: null, result: null, error: null, passphrase: null };
const app = document.getElementById("app");
const live = h("div", { class: "live", "aria-live": "polite" });

// ---------------- state ----------------
function ready(u) {
  return /^\d{4}-\d{2}$/.test(u?.profile?.birthYearMonth || "") && u.plan?.fireTargetAge > 0 &&
    (u.quick?.monthlyExpenses != null || (u.sectionsDone || []).includes("expenses"));
}

function recompute() {
  try {
    S.result = ready(S.user) ? evaluatePlan(S.user, S.pack) : null;
    S.error = null;
  } catch (e) {
    S.result = null;
    S.error = e;
    console.error(e);
  }
}

/** Bring older plan files up to date with the current questions. */
function migrate(u) {
  if (!u?.quick) return u;
  // The quick pass used to ask for EPF separately; it's now part of "monthly investing".
  if (u.quick.epfMonthly) {
    u.quick.monthlySip = (u.quick.monthlySip || 0) + u.quick.epfMonthly;
    if (u.provenance) delete u.provenance["/quick/epfMonthly"];
  }
  delete u.quick.epfMonthly;
  return u;
}

function persist() {
  S.user.updatedAt = new Date().toISOString();
  S.user.app.appVersion = APP_VERSION;
  store.saveWorking(S.user);
  recompute();
}

/** Save and refresh the small live-result strip (keeps focus in the form). */
function save() { persist(); drawLive(); }
/** Save and redraw the whole current view. */
function redraw() { persist(); route(); }

function drawLive() {
  const r = S.result;
  if (!r) { live.replaceChildren(h("span", { class: "muted" }, "Your result appears here as you answer.")); return; }
  live.replaceChildren(
    h("span", {}, "Earliest FIRE age ", h("strong", {}, r.earliestAge == null ? "not before " + r.inputs.planUntilAge : age1(r.earliestAge))),
    h("span", {}, "Corpus needed at ", r.target.age, ": ", h("strong", {}, inrShort(r.target.required))),
    h("span", {}, "Confidence ", h("strong", {}, `${r.confidence.score}`), ` (${r.confidence.band.label})`));
}

// ---------------- shell ----------------
function header() {
  const hasPlan = !!S.user?.profile?.birthYearMonth;
  const fileInput = h("input", { type: "file", accept: ".json,application/json", hidden: true,
    onChange: (e) => e.target.files[0] && openFile(e.target.files[0]) });
  return h("header", { class: "top" },
    h("a", { href: "#/", class: "brand" }, h("span", { class: "flame", "aria-hidden": "true" }), "FindMyFIRE"),
    h("nav", {},
      hasPlan ? h("a", { href: "#/results", class: "btn ghost" }, "Results") : null,
      hasPlan ? h("button", { type: "button", class: "btn", onClick: saveFile }, "Save file") : null,
      h("button", { type: "button", class: "btn ghost", onClick: () => fileInput.click() }, "Open file"),
      fileInput,
      h("details", { class: "menu" }, h("summary", { class: "btn ghost", "aria-label": "More" }, "⋯"),
        h("div", { class: "menu-body" },
          hasPlan ? h("button", { type: "button", onClick: setPassphrase }, S.passphrase ? "Change or remove passphrase" : "Protect saved file with a passphrase") : null,
          hasPlan && S.result ? h("button", { type: "button", onClick: recordCheckIn }, "Record today's check-in") : null,
          h("button", { type: "button", onClick: loadExample }, "Load an example plan"),
          hasPlan ? h("button", { type: "button", class: "danger", onClick: startOver }, "Start over (clear this browser)") : null))));
}

function footer() {
  return h("footer", { class: "foot" },
    h("p", {}, "Your plan stays on this device. It's saved in this browser and in the file you download. Nothing is uploaded: no accounts, no analytics."),
    h("p", { class: "muted" }, `A planning tool, not investment, tax or legal advice. Rules pack ${S.pack?.packId}.${S.pack?.packVersion} (${S.pack?.effectiveFrom || "FY2025-26"}). App v${APP_VERSION} (build ${BUILD}). `,
      h("a", { href: "https://github.com/AnoopkumarNair/FindMyFIRE", rel: "noopener" }, "Source code")));
}

function route() {
  const [, view, arg] = (location.hash || "#/").split("/");
  let body;
  if (!S.user?.profile?.birthYearMonth && view && view !== "quick") { location.hash = "#/"; return; }
  if (view === "quick") body = quickView(Number(arg) || 0);
  else if (view === "results") body = resultsView();
  else if (view === "refine") body = refineView(arg);
  else body = welcomeView();
  mount(app, header(), h("main", {}, body), footer());
  drawLive();
  window.scrollTo(0, 0);
  const focusable = app.querySelector("main [autofocus], main h1");
  if (focusable) focusable.focus({ preventScroll: true });
}

// ---------------- welcome ----------------
const quickCount = () => S.pack.questionFlow.quick.questions.length;
function welcomeView() {
  const working = S.user?.profile?.birthYearMonth ? S.user : null;
  return h("section", { class: "welcome" },
    h("h1", { tabindex: -1 }, "When can you stop working?"),
    h("p", { class: "lede" }, `A guided FIRE (Financial Independence, Retire Early) calculator for India. ${quickCount()} quick questions give you a first answer. Add detail whenever you like: each section you complete makes the answer more reliable.`),
    h("div", { class: "cta" },
      working
        ? [h("a", { href: "#/results", class: "btn primary" }, "Continue your plan"),
           h("a", { href: "#/quick/0", class: "btn" }, "Review quick answers")]
        : h("button", { type: "button", class: "btn primary", onClick: () => { S.user = store.newUserFile(S.pack, APP_VERSION); location.hash = "#/quick/0"; } }, `Start: ${quickCount()} questions`)),
    h("ul", { class: "points" },
      h("li", {}, h("strong", {}, "Private by design. "), "Everything runs in your browser. Your plan is a JSON file you keep; open it here next time."),
      h("li", {}, h("strong", {}, "Built for India. "), "EPF, PPF, NPS lock-ins, separate healthcare and education inflation, rupees in lakhs and crores."),
      h("li", {}, h("strong", {}, "Honest about uncertainty. "), "Guesses show up as a range and a confidence score, and stress tests show what inflation or a crash would do.")));
}

// ---------------- quick pass ----------------
/** Age questions store an approximate birth month; keep the existing one if the age hasn't changed. */
function birthMonthForAge(age, current) {
  const now = new Date();
  if (current && Math.floor(ageAt(current, now)) === age) return current;
  return `${now.getFullYear() - age}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const DONT_KNOW = {
  // Defaults when someone taps "I don't know". Marked as 'default' so confidence drops.
  "/quick/monthlyExpenses": (u) => Math.round(Math.max(0, (u.quick.takeHomeMonthly || 0) * 0.6 - (u.quick.emiMonthly || 0)) / 1000) * 1000,
};

function quickView(i) {
  if (!S.user) S.user = store.newUserFile(S.pack, APP_VERSION);
  const u = S.user;
  const qs = S.pack.questionFlow.quick.questions.filter((q) => evaluate(q.showIf, u));
  i = Math.min(Math.max(0, i), qs.length - 1);
  const q = qs[i];
  const value = getPointer(u, q.bind);
  const prov = (u.provenance ||= {});
  const err = h("p", { class: "error", role: "alert" });

  const set = (v) => {
    setPointer(u, q.bind, v);
    if (q.input === "currency") prov[q.bind] ||= "estimate";
    else prov[q.bind] = "exact";
    save();
  };
  const valid = () => {
    const v = getPointer(u, q.bind);
    if (q.input === "multiselect") return v?.length ? null : "Pick at least one.";
    if (v == null || v === "") return q.defaultFrom ? null : "Please answer, or use a rough number.";
    if (q.input === "yearMonth" || q.input === "age") {
      const a = ageAt(v, new Date());
      if (q.input === "age") return a < q.min || a >= q.max + 1 ? `Enter an age from ${q.min} to ${q.max}.` : null;
      return a < 16 || a > 90 ? "That birth date gives an age outside 16–90." : null;
    }
    if (q.min != null && v < q.min) return `At least ${q.min}.`;
    if (q.max != null && v > q.max) return `At most ${q.max}.`;
    if (q.bind === "/plan/fireTargetAge" && u.profile.birthYearMonth && v <= ageAt(u.profile.birthYearMonth, new Date()))
      return "Pick an age later than your current age.";
    if (q.bind === "/plan/planUntilAge" && u.plan.fireTargetAge && v <= u.plan.fireTargetAge)
      return `Pick an age after your FIRE age (${u.plan.fireTargetAge}).`;
    return null;
  };
  const next = () => {
    const e = valid();
    if (e) { err.textContent = e; return; }
    if (q.defaultFrom && getPointer(u, q.bind) == null) {
      // Skipped: keep the rules-pack default and mark it as such (lowers confidence a little).
      setPointer(u, q.bind, defaultOf(q));
      prov[q.bind] = "default";
      persist();
    }
    if (i + 1 < qs.length) location.hash = `#/quick/${i + 1}`;
    else location.hash = "#/results";
  };

  const defaultOf = (x) => S.pack.assumptions.find((a) => a.id === x.defaultFrom)?.value;
  const opts = { autofocus: true, options: q.options, min: q.min, max: q.max, exclusive: ["none"],
    placeholder: q.defaultFrom ? String(defaultOf(q)) : undefined };
  const ctl = q.input === "age"
    ? control("integer", value ? Math.floor(ageAt(value, new Date())) : undefined, (a) => set(a == null ? undefined : birthMonthForAge(a, value)), opts)
    : control(q.input === "integer" ? "integer" : q.input, value, set, opts);
  const certainty = q.input === "currency"
    ? h("div", { class: "certainty" }, h("span", { class: "muted" }, "How sure are you?"),
        h("span", { class: "seg" }, ...[["exact", "Exact"], ["estimate", "Rough estimate"]].map(([k, label]) =>
          h("button", { type: "button", class: ["seg-btn", (prov[q.bind] || "estimate") === k && "on"],
            onClick: () => { prov[q.bind] = k; redraw(); } }, label))),
        prov[q.bind] === "default" ? h("span", { class: "badge" }, "Filled in for you") : null)
    : null;

  return h("section", { class: "wizard", onKeydown: (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.target.blur(); next(); } } },
    h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": qs.length, "aria-valuenow": i + 1 },
      h("span", { class: "bar" }, h("span", { class: "fill", "data-w": (i + 1) / qs.length })),
      h("span", { class: "muted" }, `Question ${i + 1} of ${qs.length}`)),
    h("h1", { tabindex: -1 }, q.prompt),
    q.help ? h("p", { class: "help" }, q.help) : null,
    h("div", { class: "answer" }, ctl),
    certainty,
    q.defaultFrom ? h("p", { class: "muted small" }, `Leave blank to use ${defaultOf(q)}.`) : null,
    q.impactHint ? h("p", { class: "impact" }, q.impactHint) : null,
    err,
    h("div", { class: "wizard-nav" },
      i > 0 ? h("a", { href: `#/quick/${i - 1}`, class: "btn ghost" }, "Back") : h("span"),
      q.allowDontKnow && DONT_KNOW[q.bind] ? h("button", { type: "button", class: "btn ghost", onClick: () => {
        setPointer(u, q.bind, DONT_KNOW[q.bind](u)); prov[q.bind] = "default"; persist(); next();
      } }, "I don't know") : null,
      h("button", { type: "button", class: "btn primary", onClick: next }, i + 1 < qs.length ? "Next" : "See my result")),
    live);
}

// ---------------- results ----------------
function resultsView() {
  const r = S.result;
  if (!r) {
    return h("section", {}, h("h1", { tabindex: -1 }, "A few answers are missing"),
      S.error ? h("p", { class: "error" }, `Something went wrong: ${S.error.message}`) : null,
      h("p", {}, "Answer the quick questions to see your result."), h("a", { href: "#/quick/0", class: "btn primary" }, "Go to questions"));
  }
  const u = S.user, t = r.target, bym = u.profile.birthYearMonth;
  const reached = r.earliestAge != null;
  const ahead = reached && r.earliestAge <= t.age;

  const hero = h("section", { class: "hero" },
    h("p", { class: "eyebrow" }, "Earliest you could stop working"),
    h("h1", { tabindex: -1 }, reached ? `Age ${age1(r.earliestAge)}` : `Not before ${r.inputs.planUntilAge}`),
    reached ? h("p", { class: "sub" }, `Around ${monthAtAge(bym, r.earliestAge)}. `,
      r.range.from != null && r.range.to != null && r.range.to - r.range.from >= 0.2
        ? `Likely between ${age1(r.range.from)} and ${age1(r.range.to)}, allowing for how exact your answers are.`
        : r.range.to == null ? "With pessimistic readings of your answers it may not be reachable." : "")
      : h("p", { class: "sub" }, "With current savings and spending, the corpus doesn't catch up with what you'd need. Try the levers below."),
    h("p", { class: ["verdict", ahead ? "good" : "warn"] },
      ahead ? `✓ On track for your target of ${t.age}` : `Your target is ${t.age}: ${pct(t.funded, 0)} funded by then`));

  const kpis = h("div", { class: "kpis" },
    kpi(`Corpus needed at ${t.age}`, inrShort(t.required), t.firstYearWithdrawal > 0
      ? `First-year withdrawal ${inrShort(t.firstYearWithdrawal)} (${pct(t.firstYearWithdrawal / t.required, 2)} of the corpus)`
      : "Money coming in covers the first year's spending"),
    kpi(`Projected at ${t.age}`, inrShort(t.projected), `From ${inrShort(r.inputs.fireCorpus)} today + ${inr(r.inputs.monthlySip + r.inputs.epfMonthly)}/month invested`),
    kpi(t.gap >= 0 ? "Surplus at target" : "Shortfall at target", inrShort(Math.abs(t.gap)), t.gap >= 0 ? "Ahead of plan" : "Gap to close", t.gap >= 0 ? "good" : "warn"),
    kpi("Monthly investing needed", t.requiredMonthlySip == null ? "—" : inr(t.requiredMonthlySip),
      `To retire at ${t.age}, rising ${pct(r.params.stepUp, 0)} a year. You invest ${inr(r.inputs.monthlySip + r.inputs.epfMonthly)} now.`));

  return h("div", { class: "results" },
    hero, kpis,
    card("How your corpus grows and lasts",
      corpusChart(r.timeline, { targetAge: t.age, earliestAge: r.earliestAge }),
      r.depletesAtAge != null && r.depletesAtAge < r.inputs.planUntilAge
        ? h("p", { class: "warn-text" }, `⚠ Retiring at ${t.age} on the current path, the money runs out around age ${Math.floor(r.depletesAtAge)}.`)
        : h("p", { class: "muted" }, `Retiring at ${t.age} on the current path, the money lasts past ${r.inputs.planUntilAge}.`)),
    confidenceCard(r),
    nudgesCard(r),
    scenariosCard(r),
    swpCard(r),
    assumptionsSummary(r),
    snapshotsCard());
}

const kpi = (label, value, note, tone) => h("div", { class: ["kpi", tone] },
  h("span", { class: "kpi-label" }, label), h("strong", { class: "kpi-value" }, value), h("small", {}, note));

const card = (title, ...body) => h("section", { class: "card" }, h("h2", {}, title), ...body);

function confidenceCard(r) {
  const c = r.confidence;
  const sections = [...c.sections].sort((a, b) => b.potential - a.potential);
  return card("How reliable is this?",
    h("div", { class: "meter-row" },
      h("div", { class: "meter", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": c.score, "aria-label": "Confidence" },
        h("span", { class: "fill", "data-w": c.score / 100 })),
      h("strong", {}, `${c.score}/100 · ${c.band.label}`)),
    h("p", {}, c.band.message),
    h("p", { class: "muted small" }, "Refine a section to replace quick guesses with detail. The biggest gains are at the top."),
    h("div", { class: "sections" }, ...sections.map((s) => h("a", { href: `#/refine/${s.id}`, class: ["section-link", s.done && "done"] },
      h("span", {}, s.title),
      s.done ? h("span", { class: "badge good" }, "✓ Done") : s.potential > 0 ? h("span", { class: "badge" }, `up to +${s.potential}`) : null))));
}

function nudgesCard(r) {
  if (!r.nudges.length) return null;
  const icon = { critical: "⛔", warn: "⚠", info: "ℹ" };
  return card("Things to look at",
    h("ul", { class: "nudges" }, ...r.nudges.map((n) => h("li", { class: n.severity },
      h("span", { class: "icon", "aria-hidden": "true" }, icon[n.severity]),
      h("span", { class: "sr" }, `${n.severity}: `),
      h("span", {}, n.message),
      n.section ? h("a", { href: `#/refine/${n.section}`, class: "link" }, "Fix") : null))));
}

function scenariosCard(r) {
  return card("What if…",
    h("p", { class: "muted small" }, "The same plan under stress. Plan for the uncomfortable rows, not just the base case."),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Scenario"), h("th", { class: "num" }, "Projected"), h("th", { class: "num" }, "Needed"), h("th", { class: "num" }, "Earliest age"))),
      h("tbody", {}, ...r.scenarios.map((s) => h("tr", {},
        h("th", { scope: "row" }, s.label, s.description ? h("small", { class: "help" }, s.description) : null),
        h("td", { class: "num" }, `${inrShort(s.projected)}`, h("small", { class: "help" }, `at ${s.fireTargetAge}`)),
        h("td", { class: "num" }, inrShort(s.required)),
        h("td", { class: ["num", s.earliestAge == null || s.earliestAge > r.earliestAge + 0.05 ? "worse" : s.earliestAge < r.earliestAge - 0.05 ? "better" : ""] },
          s.earliestAge == null ? "not reached" : age1(s.earliestAge))))))));
}

function swpCard(r) {
  const w = r.swp, t = r.target;
  if (!w?.buckets) return null;
  const b = w.buckets, total = b.cash.amount + b.debt.amount + b.equity.amount;
  const seg = (cls, amount) => h("span", { class: ["bucket-seg", cls], "data-w": amount / total, title: inrShort(amount) });
  const eqWarn = b.equity.return != null && b.equity.return > 0.12;
  const bucket = (cls, name, amount, what, where, rate, note) => h("div", { class: "bucket" },
    h("div", { class: "bucket-head" }, h("span", { class: ["key-block", cls], "aria-hidden": "true" }), h("strong", {}, name), h("span", { class: "num" }, inrShort(amount))),
    h("small", {}, what), h("small", { class: "muted" }, where), h("small", {}, rate), note);
  return card("Living off your corpus",
    h("p", {}, `From ${t.age} you stop investing and pay yourself a monthly `, h("strong", {}, "SWP (systematic withdrawal plan)"),
      ` of about `, h("strong", {}, inr(w.firstMonthly)), ` in the first year. It rises with inflation every year. That needs `,
      h("strong", {}, inrShort(w.corpus)), ` at ${t.age}, split into three buckets:`),
    h("div", { class: "bucket-bar", role: "img", "aria-label": `Cash ${inrShort(b.cash.amount)}, debt ${inrShort(b.debt.amount)}, equity ${inrShort(b.equity.amount)}` },
      seg("s1", b.cash.amount), seg("s2", b.debt.amount), seg("s3", b.equity.amount)),
    h("div", { class: "buckets" },
      bucket("s1", "1 · Cash", b.cash.amount, "The next 3 years of withdrawals. Your SWP is paid from here.",
        "Liquid or arbitrage funds, sweep FD.", `Assumed ${pct(b.cash.return)} a year.`),
      bucket("s2", "2 · Debt", b.debt.amount, "Years 4 to 8. Refills the cash bucket once a year.",
        "Debt / target-maturity funds, G-Secs, SCSS after 60.", `Assumed ${pct(b.debt.return)} a year.`),
      bucket("s3", "3 · Equity", b.equity.amount, "Everything else. Grows to beat inflation and refills debt.",
        "Index and flexi-cap funds.", b.equity.return == null ? "" : `Needs ${pct(b.equity.return)} a year for the whole corpus to average ${pct(w.blendedReturn)}.`,
        eqWarn ? h("small", { class: "warn-text" }, "⚠ That's a lot to expect from equity. Consider lowering the post-FIRE return in Assumptions.") : null)),
    h("p", { class: "small" }, h("strong", {}, "Each year: "),
      "move one year of withdrawals from debt to cash, and top up debt from equity. After a bad year for markets, skip the equity sale and let debt carry you; that's what the 8 years of cash and debt are for."),
    h("p", { class: "small muted" }, `Withdrawals include ${pct(w.taxRate)} for tax (equity gains above ₹1.25 lakh a year are taxed at 12.5%; debt fund gains at your slab rate). `,
      r.depletesAtAge != null && r.depletesAtAge < r.inputs.planUntilAge
        ? `On your current path you'd have ${inrShort(t.projected)} at ${t.age} instead, which runs out around ${Math.floor(r.depletesAtAge)}.`
        : ""),
    h("details", {},
      h("summary", {}, "Year-by-year SWP"),
      h("div", { class: "table-wrap" }, h("table", { class: "dense" },
        h("thead", {}, h("tr", {}, ...["Age", "Year", "Monthly SWP", "Corpus at start", "Taken out", "Growth", "Corpus at end"].map((x, i) => h("th", { class: i > 1 ? "num" : "" }, x)))),
        h("tbody", {}, ...w.rows.map((x) => h("tr", {},
          h("td", {}, Math.floor(x.age)), h("td", {}, x.year),
          h("td", { class: "num" }, x.withdrawal < 0 ? "—" : inr(x.monthly)),
          ...[x.begin, x.withdrawal, x.growth, Math.max(0, x.end)].map((v) => h("td", { class: "num" }, v < 0 ? `+${inrShort(-v)} in` : inrShort(v))))))))));
}

function assumptionsSummary(r) {
  const p = r.params;
  return card("Assumptions used",
    h("p", { class: "muted small" }, `Inflation ${pct(p.infl.general)} general, ${pct(p.infl.health)} healthcare, ${pct(p.infl.education)} education. Returns ${pct(p.rPre)} before FIRE, ${pct(p.rPost)} after. SIP step-up ${pct(p.stepUp)} a year. ${pct(p.tax)} tax on withdrawals. Money must last until ${p.planUntilAge}. `,
      h("a", { href: "#/refine/assumptions" }, "Change")),
    marketNote(S.market, p.infl.general));
}

function snapshotsCard() {
  const snaps = S.user.snapshots || [];
  return card("Check-ins",
    h("p", { class: "muted small" }, "Record a check-in every few months to see progress over time. It's stored in your plan file."),
    snaps.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", { class: "num" }, "FIRE corpus"), h("th", { class: "num" }, "Net worth"), h("th", { class: "num" }, "Earliest age"), h("th", { class: "num" }, "Confidence"))),
      h("tbody", {}, ...snaps.map((s) => h("tr", {}, h("td", {}, s.date), h("td", { class: "num" }, inrShort(s.fireCorpus)),
        h("td", { class: "num" }, inrShort(s.netWorth)), h("td", { class: "num" }, age1(s.earliestFireAge)), h("td", { class: "num" }, s.confidence ?? "—"))))))
      : null,
    h("button", { type: "button", class: "btn", onClick: recordCheckIn }, "Record today's check-in"));
}

// ---------------- refine ----------------
function refineView(id) {
  const section = S.pack.questionFlow.refine.find((s) => s.id === id);
  if (!section) { location.hash = "#/results"; return h("span"); }
  const u = S.user;
  u.sectionsDone ||= [];
  const done = u.sectionsDone.includes(id);
  const ctx = { user: u, pack: S.pack, market: S.market, save, redraw };
  const toggle = () => {
    u.sectionsDone = done ? u.sectionsDone.filter((x) => x !== id) : [...u.sectionsDone, id];
    persist();
    location.hash = "#/results";
  };
  const replaces = section.replacesQuick?.length
    ? h("p", { class: "muted small" }, "Until you mark this section complete, your quick answers are used instead.")
    : null;
  return h("section", { class: "refine" },
    h("a", { href: "#/results", class: "link" }, "← Results"),
    h("h1", { tabindex: -1 }, section.title),
    section.intro ? h("p", { class: "lede" }, section.intro) : null,
    replaces,
    sectionEditor(section, ctx),
    h("div", { class: "refine-foot" },
      h("button", { type: "button", class: ["btn", !done && "primary"], onClick: toggle }, done ? "Mark as not complete" : "Mark complete and see result"),
      h("a", { href: "#/results", class: "btn ghost" }, "Back without marking")),
    live);
}

// ---------------- file actions ----------------
async function saveFile() {
  const text = JSON.stringify(S.user, null, 2);
  const out = S.passphrase ? await store.encrypt(text, S.passphrase) : text;
  const date = new Date().toISOString().slice(0, 10);
  store.download(`findmyfire-plan-${date}${S.passphrase ? ".encrypted" : ""}.json`, out);
}

async function openFile(file) {
  let obj;
  try { obj = JSON.parse(await store.readFile(file)); }
  catch { return alertBox("That file isn't valid JSON."); }
  if (store.isEncrypted(obj)) {
    const pass = await askPassphrase("This file is protected. Enter its passphrase.");
    if (!pass) return;
    try { obj = JSON.parse(await store.decrypt(obj, pass)); S.passphrase = pass; }
    catch { return alertBox("Wrong passphrase, or the file is damaged."); }
  }
  const problem = store.checkUserFile(obj);
  if (problem) return alertBox(problem);
  if (obj.app.rulesPack !== S.pack.packId) return alertBox(`This file uses rules pack '${obj.app.rulesPack}', which this app doesn't have.`);
  S.user = migrate(obj);
  persist();
  location.hash = "#/results";
  route();
}

async function setPassphrase() {
  const pass = await askPassphrase("Saved files will be encrypted with this passphrase (AES-256). If you forget it, the file can't be opened. Leave empty to save without encryption.", true);
  if (pass === null) return;
  S.passphrase = pass || null;
  route();
}

function recordCheckIn() {
  const r = S.result;
  if (!r) return;
  const u = S.user, i = r.inputs;
  const other = (u.otherAssets || []).reduce((s, a) => s + a.value, 0);
  const debt = (u.liabilities || []).reduce((s, l) => s + l.outstanding, 0);
  const snap = { date: new Date().toISOString().slice(0, 10), fireCorpus: Math.round(i.fireCorpus),
    netWorth: Math.round(i.fireCorpus + i.emergencyFund + i.excludedCorpus + other - debt),
    earliestFireAge: r.earliestAge == null ? null : +r.earliestAge.toFixed(1), confidence: r.confidence.score };
  u.snapshots = [...(u.snapshots || []).filter((s) => s.date !== snap.date), snap];
  persist();
  location.hash = "#/results";
  route();
}

async function loadExample() {
  if (S.user?.profile?.birthYearMonth && !(await confirmBox("Replace your current plan in this browser with an example? Save your file first if you want to keep it."))) return;
  const ex = await (await fetch(`examples/user-detailed.example.json?v=${BUILD}`)).json();
  ex.$schema = "https://fire-in.local/schemas/user-file.schema.json";
  S.user = ex;
  S.passphrase = null;
  persist();
  location.hash = "#/results";
  route();
}

async function startOver() {
  if (!(await confirmBox("Clear the plan from this browser? Files you saved are not affected."))) return;
  store.clearWorking();
  S.user = null;
  S.passphrase = null;
  recompute();
  location.hash = "#/";
  route();
}

// ---------------- dialogs (no inline scripts, no window.prompt) ----------------
function dialog(build) {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "dialog" });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(...build(close));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

const alertBox = (msg) => dialog((close) => [h("p", {}, msg), h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn primary", onClick: () => close(true) }, "OK"))]);
const confirmBox = (msg) => dialog((close) => [h("p", {}, msg), h("div", { class: "dialog-actions" },
  h("button", { type: "button", class: "btn ghost", onClick: () => close(false) }, "Cancel"),
  h("button", { type: "button", class: "btn primary", onClick: () => close(true) }, "Continue"))]);
const askPassphrase = (msg, allowEmpty = false) => dialog((close) => {
  const input = h("input", { type: "password", autocomplete: "new-password", "aria-label": "Passphrase",
    onKeydown: (e) => { if (e.key === "Enter") ok(); } });
  const ok = () => { if (input.value || allowEmpty) close(input.value); };
  setTimeout(() => input.focus(), 0);
  return [h("p", {}, msg), input, h("div", { class: "dialog-actions" },
    h("button", { type: "button", class: "btn ghost", onClick: () => close(null) }, "Cancel"),
    h("button", { type: "button", class: "btn primary", onClick: ok }, "OK"))];
});

// Progress bars and meters take their width from data-w (CSP forbids inline style attributes).
new MutationObserver(() => {
  for (const el of app.querySelectorAll("[data-w]")) el.style.width = `${Math.max(0, Math.min(1, +el.dataset.w)) * 100}%`;
}).observe(app, { childList: true, subtree: true });

// ---------------- boot ----------------
async function boot() {
  try {
    S.pack = await (await fetch(PACK_URL)).json();
  } catch {
    mount(app, h("p", { class: "error" }, "Couldn't load the rules pack. If you opened index.html directly from disk, run `npm run serve` instead."));
    return;
  }
  try {
    const res = await fetch("market/india.json");
    if (res.ok) S.market = await res.json();
  } catch { /* optional: published by the deploy workflow */ }
  S.user = migrate(store.loadWorking());
  if (S.user) store.saveWorking(S.user);
  recompute();
  window.addEventListener("hashchange", route);
  route();
}

boot();
