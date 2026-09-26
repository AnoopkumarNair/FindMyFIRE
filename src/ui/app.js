import { h, mount } from "./dom.js";
import { control } from "./fields.js";
import { inr, inrShort, pct, age1, monthAtAge } from "./format.js";
import { corpusChart } from "./chart.js";
import { sectionEditor } from "./editors.js";
import { marketNote } from "./market.js";
import { art, questionArt } from "./art.js";
import { openShareDialog } from "./share.js";
import * as store from "./store.js";
import { evaluatePlan, evaluate, getPointer, setPointer, ageAt } from "../engine/index.js";

const APP_VERSION = "0.6.0";
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
  const before = S.result;
  try {
    S.result = ready(S.user) ? evaluatePlan(S.user, S.pack) : null;
    // A change that moves the plan from short to on track for the same target deserves a moment.
    if (before && S.result && before.target.age === S.result.target.age && before.target.gap < 0 && S.result.target.gap >= 0)
      celebrate(`You're on track for ${S.result.target.age}!`);
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
    h("a", { href: "#/", class: "brand", "aria-label": "FindMyFIRE home" }, h("span", { class: "flame", "aria-hidden": "true" }),
      h("span", { class: "wordmark" }, "FindMy", h("b", {}, "FIRE"))),
    h("nav", {},
      hasPlan ? h("a", { href: "#/results", class: "btn ghost" }, icon("chart"), h("span", { class: "lbl" }, "Results")) : null,
      hasPlan ? h("button", { type: "button", class: "btn", onClick: saveFile, "aria-label": "Save file" }, icon("save"), h("span", { class: "lbl" }, "Save")) : null,
      h("button", { type: "button", class: "btn ghost", onClick: () => fileInput.click(), "aria-label": "Open file" }, icon("open"), h("span", { class: "lbl" }, "Open")),
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
  const key = `${view || "home"}/${arg || ""}`;
  const changed = key !== S.lastKey;
  document.body.dataset.view = view || "home";
  S.lastKey = key;
  mount(app, header(), h("main", { class: changed ? "enter" : "" }, body), footer());
  drawLive();
  if (changed) { window.scrollTo({ top: 0, behavior: "instant" }); countUp(app); }
  const focusable = app.querySelector("main [autofocus], main h1");
  if (focusable) focusable.focus({ preventScroll: true });
}

// ---------------- welcome ----------------
const quickCount = () => S.pack.questionFlow.quick.questions.length;
function welcomeView() {
  const working = S.user?.profile?.birthYearMonth ? S.user : null;
  const n = quickCount();
  const start = () => { S.user = store.newUserFile(S.pack, APP_VERSION); location.hash = "#/quick/0"; };
  const cta = working
    ? [h("a", { href: "#/results", class: "btn primary big" }, "Continue your plan →"),
       h("a", { href: "#/quick/0", class: "btn big ghost" }, "Change my answers")]
    : [h("button", { type: "button", class: "btn primary big", onClick: start }, "Find my FIRE age →"),
       h("button", { type: "button", class: "btn big ghost", onClick: loadExample }, "See an example")];
  const step = (num, pic, title, text) => h("li", { class: "step" }, h("div", { class: "step-art" }, art(pic), h("span", { class: "num" }, num)), h("h3", {}, title), h("p", {}, text));
  const feature = (ic, title, text) => h("li", { class: "feature" }, h("span", { class: "ficon" }, art(ic)), h("h3", {}, title), h("p", {}, text));
  const faq = (q, a) => h("details", { class: "faq" }, h("summary", {}, q), h("p", {}, a));
  return h("div", { class: "landing" },
    h("section", { class: "landing-hero" },
      h("div", { class: "hero-copy" },
        h("p", { class: "eyebrow" }, "A FIRE planner made for India"),
        h("h1", { tabindex: -1 }, "Find out when work becomes ", h("em", {}, "optional"), "."),
        h("p", { class: "lede" }, "FIRE stands for Financial Independence, Retire Early. It's the point where your investments can pay your bills for the rest of your life. You might keep working after that. The difference is, you won't have to."),
        h("p", { class: "lede" }, `Answer ${n} questions about your money. In about two minutes you'll see the age you could get there, how likely it is, and what to do next.`),
        h("div", { class: "cta" }, ...cta),
        h("p", { class: "fineprint" }, working ? "Your plan is saved in this browser." : "Rough numbers are fine · No sign-up · Nothing leaves your device")),
      heroDemo()),

    h("section", { class: "band" },
      h("h2", {}, "How it works"),
      h("ol", { class: "steps" },
        step("1", "pen", "Enter the basics", "Your age, what you earn, spend and have saved. Round numbers are fine; sharpen them later."),
        step("2", "target", "See your FIRE age", "And how sure it is. Your plan is tested against a thousand possible market futures, right on your device."),
        step("3", "path", "Get your plan", "What to invest this year, when to build a cash cushion, and how much to take out each month once you stop."))),

    h("section", { class: "band" },
      h("h2", {}, "It counts what other calculators leave out"),
      h("ul", { class: "features" },
        feature("pillars", "EPF, PPF and NPS", "Including money that's locked until 58 or 60, and when it actually becomes yours."),
        feature("house", "Your property", "Rent it earns, what it costs to keep, and a sale in any year you choose."),
        feature("health", "Health cover after work", "Your employer's policy ends when you stop. The plan includes the premiums that rise every year after."),
        feature("receipt", "Tax on withdrawals", "Worked out every year under the new regime, not a flat guess."),
        feature("gift", "Money coming in", "Gratuity, policy payouts, an inheritance: dated, taxed, and put to work."),
        feature("umbrella", "A crash at the worst time", "What happens if markets fall right after you stop, the risk that sinks most plans."))),

    h("section", { class: "band privacy" },
      h("div", {},
        h("h2", {}, "Your numbers stay with you"),
        h("p", {}, "Nothing you type is sent anywhere: no account, no tracking, no server that stores your data. Your plan lives in this browser. Download it as a file, lock it with a passphrase if you like, and open it here any time.")),
      h("div", { class: "lock" }, art("lock"))),

    h("section", { class: "band" },
      h("h2", {}, "Questions people ask"),
      faq("Do I need exact numbers?", "No. Start with rough figures and mark them as estimates. The app shows how accurate your answer is and suggests the one section worth filling in next."),
      faq("I don't want to retire at 40. Is this still useful?", "Yes. FIRE is about having the choice. The same plan tells you whether you're on track for 60, what a career break would cost, or how much a move to a cheaper city helps."),
      faq("Is this financial advice?", "No. It's a planning tool that does the maths carefully and shows its working. Tax rules and rates are current to FY2025-26; check big decisions with a SEBI-registered adviser."),
      faq("Where do the numbers come from?", "Your answers, plus assumptions you can see and change: inflation, returns, life expectancy. Inflation is compared with the latest World Bank data for India.")),

    h("section", { class: "final-cta" },
      h("h2", {}, "Two minutes to your number."),
      h("div", { class: "cta" }, working
        ? h("a", { href: "#/results", class: "btn primary big" }, "Continue your plan →")
        : h("button", { type: "button", class: "btn primary big", onClick: start }, "Find my FIRE age →"))));
}

/** The landing page's example: a corpus that grows, then carries you, drawn as the page loads. */
function heroDemo() {
  const W = 520, H = 300, pad = 24;
  const pts = [];
  for (let a = 35; a <= 90; a++) {
    const v = a <= 53 ? Math.pow((a - 33) / 20, 2.1) : Math.max(0, 1 - Math.pow((a - 53) / 38, 1.6) * 0.92);
    pts.push([pad + ((a - 35) / 55) * (W - 2 * pad), H - pad - v * (H - 3 * pad)]);
  }
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const sx = pts[18][0], sy = pts[18][1];
  return h("div", { class: "demo", "aria-hidden": "true" },
    h("div", { class: "demo-card" },
      h("p", { class: "demo-tag" }, "Example"),
      h("svg:svg", { viewBox: `0 0 ${W} ${H}`, class: "demo-svg" },
        h("svg:defs", {},
          h("svg:linearGradient", { id: "demoFill", x1: 0, y1: 0, x2: 0, y2: 1 },
            h("svg:stop", { offset: "0%", class: "stop-a" }), h("svg:stop", { offset: "100%", class: "stop-b" }))),
        h("svg:line", { x1: pad, x2: W - pad, y1: H - pad, y2: H - pad, class: "demo-axis" }),
        h("svg:path", { d: `${d}L${W - pad},${H - pad}L${pad},${H - pad}Z`, class: "demo-area", fill: "url(#demoFill)" }),
        h("svg:path", { d, class: "demo-line", pathLength: 1 }),
        h("svg:line", { x1: sx, x2: sx, y1: pad, y2: H - pad, class: "demo-mark" }),
        h("svg:circle", { cx: sx, cy: sy, r: 9, class: "demo-sun" }),
        h("svg:text", { x: pad, y: H - 6, class: "demo-tick" }, "35"),
        h("svg:text", { x: sx - 8, y: H - 6, class: "demo-tick" }, "53"),
        h("svg:text", { x: W - pad - 14, y: H - 6, class: "demo-tick" }, "90")),
      h("div", { class: "demo-chips" },
        h("span", { class: "chip-pop c1" }, h("b", {}, "53"), " could stop working"),
        h("span", { class: "chip-pop c2" }, h("b", {}, "₹4.9 Cr"), " needed by then"),
        h("span", { class: "chip-pop c3" }, h("b", {}, "9 in 10"), " chance by 61"))));
}

/** Small line icons for the header (drawn with SVG, no icon font). */
function icon(name) {
  const paths = {
    chart: "M4 19h16M6 16l4-5 3 3 5-7",
    save: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14",
    open: "M12 20V9m0 0l-4 4m4-4l4 4M5 4h14",
    share: "M8 12l8-5M8 12l8 5M18 6a2 2 0 1 0 0-.01M18 18a2 2 0 1 0 0-.01M6 12a2 2 0 1 0 0-.01",
  };
  return h("svg:svg", { viewBox: "0 0 24 24", class: "ic", "aria-hidden": "true" },
    h("svg:path", { d: paths[name], fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
}

/** Count numbers up to their value once, on elements marked data-count. */
function countUp(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of root.querySelectorAll("[data-count]")) {
    const to = Number(el.dataset.count), dec = Number(el.dataset.dec || 0), pre = el.dataset.pre || "";
    if (!Number.isFinite(to)) continue;
    const t0 = performance.now(), dur = 900, from = to * 0.6;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      el.textContent = pre + (from + (to - from) * e).toFixed(dec);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
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

  const dir = (S.lastQuick ?? -1) <= i ? "fwd" : "back";
  const fromW = S.lastQuick == null ? 0 : (S.lastQuick + 1) / qs.length;
  S.lastQuick = i;
  return h("section", { class: ["wizard", dir], onKeydown: (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.target.blur(); next(); } } },
    h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": qs.length, "aria-valuenow": i + 1 },
      h("span", { class: "bar" }, h("span", { class: "fill", "data-w": (i + 1) / qs.length, "data-from": fromW })),
      h("span", { class: "muted" }, `Question ${i + 1} of ${qs.length}`)),
    h("div", { class: "q-art" }, art(questionArt[q.id])),
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
    h("h1", { tabindex: -1, class: "big-age" }, reached
      ? [h("span", { class: "unit" }, "Age "), h("span", { "data-count": Number(age1(r.earliestAge)), "data-dec": 1 }, age1(r.earliestAge))]
      : `Not before ${r.inputs.planUntilAge}`),
    reached ? h("p", { class: "sub" }, `Around ${monthAtAge(bym, r.earliestAge)}. `,
      r.range.from != null && r.range.to != null && r.range.to - r.range.from >= 0.2
        ? `Likely between ${age1(r.range.from)} and ${age1(r.range.to)}, allowing for how exact your answers are.`
        : r.range.to == null ? "With pessimistic readings of your answers it may not be reachable." : "")
      : h("p", { class: "sub" }, "With current savings and spending, the corpus doesn't catch up with what you'd need. Try the levers below."),
    chanceStrip(r),
    h("div", { class: "hero-actions" },
      h("p", { class: ["verdict", ahead ? "good" : "warn"] },
        ahead ? `✓ On track for your target of ${t.age}` : `Your target is ${t.age}: ${pct(t.funded, 0)} funded by then`),
      reached ? h("button", { type: "button", class: "btn small share-btn", onClick: () => openShareDialog(r) }, icon("share"), "Share my FIRE age") : null));

  const kpis = h("div", { class: "kpis" },
    kpi(`Corpus needed at ${t.age}`, inrShort(t.required), lumpsAtFire(r) > 0
      ? `After ${inrShort(lumpsAtFire(r))} arriving in your first retirement year (${lumpLabels(r)}).`
      : t.firstYearWithdrawal > 0
      ? `First-year withdrawal ${inrShort(t.firstYearWithdrawal)} (${pct(t.firstYearWithdrawal / t.required, 2)} of the corpus)`
      : "Money coming in covers the first year's spending"),
    kpi(`Projected at ${t.age}`, inrShort(t.projected), `From ${inrShort(r.inputs.fireCorpus)} today + ${inr(r.inputs.monthlySip + r.inputs.epfMonthly)}/month invested`),
    kpi(t.gap >= 0 ? "Surplus at target" : "Shortfall at target", inrShort(Math.abs(t.gap)), t.gap >= 0 ? "Ahead of plan" : "Gap to close", t.gap >= 0 ? "good" : "warn"),
    kpi(`Chance it lasts to ${r.inputs.planUntilAge}`, `${Math.round(r.chance.atTarget * 100)}%`,
      `If you stop at ${t.age}, across 1,000 simulated market histories.`, r.chance.atTarget >= 0.75 ? "good" : "warn"));

  return h("div", { class: "results" },
    hero, kpis,
    confidenceCard(r),
    leversCard(r),
    actionPlanCard(r),
    card("How your corpus grows and lasts",
      corpusChart(r.timeline, { targetAge: t.age, earliestAge: r.earliestAge }),
      r.depletesAtAge != null && r.depletesAtAge < r.inputs.planUntilAge
        ? h("p", { class: "warn-text" }, `⚠ Retiring at ${t.age} on the current path, the money runs out around age ${Math.floor(r.depletesAtAge)}.`)
        : h("p", { class: "muted" }, `Retiring at ${t.age} on the current path, the money lasts past ${r.inputs.planUntilAge}.`)),
    balanceCard(r),
    scenariosCard(r),
    swpCard(r),
    assumptionsSummary(r),
    snapshotsCard());
}

/** Steady-market age vs. what 1,000 simulated market histories say. */
function chanceStrip(r) {
  const c = r.chance;
  const pill = (label, age, cls) => h("span", { class: ["pill", cls] }, h("strong", {}, age == null ? "—" : age1(age)), label);
  return h("div", { class: "chance" },
    h("p", { class: "muted small" }, "Markets don't return the same every year, and a bad run early in retirement hurts most. Across 1,000 simulated market histories:"),
    h("div", { class: "pills" },
      pill("about 50/50 (steady markets)", r.earliestAge),
      pill("3 in 4 chance the money lasts", c.likelyAge, "mid"),
      pill("9 in 10 chance: a safe plan", c.confidentAge, "safe")));
}

function leversCard(r) {
  const L = r.levers, t = r.target, now = r.inputs.monthlySip + r.inputs.epfMonthly;
  if (!L) return null;
  if (L.onTrack) {
    return card("You have room",
      h("ul", { class: "levers" },
        h("li", {}, h("strong", {}, `Stop at ${age1(L.retireAt)}`), ` instead of ${t.age} (steady markets; 9 in 10 chance by ${age1(r.chance.confidentAge)}).`),
        L.spendAfterFire && h("li", {}, h("strong", {}, `Spend up to ${inr(L.spendAfterFire.to)} a month`), ` after FIRE (today's money) instead of ${inr(L.spendAfterFire.from)}.`)));
  }
  const items = [
    L.investMore != null && h("li", {}, h("strong", {}, `Invest ${inr(L.investMore)} more a month`),
      ` (${inr(now + L.investMore)} in total), increasing ${pct(r.params.stepUp, 0)} each year.`),
    L.spendAfterFire && h("li", {}, h("strong", {}, `Plan to live on ${inr(L.spendAfterFire.to)} a month`),
      ` after FIRE (today's money) instead of ${inr(L.spendAfterFire.from)}. A cheaper city, or no rent or EMIs by then, can do this.`),
    L.retireAt != null && h("li", {}, h("strong", {}, `Stop at ${age1(L.retireAt)}`), ` instead of ${t.age}. For a 9 in 10 chance, ${age1(r.chance.confidentAge)}.`),
    !(r.inputs.properties || []).length && h("li", {}, h("strong", {}, "Count your property. "), "Selling or renting out a second home can close much of the gap: ",
      h("a", { href: "#/refine/property" }, "add it under Property"), "."),
  ].filter(Boolean);
  return card(`What would get you to ${t.age}`,
    h("p", { class: "muted small" }, "Each of these closes the gap on its own (steady-market figures). Most people combine a little of each."),
    h("ul", { class: "levers" }, ...items));
}

function balanceCard(r) {
  const b = r.balance, T = b.today;
  const row = (label, v, note, cls) => v ? h("tr", { class: cls }, h("th", { scope: "row" }, label, note ? h("small", { class: "help" }, note) : null), h("td", { class: "num" }, inrShort(v))) : null;
  const locked = (r.inputs.locked || []).map((l) => `${l.label} unlocks at ${l.unlock.age}`).join("; ");
  return card("Where you stand today",
    h("div", { class: "table-wrap" }, h("table", { class: "balance" }, h("tbody", {},
      row("Investments for FIRE", T.investments, "The corpus the plan grows and draws from."),
      row("Emergency fund", T.emergency, "Kept aside, not in the plan."),
      row("Locked or earmarked", T.locked, locked || "Not counted toward FIRE."),
      row("Property", T.property, (r.inputs.properties || []).map((p) => `${p.label}${p.city ? ` (${p.city})` : ""}: grows ${pct(p.growth)} a year${p.sale ? `, sold at ${Math.floor(p.sale.atAge)} for ~${inrShort(p.sale.net)} after costs and tax` : ", kept"}`).join("; ")),
      row("Other assets", T.other),
      T.loans ? row("Loans", -T.loans) : null,
      h("tr", { class: "total-row" }, h("th", { scope: "row" }, "Net worth"), h("td", { class: "num" }, inrShort(T.netWorth)))))),
    !(r.inputs.properties || []).length
      ? h("p", { class: "muted small" }, "Own a home or land? ", h("a", { href: "#/refine/property" }, "Add it under Property"), " to see its value over time, rent, costs, or a planned sale.")
      : h("p", { class: "muted small" }, `At ${r.target.age}: investments ${inrShort(b.atTarget.investments)} and property ${inrShort(b.atTarget.property)} (property you keep isn't spent by the plan).`));
}

const inFireYear = (r) => r.inputs.inflows.filter((x) => Math.floor(x.atAge - r.inputs.age) === Math.round(r.target.age - r.inputs.age));
const lumpsAtFire = (r) => inFireYear(r).reduce((s, x) => s + x.net, 0);
const lumpLabels = (r) => inFireYear(r).map((x) => x.label).join(", ");

const kpi = (label, value, note, tone) => h("div", { class: ["kpi", tone] },
  h("span", { class: "kpi-label" }, label), h("strong", { class: "kpi-value" }, value), h("small", {}, note));

const card = (title, ...body) => h("section", { class: "card" }, h("h2", {}, title), ...body);

/** The section that would raise confidence most, excluding `skip`. */
function nextSection(r, skip) {
  return [...r.confidence.sections].filter((x) => !x.done && x.id !== skip && x.potential > 0).sort((a, b) => b.potential - a.potential)[0] || null;
}

function confidenceCard(r) {
  const c = r.confidence;
  const next = nextSection(r);
  const rest = [...c.sections].sort((a, b) => b.potential - a.potential);
  return h("section", { class: "card next-step" },
    h("div", { class: "meter-row" },
      h("strong", {}, `Accuracy ${c.score}/100 · ${c.band.label}`),
      h("div", { class: "meter", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": c.score, "aria-label": "Accuracy" },
        h("span", { class: "fill", "data-w": c.score / 100 }))),
    next
      ? h("p", {}, "This is based on quick answers. The most useful next step: ",
          h("a", { href: `#/refine/${next.id}`, class: "btn primary small" }, `${next.title} →`),
          h("span", { class: "muted" }, ` up to +${next.potential}`))
      : h("p", {}, "✓ Every section is done. Revisit once a year, or when something big changes."),
    h("details", {}, h("summary", {}, "All sections (optional)"),
      h("div", { class: "sections" }, ...rest.map((x) => h("a", { href: `#/refine/${x.id}`, class: ["section-link", x.done && "done"] },
        h("span", {}, x.title),
        x.done ? h("span", { class: "badge good" }, "✓ Done") : x.potential > 0 ? h("span", { class: "badge" }, `+${x.potential}`) : null)))));
}

/** Dated, concrete steps from today to the years after FIRE. Folds in the rules pack's nudges. */
function actionPlanCard(r) {
  const u = S.user, i = r.inputs, t = r.target, w = r.swp, A = i.assumptions;
  const HC = S.pack.healthCover;
  const fireAge = t.age, prep = Math.max(Math.ceil(i.age), fireAge - 3);
  const steps = [];
  const step = (when, title, ...detail) => steps.push(h("li", {}, h("span", { class: "when" }, when), h("div", {}, h("strong", {}, title), detail.length ? h("p", { class: "small" }, ...detail) : null)));

  const now = i.monthlySip + i.epfMonthly;
  const reachable = t.gap < 0 && t.requiredMonthlySip != null && t.requiredMonthlySip <= 1.5 * now;
  step("This year", reachable ? `Invest ${inr(t.requiredMonthlySip)} a month` : `Keep investing ${inr(now)} a month`,
    reachable ? `That's what reaching ${fireAge} takes (you invest ${inr(now)} now). `
      : t.gap < 0 ? `On its own this gets you to about ${age1(r.earliestAge)} (3 in 4 chance by ${age1(r.chance.likelyAge)}). To get closer to ${fireAge}, combine the options above. `
      : "You're on track. ",
    `Raise it ${pct(r.params.stepUp, 0)} every year, e.g. with each raise. Until ${prep}, keep about ${S.pack.assetClasses.map((a) => `${Math.round(a.targetBeforeFire * 100)}% ${a.label.toLowerCase()}`).filter((x) => !x.startsWith("0%")).join(", ")}.`);
  const efTarget = A["emergency.months"] * (r.derived.monthlyExpenses + r.derived.monthlyEmi);
  step("This year", `Keep ${inrShort(efTarget)} as an emergency fund`,
    `${A["emergency.months"]} months of spending and EMIs, in a sweep FD or liquid fund, outside your FIRE investments.`,
    i.detailed.holdings ? ` You have ${inrShort(i.emergencyFund)}.` : "");
  if (HC && !(u.insurance?.healthCover >= HC.recommendedCover))
    step("This year", `Buy your own family health cover of ${inrShort(HC.recommendedCover)} or more`,
      `Employer cover ends when you stop working, and cover is much harder to get later or with an illness. Roughly ${inr(w?.health?.premiumNow ?? 0)} a year at your age.`);
  for (const x of i.properties || []) if (x.sale) step(`At ${Math.floor(x.sale.atAge)}`, `Sell ${x.label}`,
    `Expect about ${inrShort(x.sale.net)} after costs and tax. Put it straight into the cash and debt buckets, not a lump-sum equity bet.`);
  for (const l of i.locked || []) step(`At ${l.unlock.age}`, `${l.label} unlocks`, l.unlock.note || "");
  if (w?.buckets && prep < fireAge)
    step(`From ${prep}`, "Build the buckets over three years",
      `Move new money and some equity gains into debt and cash so that by ${fireAge} you hold about ${inrShort(w.buckets.cash.amount)} in cash (3 years of spending) and ${inrShort(w.buckets.debt.amount)} in debt (the next 5). This protects you if markets fall just as you stop.`);
  if (w) step(`At ${fireAge}`, `Start an SWP of ${inr(w.firstMonthly)} a month`,
    "From the cash bucket (liquid or arbitrage fund). Confirm your health policy is in your own name before leaving your job.");
  step(`Every year after`, "Refill and re-check",
    "Move a year of withdrawals from debt to cash and top up debt from equity, but skip selling equity after a bad year. Raise the SWP with inflation, and re-run this plan.");

  const shown = new Set(["no_health_cover", "emergency_short", "low_confidence"]);
  const icon = { critical: "⛔", warn: "⚠", info: "ℹ" };
  const extra = r.nudges.filter((n) => !shown.has(n.id));
  return card("Your plan, step by step",
    h("ol", { class: "timeline" }, ...steps),
    extra.length ? h("div", { class: "also" }, h("p", { class: "small" }, h("strong", {}, "Also check")),
      h("ul", { class: "nudges" }, ...extra.map((n) => h("li", { class: n.severity },
        h("span", { class: "icon", "aria-hidden": "true" }, icon[n.severity]), h("span", { class: "sr" }, `${n.severity}: `),
        h("span", {}, n.message), n.section ? h("a", { href: `#/refine/${n.section}`, class: "link" }, "Fix") : null)))) : null);
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
      ` of about `, h("strong", {}, inr(w.firstMonthly)), ` in the first year`,
      Math.floor(w.firstAge) > Math.floor(w.startAge) ? ` of withdrawals (from ${Math.floor(w.firstAge)}; money coming in covers the years before)` : "",
      `. It rises with inflation every year. That needs `, h("strong", {}, inrShort(w.corpus)), ` at ${t.age}`,
      Math.abs(w.bucketTotal - w.corpus) / w.corpus > 0.01 ? `, which with the money coming in is ${inrShort(w.bucketTotal)} when withdrawals start,` : "",
      ` split into three buckets:`),
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
    h("p", { class: "small" }, h("strong", {}, "Included in the SWP: "),
      `about ${inr(w.firstTax)} tax in the first year (${pct(w.firstTaxRate)} of withdrawals: interest and debt-fund gains at slab rates, equity gains at 12.5% above ₹1.25 lakh), and `,
      `${inr(w.firstHealthPremium)} for a family health policy once employer cover stops`,
      w.health?.estimated ? h("span", {}, " (an estimate: ", h("a", { href: "#/refine/protection" }, "enter your quote"), ")") : "",
      `. The premium rises with age and medical inflation, so it's a much bigger share later on.`),
    h("p", { class: "small muted" },
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
    h("p", { class: "muted small" }, `Inflation ${pct(p.infl.general)} general, ${pct(p.infl.health)} healthcare, ${pct(p.infl.education)} education. Returns ${pct(p.rPre)} before FIRE, ${pct(p.rPost)} after. SIP step-up ${pct(p.stepUp)} a year. Tax on withdrawals worked out each year (new regime, slabs rising with inflation). Money must last until ${p.planUntilAge}. `,
      h("a", { href: "#/refine/assumptions" }, "Change")),
    marketNote(S.market, p.infl.general));
}

function snapshotsCard() {
  const snaps = S.user.snapshots || [];
  return card("Check-ins",
    h("p", { class: "muted small" }, "Record a check-in every few months to see progress over time. It's saved in your plan file, on your device."),
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
  const toggle = (goNext) => {
    u.sectionsDone = done ? u.sectionsDone.filter((x) => x !== id) : [...u.sectionsDone, id];
    persist();
    const next = goNext && S.result ? nextSection(S.result, id) : null;
    location.hash = next ? `#/refine/${next.id}` : "#/results";
  };
  const upNext = !done && S.result ? nextSection(S.result, id) : null;
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
      done
        ? h("button", { type: "button", class: "btn", onClick: () => toggle(false) }, "Mark as not complete")
        : [upNext ? h("button", { type: "button", class: "btn primary", onClick: () => toggle(true) }, `Done · next: ${upNext.title} →`) : null,
           h("button", { type: "button", class: ["btn", !upNext && "primary"], onClick: () => toggle(false) }, "Done · see result")],
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
// They start from data-from (or 0) and grow to the value, so bars fill in as a page appears.
const clamp01 = (x) => `${Math.max(0, Math.min(1, +x || 0)) * 100}%`;
new MutationObserver(() => {
  const fresh = [...app.querySelectorAll("[data-w]:not([data-done])")];
  for (const el of fresh) { el.dataset.done = "1"; el.style.width = clamp01(el.dataset.from); }
  if (fresh.length) requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const el of fresh) el.style.width = clamp01(el.dataset.w);
  }));
}).observe(app, { childList: true, subtree: true });

/** A sun that rises, a burst of confetti and a short message. Motion is skipped if the user prefers less. */
function celebrate(message) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const colors = ["var(--sun)", "var(--accent)", "var(--series-3)", "var(--series-2)"];
  const bits = calm ? [] : Array.from({ length: 36 }, (_, i) => {
    const el = h("span", { class: "confetti" });
    el.style.setProperty("--x", `${(Math.random() - 0.5) * 520}px`);
    el.style.setProperty("--y", `${-160 - Math.random() * 260}px`);
    el.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
    el.style.setProperty("--d", `${Math.random() * 0.25}s`);
    el.style.background = colors[i % colors.length];
    return el;
  });
  const layer = h("div", { class: "celebrate", role: "status" },
    calm ? null : h("div", { class: "burst" }, h("span", { class: "sun" }), ...bits),
    h("div", { class: "toast" }, h("strong", {}, "🎉 ", message), h("span", {}, " Nice work.")));
  document.body.append(layer);
  setTimeout(() => layer.classList.add("out"), 3200);
  setTimeout(() => layer.remove(), 3800);
}

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
