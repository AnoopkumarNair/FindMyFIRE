import { h, mount } from "./dom.js";
import { control } from "./fields.js";
import { inr, inrShort, pct, age1, ageWhole, yearAtAge } from "./format.js";
import { corpusChart } from "./chart.js";
import { sectionEditor } from "./editors.js";
import { marketNote } from "./market.js";
import { art, questionArt } from "./art.js";
import { openShareDialog } from "./share.js";
import { askCard, aiChip, askNow } from "./ask.js";
import { journey, jar } from "./infographics.js";
import { FEEDBACK } from "./config.js";
import * as ai from "../assistant/client.js";
import * as store from "./store.js";
import { evaluatePlan, evaluate, getPointer, setPointer, ageAt, snapshotOf, withSnapshot, progress } from "../engine/index.js";

const APP_VERSION = "0.10.0";
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
  // (v0.3–0.6 folded PF into "monthly investing"; PF is its own question again, so nothing to do.)
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
    h("span", {}, "Earliest FIRE age ", h("strong", {}, r.earliestAge == null ? "not before " + r.inputs.planUntilAge : `about ${ageWhole(r.earliestAge)}`)),
    h("span", {}, "Corpus needed at ", r.target.age, ": ", h("strong", {}, inrShort(r.target.required))),
    h("span", {}, "Estimate quality ", h("strong", {}, `${r.confidence.score}`), ` (${r.confidence.band.label})`));
}

// ---------------- shell ----------------
function header() {
  const hasPlan = !!S.user?.profile?.birthYearMonth;
  const fileInput = h("input", { type: "file", accept: ".json,application/json", hidden: true,
    onChange: (e) => e.target.files[0] && openFile(e.target.files[0]) });
  return h("header", { class: "top" },
    h("a", { href: "#/", class: "brand", "aria-label": "FindMyFIRE home" }, h("span", { class: "flame", "aria-hidden": "true" }),
      h("span", { class: "wordmark" }, "FindMy", h("b", {}, "FIRE"))),
    h("details", { class: "menu private-chip" },
      h("summary", { "aria-label": "Private: how your data is handled" }, h("span", { "aria-hidden": "true" }, "🔒"), h("span", { class: "lbl" }, "Private")),
      h("div", { class: "menu-body private-body" },
        h("strong", {}, "Your numbers stay on this device"),
        h("p", {}, "Everything is calculated in your browser. Nothing you enter is sent to any server, and there's no account or tracking. Your plan is saved in this browser, or in a file you download."),
        h("p", {}, "The optional AI assistant runs on this device too. Downloading it (from our model host or Hugging Face) sends nothing about you or your plan."))),
    h("nav", {},
      aiChip(),
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
    h("p", { class: "muted" }, `A planning tool, not investment, tax or legal advice. Rules ${S.pack?.packId}.${S.pack?.packVersion}, tax year 2026-27, last checked ${S.pack?.verifiedOn || "—"}. App v${APP_VERSION} (build ${BUILD}). `,
      h("a", { href: "#/sources" }, "Sources"), " · ",
      h("a", { href: "https://github.com/AnoopkumarNair/FindMyFIRE", rel: "noopener" }, "Source code")));
}

/** Where the rules and rates come from: official sources, what each supports, when it was checked. */
function sourcesView() {
  const P = S.pack, list = P.sources || [];
  const date = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
  // What each source supports in this plan, from the rules that cite it.
  const uses = {};
  const cite = (label, o) => (o?.sourceIds || []).forEach((id) => (uses[id] ||= []).push(label));
  cite("Income tax", P.incomeTax);
  cite("Property capital gains", P.property);
  for (const t of P.taxTreatments) cite(`Tax on ${(t.label || t.id).toLowerCase()}`, t);
  for (const i of P.instruments) cite(i.label, i);
  for (const a of P.assumptions) cite(a.label, a);
  return h("section", { class: "sources-page" },
    h("h1", { tabindex: -1 }, "Sources"),
    h("p", { class: "lede" }, `The tax rules and rates in this planner come from these official sources. They were last checked on ${date(P.verifiedOn)}, for tax year 2026-27.`),
    h("ul", { class: "sources" }, ...list.map((x) => h("li", {},
      h("a", { href: x.url, rel: "noopener noreferrer", target: "_blank" }, x.title),
      h("small", { class: "muted" }, ` · ${x.publisher}`),
      x.covers ? h("p", { class: "small" }, x.covers) : null,
      uses[x.id]?.length ? h("p", { class: "muted small" }, `Used for: ${[...new Set(uses[x.id])].join(", ")}`) : null,
      x.checkedOn ? h("p", { class: "muted tiny" }, `Checked ${date(x.checkedOn)}`) : null))),
    h("h2", {}, "What isn't from an official source"),
    h("ul", {},
      h("li", {}, "Future returns, inflation and market ups and downs are assumptions, not forecasts. You can see and change every one under Assumptions."),
      h("li", {}, "Health insurance premiums by age are indicative figures for a family floater, not a quote. Enter your own quote under Insurance for a better answer."),
      h("li", {}, "Property price growth is your own figure, with a suggested default. Check your city in the RBI House Price Index or NHB RESIDEX.")),
    h("p", { class: "muted small" }, "A planning tool, not investment, tax or legal advice. If a rule has changed since the date above, the plan won't reflect it until the rules are updated."),
    h("p", {}, h("a", { href: S.user?.profile?.birthYearMonth ? "#/results" : "#/", class: "btn" }, "Back")));
}

function route() {
  const [, view, arg] = (location.hash || "#/").split("/");
  let body;
  if (!S.user?.profile?.birthYearMonth && view && view !== "quick" && view !== "sources") { location.hash = "#/"; return; }
  if (view === "quick") body = quickView(Number(arg) || 0);
  else if (view === "results") body = arg === "full" ? resultsView() : simpleView();
  else if (view === "refine") body = refineView(arg);
  else if (view === "sources") body = sourcesView();
  else body = welcomeView();
  const key = `${view || "home"}/${arg || ""}`;
  const changed = key !== S.lastKey;
  document.body.dataset.view = view || "home";
  S.lastKey = key;
  mount(app, header(), h("main", { class: changed ? "enter" : "" }, body), footer());
  drawLive();
  if (changed) { window.scrollTo({ top: 0, behavior: "instant" }); countUp(app); }
  if (changed && document.body.dataset.view === "home") requestAnimationFrame(() => revealOnScroll(app));
  const focusable = app.querySelector("main [autofocus], main h1");
  if (focusable) focusable.focus({ preventScroll: true });
}

// ---------------- welcome ----------------
// Questions most people see (follow-ups like NPS contributions only appear when they apply).
const quickCount = () => S.pack.questionFlow.quick.questions.filter((q) => evaluate(q.showIf, {})).length;
function welcomeView() {
  const working = S.user?.profile?.birthYearMonth ? S.user : null;
  const n = quickCount();
  const start = () => { S.user = store.newUserFile(S.pack, APP_VERSION); location.hash = "#/quick/0"; };
  const cta = working
    ? [h("a", { href: "#/results", class: "btn primary big" }, "Continue your plan →"),
       h("a", { href: "#/quick/0", class: "btn big ghost" }, "Change my answers")]
    : [h("button", { type: "button", class: "btn primary big", onClick: start }, "Find my FIRE age →"),
       h("button", { type: "button", class: "btn big ghost", onClick: loadExample }, "See an example")];
  const step = (num, title, text) => h("li", { class: "step" }, h("span", { class: "num" }, num), h("div", {}, h("h3", {}, title), h("p", {}, text)));
  const feature = (ic, title, text) => h("li", { class: "feature" }, h("span", { class: "ficon" }, art(ic)), h("div", {}, h("h3", {}, title), h("p", {}, text)));
  const faq = (q, a) => h("details", { class: "faq" }, h("summary", {}, q), h("p", {}, a));
  const tick = (t) => h("li", {}, h("span", { class: "tick", "aria-hidden": "true" }, "✓"), t);
  return h("div", { class: "landing" },
    h("section", { class: "landing-hero" },
      h("div", { class: "hero-copy" },
        h("div", { class: "hero-tags" },
          h("p", { class: "eyebrow" }, "A FIRE planner made for India"),
          h("span", { class: "new-pill" }, h("span", { class: "spark", "aria-hidden": "true" }, "✦"), " New: private AI on laptops")),
        h("h1", { tabindex: -1 }, "Find out when work becomes ", h("em", {}, "optional"), "."),
        h("p", { class: "lede" }, `FIRE (Financial Independence, Retire Early) is when your investments can pay your bills for life. Answer ${n} questions to see the age you could get there, how likely it is, and your plan.`),
        h("div", { class: "cta" }, ...cta),
        h("div", { class: "privacy-card" },
          h("span", { class: "privacy-art" }, art("lock")),
          h("div", {},
            h("strong", {}, "Private by design"),
            h("ul", { class: "ticks" },
              tick("Calculated on your device, never on a server"),
              tick("No sign-up, no account"),
              tick("Your numbers are never sent or tracked"))))),
      heroDemo(),
      embers()),

    h("section", { class: "band two-col" },
      h("div", {},
        h("h2", {}, "How it works"),
        h("ol", { class: "steps" },
          step("1", "Enter the basics", "Age, pay, spending, savings. Round numbers are fine."),
          step("2", "See your FIRE age", "And how sure it is, tested against 10,000 simulated market histories."),
          step("3", "Get your plan", "What to invest now, how to build a cash cushion, what to withdraw later."))),
      h("div", {},
        h("h2", {}, "What it counts that others leave out"),
        h("ul", { class: "features" },
          h("li", { class: "feature featured" }, h("span", { class: "ficon" }, art("ask")),
            h("div", {}, h("h3", {}, "Ask about your plan ", h("span", { class: "new-pill small" }, "New")),
              h("p", {}, "“Why 53?” “What if I invest ₹10k more?” Answers come from your own numbers. On a laptop or desktop, an optional AI puts them into words, running privately inside your browser."))),
          feature("pillars", "EPF, PPF and NPS", "Including locked money and when it unlocks."),
          feature("house", "Your property", "Rent, upkeep, or a sale in any year."),
          feature("health", "Health cover after work", "Premiums that rise once your employer's cover ends."),
          feature("receipt", "Tax on withdrawals", "Worked out every year, new regime."),
          feature("gift", "Money coming in", "Gratuity, policy payouts, inheritance."),
          feature("umbrella", "A crash at the worst time", "Markets falling just as you stop.")))),

    h("section", { class: "band" },
      h("h2", {}, "Questions people ask"),
      h("div", { class: "faqs" },
        faq("Do I need exact numbers?", "No. Start rough and mark answers as estimates. The app shows how accurate the result is and which one section to fill in next."),
        faq("Where is my data stored?", "Only in this browser on this device. Download it as a file (optionally locked with a passphrase) to keep it or move it to another device. Nothing is uploaded."),
        faq("I don't want to retire at 40. Is this still useful?", "Yes. FIRE is about having the choice: the same plan shows whether you're on track for 60, what a career break costs, or how much a cheaper city helps."),
        faq("Is there AI? Does it see my numbers?", "It's optional. On a laptop or desktop you can add an AI that runs entirely inside your browser (a one-time 3.1 GB download). It only rewords the planner's own numbers, every number is checked before it's shown, and nothing you type leaves your device. Phones get the same answers without the AI wording."),
        faq("Is this financial advice?", "No. It's a planning tool that does the maths carefully and shows its working. Check big decisions with a SEBI-registered adviser."),
        faq("Where do the tax rules and rates come from?", "From official sources: the Budget, the Income Tax Department, PFRDA, EPFO and the Ministry of Finance, checked for FY2026-27. The Sources page (linked at the bottom of every page) lists each one and when it was last checked.")),
      h("div", { class: "closing" },
        h("p", {}, h("strong", {}, "Two minutes to your number.")),
        working ? h("a", { href: "#/results", class: "btn primary" }, "Continue your plan →")
          : h("button", { type: "button", class: "btn primary", onClick: start }, "Find my FIRE age →"))));
}

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A few warm specks drifting up behind the hero, like a sunrise. Decoration only. */
function embers(count = 9) {
  if (calm()) return null;
  const box = h("div", { class: "embers", "aria-hidden": "true" });
  for (let i = 0; i < count; i++) {
    const e = h("span", { class: "ember" });
    e.style.setProperty("--x", `${6 + Math.random() * 88}%`);
    e.style.setProperty("--s", `${3 + Math.random() * 4}px`);
    e.style.setProperty("--d", `${10 + Math.random() * 8}s`);
    e.style.setProperty("--delay", `${-Math.random() * 16}s`);
    e.style.setProperty("--drift", `${(Math.random() - 0.5) * 60}px`);
    box.append(e);
  }
  return box;
}

/** Sections and tiles rise gently into view as you scroll (once each). */
function revealOnScroll(root) {
  if (calm() || !("IntersectionObserver" in window)) return;
  const items = root.querySelectorAll(".band, .feature, .step, .faq, .closing");
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  items.forEach((el, i) => {
    if (el.getBoundingClientRect().top < innerHeight) return; // already on screen: no hiding it
    el.classList.add("reveal");
    el.style.setProperty("--i", String(i % 6));
    io.observe(el);
  });
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
        calm() ? null : h("svg:circle", { r: 4, class: "demo-tracer" },
          h("svg:animateMotion", { dur: "9s", begin: "2.2s", repeatCount: "indefinite", path: d, calcMode: "linear" })),
        h("svg:text", { x: pad, y: H - 6, class: "demo-tick" }, "35"),
        h("svg:text", { x: sx - 8, y: H - 6, class: "demo-tick" }, "53"),
        h("svg:text", { x: W - pad - 14, y: H - 6, class: "demo-tick" }, "90")),
      h("div", { class: "demo-chips" },
        h("span", { class: "chip-pop c1" }, h("b", {}, "53"), " could stop working"),
        h("span", { class: "chip-pop c2" }, h("b", {}, "₹4.9 Cr"), " needed by then"),
        h("span", { class: "chip-pop c3" }, h("b", {}, "90%"), " of market paths last by 61"))));
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
  // PF is roughly 12% of basic from you and 12% from your employer; basic is often ~40–50% of take-home.
  "/quick/epfMonthly": (u) => Math.round(((u.quick.takeHomeMonthly || 0) * 0.12) / 100) * 100,
};

function quickView(i) {
  if (!S.user) S.user = store.newUserFile(S.pack, APP_VERSION);
  const u = S.user;
  const qs = S.pack.questionFlow.quick.questions.filter((q) => evaluate(q.showIf, u));
  i = Math.min(Math.max(0, i), qs.length - 1);
  const q = qs[i];
  // A group asks several short questions (the three ages) on one screen.
  const fields = q.input === "group" ? q.fields : [q];
  const prov = (u.provenance ||= {});
  const err = h("p", { class: "error", role: "alert" });

  const setter = (f) => (v) => {
    setPointer(u, f.bind, v);
    if (f.input === "currency") prov[f.bind] ||= "estimate";
    else prov[f.bind] = "exact";
    save();
  };
  const validOne = (f) => {
    // A follow-up box ("each month" once there's a balance) only needs an answer when it applies.
    if (!evaluate(f.showIf, u)) return null;
    const v = getPointer(u, f.bind);
    const who = fields.length > 1 ? `${f.prompt}: ` : "";
    if (f.input === "multiselect") return v?.length ? null : "Pick at least one.";
    if (v == null || v === "") return f.defaultFrom ? null : fields.length > 1 ? `${who}${f.input === "currency" ? "enter an amount (0 if none)" : "please fill this in"}.` : q.noneLabel ? `Enter an amount, or press "${q.noneLabel}".` : "Please answer, or use a rough number.";
    if (f.input === "yearMonth" || f.input === "age") {
      const a = ageAt(v, new Date());
      if (f.input === "age") return a < f.min || a >= f.max + 1 ? `${who}enter an age from ${f.min} to ${f.max}.` : null;
      return a < 16 || a > 90 ? "That birth date gives an age outside 16–90." : null;
    }
    if (f.min != null && v < f.min) return `${who}at least ${f.min}.`;
    if (f.max != null && v > f.max) return `${who}at most ${f.max}.`;
    if (f.bind === "/plan/fireTargetAge" && u.profile.birthYearMonth && v <= ageAt(u.profile.birthYearMonth, new Date()))
      return "Pick a stopping age later than your current age.";
    if (f.bind === "/plan/planUntilAge" && u.plan.fireTargetAge && v <= u.plan.fireTargetAge)
      return `Pick an age after your FIRE age (${u.plan.fireTargetAge}).`;
    return null;
  };
  const valid = () => {
    for (const f of fields) { const e = validOne(f); if (e) return e.charAt(0).toUpperCase() + e.slice(1); }
    return null;
  };
  const next = () => {
    const e = valid();
    if (e) { err.textContent = e; return; }
    for (const f of fields) {
      if (!evaluate(f.showIf, u)) setPointer(u, f.bind, undefined);
      else if (f.defaultFrom && getPointer(u, f.bind) == null) {
        // Skipped: keep the rules-pack default and mark it as such (lowers confidence a little).
        setPointer(u, f.bind, defaultOf(f));
        prov[f.bind] = "default";
        persist();
      }
    }
    // This answer may switch a follow-up question on (or off), so look again.
    const now = S.pack.questionFlow.quick.questions.filter((x) => evaluate(x.showIf, u));
    const at = now.indexOf(q);
    if (at + 1 < now.length) location.hash = `#/quick/${at + 1}`;
    else location.hash = "#/results";
  };

  const defaultOf = (x) => S.pack.assumptions.find((a) => a.id === x.defaultFrom)?.value;
  const controlFor = (f, extra = {}) => {
    const value = getPointer(u, f.bind);
    // No grey "0" in an empty money box: it looks answered when it isn't. "None" buttons answer 0.
    const opts = { autofocus: f === fields[0], options: f.options, min: f.min, max: f.max, exclusive: ["none"],
      placeholder: f.defaultFrom ? String(defaultOf(f)) : f.input === "currency" ? "" : undefined, ...extra };
    return f.input === "age"
      ? control("integer", value ? Math.floor(ageAt(value, new Date())) : undefined, (a) => setter(f)(a == null ? undefined : birthMonthForAge(a, value)), opts)
      : control(f.input === "integer" ? "integer" : f.input, value, setter(f), opts);
  };
  const ctl = fields.length === 1 ? controlFor(q)
    : h("div", { class: ["field-group", `cols-${fields.length}`] }, ...fields.map((f) => {
      const id = `f-${f.id.replace(/\W/g, "-")}`, hid = `${id}-help`;
      return h("div", { class: "group-field" },
        h("label", { for: id }, f.prompt),
        controlFor(f, { id, describedBy: f.help ? hid : undefined }),
        // Side by side, so the hints stay short; the group's own help covers the rest.
        f.help ? h("span", { class: "sr-only", id: hid }, f.help) : null);
    }));
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
  return h("section", { class: ["wizard", dir], onKeydown: (e) => {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
    e.preventDefault();
    // In a group, Enter moves to the next empty box; on the last one it goes on.
    const boxes = [...e.currentTarget.querySelectorAll(".answer input")];
    const later = boxes.slice(boxes.indexOf(e.target) + 1).find((b) => b.value === "");
    if (later) { later.focus(); return; }
    e.target.blur(); next();
  } },
    h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": qs.length, "aria-valuenow": i + 1 },
      h("span", { class: "bar" }, h("span", { class: "fill", "data-w": (i + 1) / qs.length, "data-from": fromW })),
      h("span", { class: "muted" }, `Question ${i + 1} of ${qs.length}`)),
    h("div", { class: "q-art" }, art(questionArt[q.id])),
    h("h1", { tabindex: -1 }, q.prompt),
    q.help ? h("p", { class: "help" }, q.help) : null,
    h("div", { class: "answer" }, ctl),
    certainty,
    fields.length === 1 && q.defaultFrom ? h("p", { class: "muted small" }, `Leave blank to use ${defaultOf(q)}.`) : null,
    q.impactHint ? h("p", { class: "impact" }, q.impactHint) : null,
    err,
    h("div", { class: "wizard-nav" },
      i > 0 ? h("a", { href: `#/quick/${i - 1}`, class: "btn ghost" }, "Back") : h("span"),
      q.noneLabel ? h("button", { type: "button", class: "btn ghost", onClick: () => {
        // "No loans", "I don't have NPS": every box is 0 (or not applicable), stated not guessed.
        for (const f of fields) {
          setPointer(u, f.bind, f.input === "currency" ? 0 : undefined);
          if (f.input === "currency") prov[f.bind] = "exact";
        }
        persist(); next();
      } }, q.noneLabel) : null,
      q.allowDontKnow && DONT_KNOW[q.bind] ? h("button", { type: "button", class: "btn ghost", onClick: () => {
        setPointer(u, q.bind, DONT_KNOW[q.bind](u)); prov[q.bind] = "default"; persist(); next();
      } }, "I don't know") : null,
      h("button", { type: "button", class: "btn primary", onClick: next }, i + 1 < qs.length ? "Next" : "See my result")),
    live);
}

// ---------------- results ----------------
// ---------------- simple results (the default) ----------------
// One screen a non-financial person can take in: when, how sure, what to do. Everything else is
// one tap away under "See the full plan".
const SECTION_MINUTES = { expenses: 5, holdings: 5, goals: 3, inflows: 2, property: 3, family: 2, income: 3, loans: 2, protection: 2, retirement: 2, assumptions: 2 };

function simpleView() {
  const r = S.result;
  if (!r) return resultsView();
  const u = S.user, t = r.target, L = r.levers, E = r.earliestAge, i = r.inputs;
  const reached = E != null, ahead = reached && E <= t.age;
  const tone = !reached ? "far" : ahead ? "good" : E - t.age <= 3 ? "close" : "far";
  const verdict = !reached
    ? "With today's numbers your savings don't stretch far enough yet. That's common at this stage, and small changes add up quickly."
    : ahead ? `Good news: on today's path you could stop working around ${ageWhole(E)}, ahead of your goal of ${t.age}.`
    : tone === "close" ? `You're close. On today's path you could stop working around ${ageWhole(E)}, just after your goal of ${t.age}.`
    : `On today's path you could stop working around ${ageWhole(E)}. Your goal of ${t.age} needs a few changes, and the steps below show how.`;
  const quick = r.confidence.score < 75;
  const range = r.range.from != null && r.range.to != null ? `${Math.floor(r.range.from)}–${Math.ceil(r.range.to)}` : null;

  // How much one more ₹10,000 a month is worth, from the plan's own sensitivity.
  const inv = r.sensitivity.find((x) => x.id === "investing");
  const yearsPer10k = inv && i.monthlySip > 0 && inv.hi.ageDelta != null ? (Math.abs(inv.hi.ageDelta) / (0.2 * i.monthlySip)) * 10000 : null;

  // Steps a person can actually take, each with where it gets them. (The exact amounts that close
  // the whole gap on their own are in the full plan; alone they're often unrealistic.)
  const spend = r.sensitivity.find((x) => x.id === "spending");
  const surplus = Math.max(0, r.derived.monthlySurplus ?? 0);
  const ageAfter = (delta) => (E == null || delta == null ? null : Math.max(i.age, E + delta));
  const withSurplus = yearsPer10k && surplus >= 1000 ? ageAfter(-(yearsPer10k * surplus) / 10000) : null;
  const ways = L?.onTrack
    ? [
        [art("sunrise"), `Stop earlier, around ${ageWhole(L.retireAt)}`, "if you'd like to: the money would still last."],
        L.spendAfterFire && [art("basket"), "Or spend more after you stop", `up to ${inr(L.spendAfterFire.to)} a month in today's money.`],
      ]
    : [
        withSurplus != null && [art("seedling"), `Invest the ${inr(Math.round(surplus / 500) * 500)} you have left over each month`, `That alone brings it to about ${ageWhole(withSurplus)}.`],
        spend?.lo.ageDelta != null && E != null && [art("basket"), "Plan to spend 10% less after you stop", `A simpler city or no rent by then: about ${ageWhole(ageAfter(spend.lo.ageDelta))}.`],
        inv?.hi.ageDelta != null && E != null && i.monthlySip > 0 && [art("pillars"), "Raise your monthly investing by a fifth", `${inr(Math.round((0.2 * i.monthlySip) / 500) * 500)} more a month: about ${ageWhole(ageAfter(inv.hi.ageDelta))}.`],
      ];
  // Not reachable yet: the first moves, in plain words, without numbers that can't be met.
  if (!L?.onTrack && !ways.some(Boolean)) ways.push(
    [art("basket"), "Free up some money each month", (r.derived.monthlySurplus ?? 0) < 0 ? `Right now about ${inr(-r.derived.monthlySurplus)} more goes out than comes in. Closing that is the first step.` : "Look at the biggest monthly costs first: rent, EMIs, eating out."],
    [art("seedling"), "Start investing a fixed amount every month", "Even ₹2,000 a month. Starting matters more than the amount."],
    [art("sunrise"), "Plan to work a few years longer", "Each extra year adds savings and shortens the years the money must last."]);
  const efTarget = i.assumptions["emergency.months"] * (r.derived.monthlyExpenses + r.derived.monthlyEmi);
  const thisMonth = [
    L?.investMore != null && !L.onTrack && i.takeHomeMonthly > 0 && L.investMore <= Math.max(0, r.derived.monthlySurplus ?? 0)
      ? `Start an extra SIP of ${inr(Math.round(L.investMore / 500) * 500)} a month: you have about that much left over each month.`
      : i.monthlySip > 0 ? `Keep investing ${inr(i.monthlySip)} a month, and raise it each year with your salary.`
      : (r.derived.monthlySurplus ?? 0) > 0 ? `Set up a monthly SIP with part of the ${inr(r.derived.monthlySurplus)} left over each month.`
      : "Write down where the money goes this month: it's the quickest way to find savings.",
    (i.emergencyFund || 0) >= efTarget ? `Keep ${inrShort(efTarget)} aside for emergencies, separate from your investments.` : `Build an emergency fund of ${inrShort(efTarget)} (6 months of spending) before anything else.`,
    !(u.insurance?.healthCover >= (S.pack.healthCover?.recommendedCover ?? 1500000)) && "Check you have your own family health insurance, not just your employer's.",
  ].filter(Boolean).slice(0, 3);
  const todo = [...r.confidence.sections].filter((x) => !x.done && x.potential > 0).sort((a, b) => b.potential - a.potential).slice(0, 2);

  return h("div", { class: "results simple" },
    h("section", { class: ["hero", "simple-hero", tone] },
      embers(5),
      h("p", { class: "eyebrow" }, "Your FIRE plan"),
      h("h1", { tabindex: -1, class: "big-age" }, reached
        ? [h("span", { class: "unit" }, "Around "), h("span", { "data-count": Math.round(E), "data-dec": 0 }, ageWhole(E))]
        : "Not yet"),
      h("p", { class: "verdict-line" }, verdict),
      quick && range ? h("p", { class: "muted small" }, `A first estimate from your quick answers: likely ${range}. The more you add, the sharper it gets.`) : null,
      journey({ age: i.age, goal: t.age, stop: E, until: i.planUntilAge })),
    h("section", { class: "card simple-numbers" },
      h("div", { class: "big3" },
        h("div", {}, h("small", {}, "Work optional"), h("strong", {}, reached ? `around ${ageWhole(E)}` : "not yet")),
        h("div", {}, h("small", {}, "Your goal"), h("strong", {}, String(t.age))),
        h("div", { class: "jar-box" }, jar(t.funded), h("small", {}, `of what ${t.age} needs`))),
      !ahead && yearsPer10k && yearsPer10k >= 0.3 ? h("p", { class: "cheer" }, art("seedling"),
        `Every extra ₹10,000 a month you invest brings this about ${yearsPer10k >= 1.5 ? `${Math.round(yearsPer10k)} years` : `${age1(yearsPer10k)} year${yearsPer10k >= 1.05 ? "s" : ""}`} closer.`) : null),
    h("section", { class: "card simple-ways" },
      h("h2", {}, L?.onTrack ? "You have room" : "Ways to bring it closer"),
      h("p", { class: "muted small" }, L?.onTrack ? "You're ahead. Here's what that gives you." : `Each one helps on its own, and together they add up. To reach ${t.age} exactly, the full plan shows what it takes.`),
      h("ul", { class: "ways" }, ...ways.filter(Boolean).map(([pic, a, b]) => h("li", {}, pic, h("div", {}, h("strong", {}, a), h("p", { class: "small" }, b)))))),
    h("section", { class: "card simple-month" },
      h("h2", {}, "This month"),
      h("ol", { class: "steps" }, ...thisMonth.map((x) => h("li", {}, x)))),
    quick && todo.length ? h("section", { class: "card simple-sharpen" },
      h("h2", {}, "Make this answer more reliable"),
      h("div", { class: "meter-row" },
        h("span", { class: "small" }, `Plan detail ${r.confidence.score}%`),
        h("div", { class: "meter", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": r.confidence.score, "aria-label": "Plan detail" },
          h("span", { class: "fill", "data-w": r.confidence.score / 100 }))),
      h("p", { class: "small" }, "Right now this rests on a few rough answers, so it could be a few years out either way. These two sharpen it most:"),
      h("ul", { class: "sharpen" }, ...todo.map((x) => h("li", {},
        h("a", { href: `#/refine/${x.id}`, class: "btn small" }, `${x.title} →`),
        h("span", { class: "muted small" }, ` about ${SECTION_MINUTES[x.id] ?? 3} minutes`)))),
      h("p", { class: "muted tiny" }, "Everything you enter stays on this device.")) : null,
    r.chance.confidentAge != null ? h("section", { class: "card simple-calm" },
      art("umbrella"),
      h("p", {}, h("strong", {}, "Worried about a market crash? "),
        `Markets do fall sometimes. Even if they fall just as you stop, planning to stop around ${ageWhole(r.chance.confidentAge)} kept the money lasting in 9 out of 10 of the market histories we tested.`)) : null,
    askCard({ ...askOptions, compact: true }),
    h("div", { class: "simple-actions" },
      h("button", { type: "button", class: "btn", onClick: () => askNow("Give me the big picture") }, "Explain my result in plain words"),
      h("a", { href: "#/results/full", class: "btn primary" }, "See the full plan →"),
      reached ? h("button", { type: "button", class: "btn ghost share-btn", onClick: () => openShareDialog(r) }, icon("share"), "Share") : null),
    feedbackBox());
}

/** "Was this clear?" and how to reach us. Nothing is sent unless the person chooses to. */
function feedbackBox() {
  const done = h("p", { class: "muted small", hidden: true }, "Thank you! That helps.");
  const body = encodeURIComponent(`\n\n---\nApp ${APP_VERSION} (build ${BUILD}), rules ${S.pack?.packId}.${S.pack?.packVersion}, page ${location.hash || "#/"}, ${navigator.userAgent.match(/(Android|iPhone|iPad|Windows|Mac OS X|Linux)/)?.[0] || "device"}\n(No plan numbers are included.)`);
  const mail = (subject) => FEEDBACK.email ? `mailto:${FEEDBACK.email}?subject=${encodeURIComponent(subject)}&body=${body}` : null;
  const links = (subject) => [
    FEEDBACK.email && h("a", { href: mail(subject), class: "btn small" }, "Email us"),
    FEEDBACK.telegram && h("a", { href: FEEDBACK.telegram, class: "btn small", rel: "noopener", target: "_blank" }, "Message on Telegram"),
    h("a", { href: FEEDBACK.github, class: "link small", rel: "noopener", target: "_blank" }, "Report on GitHub"),
  ].filter(Boolean);
  const more = h("div", { class: "fb-more", hidden: true },
    h("p", { class: "small" }, "Sorry about that. What was confusing? A line or two helps a lot."), h("div", { class: "fb-links" }, ...links("FindMyFIRE: what was unclear")));
  return h("section", { class: "feedback" },
    h("span", { class: "small" }, "Was this clear?"),
    h("button", { type: "button", class: "btn small ghost", onClick: (e) => { e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => (b.disabled = true)); done.hidden = false; } }, "Yes"),
    h("button", { type: "button", class: "btn small ghost", onClick: (e) => { e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => (b.disabled = true)); more.hidden = false; } }, "Not really"),
    done, more);
}

// ---------------- full results ----------------
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
    embers(5),
    h("p", { class: "eyebrow" }, "Earliest you could stop working"),
    h("h1", { tabindex: -1, class: "big-age" }, reached
      ? [h("span", { class: "unit" }, "Around "), h("span", { "data-count": Math.round(r.earliestAge), "data-dec": 0 }, ageWhole(r.earliestAge))]
      : `Not before ${r.inputs.planUntilAge}`),
    reached ? h("p", { class: "sub" }, `In about ${yearAtAge(bym, r.earliestAge)}, with steady returns. `,
      r.range.from != null && r.range.to != null && Math.ceil(r.range.to) - Math.floor(r.range.from) >= 1
        ? `Likely ${Math.floor(r.range.from)}–${Math.ceil(r.range.to)}, allowing for how exact your answers are.`
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
    kpi(`Projected at ${t.age}`, inrShort(t.projected), `From ${inrShort(r.inputs.fireCorpus)} today, plus ${inr(r.inputs.monthlySip)}/month you invest${r.inputs.epfMonthly ? ` and ${inr(r.inputs.epfMonthly)} into PF` : ""}`),
    kpi(t.gap >= 0 ? "Surplus at target" : "Shortfall at target", inrShort(Math.abs(t.gap)), t.gap >= 0 ? "Ahead of plan" : "Gap to close", t.gap >= 0 ? "good" : "warn"),
    kpi(`Paths that last to ${r.inputs.planUntilAge}`, `${Math.round(r.chance.atTarget * 100)}%`,
      `Of ${r.chance.runs.toLocaleString("en-IN")} simulated market histories, if you stop at ${t.age} (±${Math.max(1, Math.round(r.chance.margin * 100))} pt).`, r.chance.atTarget >= 0.75 ? "good" : "warn"));

  return h("div", { class: "results" },
    h("p", { class: "back-simple" }, h("a", { href: "#/results", class: "link" }, "← Back to the simple view")),
    // The decision first: when, how much, and what changes it. Then how to sharpen it, questions,
    // and the detail behind it.
    hero, kpis,
    stressLine(r),
    leversCard(r),
    confidenceCard(r),
    askCard(askOptions),
    sensitivityCard(r),
    actionPlanCard(r),
    card("How your corpus grows and lasts",
      corpusChart(r.timeline, { targetAge: t.age, earliestAge: r.earliestAge }),
      r.depletesAtAge != null && r.depletesAtAge < r.inputs.planUntilAge
        ? h("p", { class: "warn-text" }, `⚠ Retiring at ${t.age} on the current path, the money runs out around age ${Math.floor(r.depletesAtAge)}.`)
        : h("p", { class: "muted" }, `Retiring at ${t.age} on the current path, the money lasts past ${r.inputs.planUntilAge}.`)),
    balanceCard(r),
    scenariosCard(r),
    breakdownCard(r),
    swpCard(r),
    assumptionsSummary(r),
    snapshotsCard());
}

// ---------------- ask about your plan ----------------
const sizeText = (b) => (b >= 1e9 ? `${Math.round(b / 1e8) / 10} GB` : `${Math.round(b / 1e6)} MB`);
const detailedIn = (id) => (S.user.sectionsDone || []).includes(id);
const askOptions = {
  getCtx: () => ({ user: S.user, pack: S.pack, result: S.result, today: new Date() }),
  /** Only changes that map cleanly onto the plan can be applied from an answer. */
  canApply: (ch) => Object.keys(ch).every((k) =>
    k === "fireAge" || k === "dropGoalIds" || k === "returnDelta" || k === "inflationDelta" ||
    ((k === "sipDelta" || k === "sipTotal") && !detailedIn("holdings")) ||
    (k === "expenseDelta" && !detailedIn("expenses"))),
  apply(ch) {
    const u = S.user, p = S.result.params, o = (u.assumptionOverrides ||= {});
    const round = (x) => Math.max(0, Math.round(x));
    if (ch.fireAge != null) u.plan.fireTargetAge = ch.fireAge;
    if (ch.dropGoalIds?.length) u.goals = (u.goals || []).filter((g) => !ch.dropGoalIds.includes(g.id));
    if (ch.returnDelta) { o["return.beforeFire"] = +(p.rPre + ch.returnDelta).toFixed(4); o["return.afterFire"] = +(p.rPost + ch.returnDelta).toFixed(4); }
    if (ch.inflationDelta) o["inflation.general"] = +(p.infl.general + ch.inflationDelta).toFixed(4);
    if (ch.sipTotal != null) u.quick.monthlySip = round(ch.sipTotal);
    else if (ch.sipDelta) u.quick.monthlySip = round((u.quick.monthlySip || 0) + ch.sipDelta);
    if (ch.expenseDelta) u.quick.monthlyExpenses = round((u.quick.monthlyExpenses || 0) + ch.expenseDelta);
    redraw();
  },
  confirmDownload: async (s) => {
    const ok = await dialog((close) => [
      h("h2", {}, "Add the on-device AI (beta)?"),
      h("ul", { class: "ticks" },
        h("li", {}, h("span", { class: "tick" }, "✓"), h("span", {}, `A one-time download of about ${sizeText(s.total)}. Wi-Fi recommended.`)),
        h("li", {}, h("span", { class: "tick" }, "✓"), h("span", {}, `It runs inside this browser. Your questions and numbers never leave this device${s.model.host ? `; the model file itself comes from ${s.model.host}, where its makers publish it` : ""}.`)),
        h("li", {}, h("span", { class: "tick" }, "✓"), h("span", {}, "Ask in your own words and get conversational answers. Every number still comes from the planner and is checked before it's shown, and the plain facts are always one tap away.")),
        h("li", {}, h("span", { class: "tick" }, "!"), h("span", {}, "It's a small model and still in beta: its wording can be off, so trust the numbers and the facts under each answer.")),
        h("li", {}, h("span", { class: "tick" }, "✓"), h("span", {}, "It downloads in the background while you use the app, and carries on after a refresh.")),
        h("li", {}, h("span", { class: "tick" }, "✓"), h("span", {}, `Runs on this device's ${s.device === "GPU" ? "graphics chip" : "processor (slower; a recent laptop or phone works best)"}. Remove it any time to free the space.`))),
      navigator.deviceMemory && navigator.deviceMemory < 8
        ? h("p", { class: "warn-text" }, "⚠ This device reports less than 8 GB of memory. The AI may be slow or fail to start; plain answers will keep working.")
        : null,
      h("p", { class: "muted small" }, `${s.model.name} (${s.model.license}), checked piece by piece against checksums published with this app. Works best on a laptop or a recent phone with 8 GB of memory.`),
      h("div", { class: "dialog-actions" },
        h("button", { type: "button", class: "btn ghost", onClick: () => close(false) }, "Not now"),
        h("button", { type: "button", class: "btn primary", onClick: () => close(true) }, "Download"))]);
    if (ok) ai.start(s.model.id);
  },
  confirmRemove: async (s) => {
    if (await confirmBox(`Remove the AI model from this browser? It frees about ${sizeText(s.total)}. Plain answers keep working.`)) ai.remove();
  },
};

/**
 * How sure the headline age is. The steady-returns age is roughly a coin flip; the simulated
 * ages show what it takes for most market histories to last. One of them is named the planning age.
 */
function chanceStrip(r) {
  const c = r.chance, until = r.inputs.planUntilAge;
  const pill = (label, age, cls, badge) => h("span", { class: ["pill", cls] }, badge ? h("em", { class: "badge" }, badge) : null,
    h("strong", {}, age == null ? `after ${until}` : ageWhole(age)), label);
  return h("div", { class: "chance" },
    h("p", { class: "muted small" }, `How sure is that? Markets don't return the same every year, and a bad run early in retirement hurts most. Stopping at each age, how many of ${c.runs.toLocaleString("en-IN")} simulated market histories last to ${until}:`),
    h("div", { class: "pills" },
      pill("steady returns: about half of the simulated paths last", r.earliestAge),
      pill("75% of simulated paths last", c.likelyAge, "mid"),
      pill("90% of simulated paths last", c.confidentAge, "safe", "Safe planning age")),
    h("p", { class: "muted tiny" }, "Simulations use the assumed returns and ups and downs under Assumptions: they show how sensitive the plan is, not a guarantee."));
}

/** Which inputs move the FIRE age most, each changed on its own by a realistic amount. */
function sensitivityCard(r) {
  const rows = r.sensitivity;
  if (!rows?.length || r.earliestAge == null) return null;
  const years = (d) => (d == null ? "not reached" : Math.abs(d) < 0.05 ? "no change" : `${d > 0 ? "+" : "−"}${age1(Math.abs(d))} yr`);
  const money = (d) => `${d > 0 ? "+" : "−"}${inrShort(Math.abs(d))}`;
  const max = Math.max(1, ...rows.flatMap((x) => [Math.abs(x.lo.ageDelta ?? 0), Math.abs(x.hi.ageDelta ?? 0)]));
  const bar = (d, side) => h("span", { class: ["tbar", side, d > 0 ? "later" : "sooner"], "data-w": Math.min(1, Math.abs(d ?? max) / max) });
  return card("What moves your FIRE age most",
    h("p", { class: "muted small" }, `Each input changed on its own, with steady returns, from today's earliest age of about ${ageWhole(r.earliestAge)}. Left is the lower setting, right the higher; green brings FIRE sooner, red pushes it later.`),
    h("ul", { class: "tornado" }, ...rows.map((x) => {
      const ageMoves = Math.abs(x.lo.ageDelta ?? 1) >= 0.05 || Math.abs(x.hi.ageDelta ?? 1) >= 0.05;
      return h("li", {},
        h("strong", {}, x.label),
        ageMoves
          ? h("div", { class: "tbars" },
              h("span", { class: "tside lo" }, h("small", {}, `${x.lo.label}: ${years(x.lo.ageDelta)}`), bar(x.lo.ageDelta, "lo")),
              h("span", { class: "tside hi" }, bar(x.hi.ageDelta, "hi"), h("small", {}, `${x.hi.label}: ${years(x.hi.ageDelta)}`)))
          : h("p", { class: "small muted" }, `Doesn't change the earliest age. Money needed at your target: ${money(x.lo.requiredDelta)} if ${x.lo.label}, ${money(x.hi.requiredDelta)} if ${x.hi.label}.`));
    })));
}

/**
 * The one stress case worth a headline: markets fall just as you stop. Everything else about the
 * future is uncertain; this is the risk that hurts most and can be planned for.
 */
function stressLine(r) {
  const s = r.scenarios.find((x) => x.id === "crash_at_fire");
  if (!s || r.earliestAge == null) return null;
  const later = s.earliestAge == null ? null : s.earliestAge - r.earliestAge;
  return h("section", { class: "card stress" },
    h("h2", {}, "What if retirement starts badly?"),
    h("p", {}, "If markets fall 30% in your first year after stopping, ",
      s.earliestAge == null ? h("strong", {}, `the money wouldn't last to ${r.inputs.planUntilAge} at any age`)
        : later < 0.5 ? h("strong", {}, "your earliest age barely moves") : [h("strong", {}, `your earliest age moves from about ${ageWhole(r.earliestAge)} to about ${ageWhole(s.earliestAge)}`), ` (about ${Math.round(later)} year${Math.round(later) === 1 ? "" : "s"} later)`],
      ". ",
      r.chance.confidentAge != null ? `The safe planning age of about ${ageWhole(r.chance.confidentAge)} already allows for bad starts like this. ` : "",
      "Holding 3 years of withdrawals in cash and 5 in debt when you stop (see Living off your corpus) is what lets you ride it out without selling equity at the bottom."));
}

function leversCard(r) {
  const L = r.levers, t = r.target, now = r.inputs.monthlySip;
  if (!L) return null;
  if (L.onTrack) {
    return card("You have room",
      h("ul", { class: "levers" },
        h("li", {}, h("strong", {}, `Stop at about ${ageWhole(L.retireAt)}`), ` instead of ${t.age} (steady returns; about ${ageWhole(r.chance.confidentAge)} for 90% of simulated paths to last).`),
        L.spendAfterFire && h("li", {}, h("strong", {}, `Spend up to ${inr(L.spendAfterFire.to)} a month`), ` after FIRE (today's money) instead of ${inr(L.spendAfterFire.from)}.`)));
  }
  const items = [
    L.investMore != null && h("li", {}, h("strong", {}, `Invest ${inr(L.investMore)} more a month`),
      ` from your pay (${inr(now + L.investMore)} in total, not counting PF), increasing ${pct(r.params.stepUp, 0)} each year.`),
    L.spendAfterFire && h("li", {}, h("strong", {}, `Plan to live on ${inr(L.spendAfterFire.to)} a month`),
      ` after FIRE (today's money) instead of ${inr(L.spendAfterFire.from)}. A cheaper city, or no rent or EMIs by then, can do this.`),
    L.retireAt != null && h("li", {}, h("strong", {}, `Stop at about ${ageWhole(L.retireAt)}`), ` instead of ${t.age} (steady returns). For 90% of simulated paths to last: about ${ageWhole(r.chance.confidentAge)}.`),
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
  const locked = (r.inputs.locked || []).map((l) => `${l.label} unlocks at ${Math.floor(l.unlock.age)}`).join("; ");
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

/** "Using your details for X; quick answers for Y": which inputs the result is built from right now. */
function usingLine(c) {
  const name = { expenses: "spending", holdings: "investments", income: "income", loans: "loans" };
  const withQuick = S.pack.questionFlow.refine.filter((s) => s.replacesQuick?.length);
  const detailed = withQuick.filter((s) => (S.user.sectionsDone || []).includes(s.id)).map((s) => name[s.id] || s.title.toLowerCase());
  const quick = withQuick.filter((s) => !(S.user.sectionsDone || []).includes(s.id)).map((s) => name[s.id] || s.title.toLowerCase());
  if (!detailed.length) return null;
  return h("p", { class: "small using" },
    h("strong", {}, "Using your details for: "), detailed.join(", "), ". ",
    quick.length ? [h("strong", {}, "Quick answers for: "), quick.join(", "), "."] : "No quick guesses left.");
}

function confidenceCard(r) {
  const c = r.confidence;
  const done = c.sections.filter((x) => x.done).length;
  const todo = [...c.sections].filter((x) => !x.done && x.potential > 0).sort((a, b) => b.potential - a.potential);
  const quickCountNow = S.pack.questionFlow.quick.questions.filter((q) => evaluate(q.showIf, S.user)).length;
  const row = (x) => h("li", {},
    h("a", { href: `#/refine/${x.id}`, class: "refine-link" }, h("strong", {}, x.title), h("span", { class: "badge" }, `+${x.potential} quality`)),
    x.benefit ? h("p", { class: "muted small" }, x.benefit) : null);
  return h("section", { class: "card next-step" },
    h("h2", {}, todo.length ? "Make this result more accurate" : "Your plan is complete"),
    h("div", { class: "meter-row" },
      h("strong", {}, `Estimate quality ${c.score}/100 · ${c.band.label}`),
      h("div", { class: "meter", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": c.score, "aria-label": "Estimate quality" },
        h("span", { class: "fill", "data-w": c.score / 100 }))),
    usingLine(c),
    todo.length
      ? [h("p", {}, done
          ? `Built from your quick answers plus ${done} detailed section${done > 1 ? "s" : ""}. `
          : `Built from ${quickCountNow} quick answers, so treat it as a first estimate. `,
          "Each section below replaces a quick guess with your real numbers. Your FIRE age, the money needed and the chance it lasts all get more precise, and the answers below use the extra detail too."),
        h("ol", { class: "refine-list" }, ...todo.slice(0, 3).map(row))]
      : h("p", {}, "✓ Every section is filled in. Revisit once a year, or when something big changes."),
    h("details", {}, h("summary", {}, "All sections"),
      h("div", { class: "sections" }, ...[...c.sections].sort((a, b) => b.potential - a.potential).map((x) => h("a", { href: `#/refine/${x.id}`, class: ["section-link", x.done && "done"] },
        h("span", {}, x.title),
        x.done ? h("span", { class: "badge good" }, "✓ Done") : x.potential > 0 ? h("span", { class: "badge" }, `+${x.potential}`) : null)))));
}

/** Dated, concrete steps from today to the years after FIRE. Folds in the rules pack's nudges. */
function actionPlanCard(r) {
  const u = S.user, i = r.inputs, t = r.target, w = r.swp, A = i.assumptions;
  const HC = S.pack.healthCover;
  const fireAge = t.age, prep = Math.max(Math.ceil(i.age), fireAge - 3);
  const steps = [];
  // Steps are shown in date order: "This year" first, then by age, then "Every year after".
  const order = (when) => (/^This year/.test(when) ? 0 : /^Every/.test(when) ? 999 : Number((when.match(/\d+/) || [500])[0]));
  const step = (when, title, ...detail) => steps.push({ at: order(when), n: steps.length,
    el: h("li", {}, h("span", { class: "when" }, when), h("div", {}, h("strong", {}, title), detail.length ? h("p", { class: "small" }, ...detail) : null)) });

  const now = i.monthlySip, pf = i.epfMonthly;
  const pfNote = pf ? ` (plus ${inr(pf)} going into PF)` : "";
  const reachable = t.gap < 0 && t.requiredMonthlySip != null && t.requiredMonthlySip <= 1.5 * now;
  step("This year", reachable ? `Invest ${inr(t.requiredMonthlySip)} a month from your pay` : `Keep investing ${inr(now)} a month from your pay`,
    reachable ? `That's what reaching ${fireAge} takes (you invest ${inr(now)} now${pfNote}). `
      : t.gap < 0 ? `With your PF${pf ? ` (${inr(pf)} a month)` : ""}, this gets you to about ${ageWhole(r.earliestAge)} with steady returns (about ${ageWhole(r.chance.likelyAge)} for 75% of simulated paths to last). To get closer to ${fireAge}, combine the options above. `
      : `You're on track${pfNote}. `,
    `Raise it ${pct(r.params.stepUp, 0)} every year, e.g. with each raise. Until ${prep}, keep about ${S.pack.assetClasses.map((a) => `${Math.round(a.targetBeforeFire * 100)}% ${a.label.toLowerCase()}`).filter((x) => !x.startsWith("0%")).join(", ")}.`);
  const efTarget = A["emergency.months"] * (r.derived.monthlyExpenses + r.derived.monthlyEmi);
  const efShort = Math.max(0, efTarget - (i.emergencyFund || 0));
  step("This year", i.detailed.holdings ? `Keep ${inrShort(efTarget)} as an emergency fund` : `Hold ${inrShort(Math.min(efTarget, i.emergencyFund || 0))} of your savings as an emergency fund`,
    `${A["emergency.months"]} months of spending and EMIs, in a sweep FD or liquid fund. `,
    i.detailed.holdings
      ? `You've marked ${inrShort(i.emergencyFund || 0)} as emergency money${efShort > 0 ? `, so build ${inrShort(efShort)} more before raising investments.` : "."}`
      : efShort > 0 ? `Your savings don't cover it yet, so this plan counts none of them towards FIRE; build ${inrShort(efShort)} more first.`
      : "This plan already keeps it out of your FIRE savings.");
  // Only advise buying cover when we know there isn't enough; otherwise say what to check.
  const coverKnown = u.insurance?.healthCover != null || (u.sectionsDone || []).includes("protection");
  if (HC && !(u.insurance?.healthCover >= HC.recommendedCover))
    step("This year", coverKnown ? `Raise your own family health cover to ${inrShort(HC.recommendedCover)} or more` : `Check you have your own family health cover of ${inrShort(HC.recommendedCover)} or more`,
      coverKnown ? `You have ${inrShort(u.insurance?.healthCover || 0)} of your own. ` : "Cover through your employer doesn't count: it ends when you stop working. ",
      `Cover is much harder to get later or with an illness. Roughly ${inr(w?.health?.premiumNow ?? 0)} a year at your age. `,
      coverKnown ? "" : "Add what you have under Insurance & health cover to make this step specific.");
  for (const x of i.properties || []) if (x.sale) step(`At ${Math.floor(x.sale.atAge)}`, `Sell ${x.label}`,
    `Expect about ${inrShort(x.sale.net)} after costs and about ${inrShort(x.sale.tax)} in capital-gains tax (${x.sale.method}). Put it straight into the cash and debt buckets, not a lump-sum equity bet.`);
  // Only money the person entered; the amounts are this plan's own projections.
  for (const l of i.locked || []) step(`At ${Math.floor(l.unlock.age)}`, `${l.label} unlocks`,
    `From ${l.from || "your plan"}: ${inrShort(l.value)} today. `,
    l.atUnlock ? `By ${Math.floor(l.unlock.age)} the plan expects about ${inrShort(l.atUnlock.total)}: ${inrShort(l.atUnlock.lump)} to take out${l.atUnlock.taxedWithIncome ? ` (${inrShort(l.atUnlock.taxable)} of it is above the tax-free share, so it's taxed with your other income that year; the plan adds that tax to the year's withdrawal)` : l.atUnlock.tax > 0 ? ` (about ${inrShort(l.atUnlock.tax)} of it goes in tax at the top slab rate, since your salary is still coming in)` : ""}${l.atUnlock.pensionMonthly ? ` and ${inr(l.atUnlock.pensionMonthly)} a month as a pension` : ""}. ` : "",
    l.instrumentId === "nps_tier1" ? "Change the exit age or lump sum under Life after FIRE. " : "",
    l.unlock.note || "");
  // The bucket and SWP steps describe stopping at the target; say so when the plan doesn't reach it yet.
  const ifClosed = t.gap < 0 ? `This assumes you close the gap above; on today's path you'd stop around ${ageWhole(r.earliestAge ?? i.planUntilAge)}. ` : "";
  if (w?.buckets && prep < fireAge)
    step(`From ${prep}`, "Build the buckets over three years",
      ifClosed, `Move new money and some equity gains into debt and cash so that by ${fireAge} you hold about ${inrShort(w.buckets.cash.amount)} in cash (3 years of spending) and ${inrShort(w.buckets.debt.amount)} in debt (the next 5). This protects you if markets fall just as you stop.`);
  if (w) step(`At ${fireAge}`, `Start an SWP of ${inr(w.firstMonthly)} a month`,
    prep < fireAge ? "" : ifClosed, "From the cash bucket (liquid or arbitrage fund). Confirm your health policy is in your own name before leaving your job.");
  step(`Every year after`, "Refill and re-check",
    "Move a year of withdrawals from debt to cash and top up debt from equity, but skip selling equity after a bad year. Raise the SWP with inflation, and re-run this plan.");

  // Nudges the steps above already cover.
  const shown = new Set(["no_health_cover", "emergency_short", "low_confidence", "nps_locked"]);
  const icon = { critical: "⛔", warn: "⚠", info: "ℹ" };
  const extra = [
    ...(r.overlaps || []).map((o) => ({ severity: "warn", section: o.section, message: o.message })),
    ...r.nudges.filter((n) => !shown.has(n.id)).map((n) => n.id === "uninvested_surplus" && r.derived.monthlySurplus > 0
      ? { ...n, message: `About ${inr(r.derived.monthlySurplus)} a month is left after spending, EMIs and what you invest. The plan doesn't count it until you invest it; adding it to your monthly investment brings your FIRE age closer.` }
      : n),
  ];
  return card("Your plan, step by step",
    h("ol", { class: "timeline" }, ...steps.sort((a, b) => a.at - b.at || a.n - b.n).map((x) => x.el)),
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
          s.earliestAge == null ? "not reached" : age1(s.earliestAge),
          s.id !== "base" && s.earliestAge != null && r.earliestAge != null && Math.abs(s.earliestAge - r.earliestAge) >= 0.05
            ? h("small", { class: "help" }, `${s.earliestAge > r.earliestAge ? "+" : "−"}${age1(Math.abs(s.earliestAge - r.earliestAge))} yr`) : null)))))));
}

/** What the corpus needed at the target age pays for, so nothing hides inside one number. */
function breakdownCard(r) {
  const b = r.breakdown, t = r.target;
  if (!b || !(b.costs > 0)) return null;
  const rows = [
    ["Living costs", b.living, "Everything except healthcare, adjusted for life after FIRE.", "s1"],
    ["Healthcare", b.health, `Doctor visits, medicines: ${pct(r.params.infl.health, 0)} a year inflation.`, "s2"],
    ["Health insurance", b.healthPremium, r.swp?.health?.estimated ? "Estimated family floater after employer cover ends. Enter your quote under Insurance." : "Your quote, rising with age and medical inflation.", "s3"],
    ["Tax on withdrawals", b.tax, `An estimate, worked out each year under the new regime. It assumes ${pct(r.inputs.assumptions["tax.equityGainShare"] ?? 0.5, 0)} of what you take from equity is gain (change it under Assumptions).`, "s4"],
    ["Loan EMIs after FIRE", b.emi, "EMIs still running after you stop.", "s5"],
    ["Goals after FIRE", b.goals, "Big one-off costs due after you stop.", "s6"],
  ].filter((x) => x[1] > 0.5);
  const minus = [
    ["Rent, pension and other income", Math.min(b.income, b.costs)],
    ["Money coming in (lump sums)", b.inflow],
  ].filter((x) => x[1] > 0.5);
  const total = rows.reduce((a, x) => a + x[1], 0);
  return card(`What the ${inrShort(t.required)} pays for`,
    h("p", { class: "muted small" }, `Everything you'd spend from ${t.age} to ${r.inputs.planUntilAge}, valued at ${t.age}. If something looks too big, that's the number to question.`),
    runsOutNote(r),
    h("div", { class: "stack-bar", role: "img", "aria-label": rows.map((x) => `${x[0]} ${inrShort(x[1])}`).join(", ") },
      ...rows.map((x) => h("span", { class: ["stack-seg", x[3]], "data-w": x[1] / total, title: `${x[0]}: ${inrShort(x[1])}` }))),
    h("div", { class: "table-wrap" }, h("table", { class: "breakdown" }, h("tbody", {},
      ...rows.map((x) => h("tr", {}, h("th", { scope: "row" }, h("span", { class: ["key-block", x[3]] }), x[0], h("small", { class: "help" }, x[2])),
        h("td", { class: "num" }, inrShort(x[1])), h("td", { class: "num muted" }, pct(x[1] / total, 0)))),
      ...minus.map((x) => h("tr", { class: "minus" }, h("th", { scope: "row" }, x[0]), h("td", { class: "num" }, `−${inrShort(x[1])}`), h("td", {}))),
      h("tr", { class: "total-row" }, h("th", { scope: "row" }, `Corpus needed at ${t.age}`), h("td", { class: "num" }, inrShort(t.required)), h("td", {}))))),
    mathDetails(r));
}

/**
 * The withdrawal strategy behind "money needed", in one sentence: an income rising with inflation,
 * sized to run out at the plan-until age. And roughly what it would take never to run out.
 */
function runsOutNote(r) {
  const t = r.target, rr = r.params.rPost, g = r.params.infl.general, w = t.firstYearWithdrawal;
  const forever = w > 0 && rr - g > 0.005 ? (w * (1 + rr)) / (rr - g) : null;
  return h("p", { class: "small strategy" }, h("strong", {}, "How it's sized: "),
    `a yearly withdrawal that rises with inflation, from ${t.age} until ${r.inputs.planUntilAge}, when the money is planned to run out. `,
    forever ? `Never running out (living off returns alone) would take roughly ${inrShort(forever)} at ${t.age}. ` : "",
    `To plan for a longer life, raise "money should last until" under Life after FIRE.`);
}

/** The calculation chain, step by step, from today's spending to the gap at the target age. */
function mathDetails(r) {
  const m = r.math, f = m.firstYear, t = r.target, i = r.inputs;
  const part = (label, x) => (x > 0.5 ? `${label} ${inrShort(x)}` : null);
  const costs = [part("living", f.living), part("healthcare", f.health), part("health insurance", f.healthPremium), part("EMIs", f.emi), part("goals", f.goals)].filter(Boolean);
  const steps = [
    `Today you spend about ${inr(r.derived.monthlyExpenses)} a month (${inrShort(12 * r.derived.monthlyExpenses)} a year), plus EMIs of ${inr(r.derived.monthlyEmi || 0)}.`,
    `By ${m.fireAge}, in ${m.yearsToFire} years, prices rise ${pct(m.inflation.general)} a year (healthcare ${pct(m.inflation.health)}), and each cost is adjusted for life after work. Your first retired year costs ${costs.join(" + ")} = ${inrShort(f.spend)}.`,
    f.income > 0.5 ? `Income that continues (rent, pension, a spouse's pay…) covers ${inrShort(f.income)}, leaving ${inrShort(f.need)} to take from your savings.` : `Nothing else comes in, so all ${inrShort(f.need)} comes from your savings.`,
    `Tax on those withdrawals adds an estimated ${inrShort(f.tax)}${f.inflow > 0.5 ? `, and money arriving that year covers ${inrShort(f.inflow)}` : ""}: the first year's withdrawal is ${inrShort(f.withdrawal)}.`,
    `Every later year is worked out the same way, up to ${i.planUntilAge} (${m.yearsRetired} years). Valued back to ${m.fireAge} at ${pct(m.returnAfter)} a year (the return after FIRE), they add up to ${inrShort(m.required)}: the corpus needed.`,
    `On the other side: ${inrShort(m.savingsToday)} saved today, plus ${inrShort(m.contributions)} you'll invest over ${m.yearsToFire} years (monthly, rising each year)${Math.abs(m.lumps) > 0.5 ? `, ${m.lumps >= 0 ? "plus" : "less"} ${inrShort(Math.abs(m.lumps))} of lump sums and goals before then` : ""}, plus ${inrShort(m.growth)} of growth at ${pct(m.returnBefore)} a year = ${inrShort(m.projected)} by ${m.fireAge}.`,
    t.gap >= 0 ? `${inrShort(m.projected)} is more than ${inrShort(m.required)}: a surplus of ${inrShort(t.gap)}.` : `${inrShort(m.projected)} against ${inrShort(m.required)} needed: a shortfall of ${inrShort(-t.gap)}.`,
  ];
  return h("details", { class: "math" }, h("summary", {}, "Show me the math"),
    h("ol", {}, ...steps.map((x) => h("li", {}, x))),
    h("p", { class: "muted small" }, "All amounts are in future rupees, with steady returns. The chance figures come from the separate market simulation."));
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
    h("p", { class: "muted small" }, "The buckets show how to hold and draw the money. The chance figures come from simulating the whole corpus with one blended return and its ups and downs, not each bucket separately, so treat the buckets as a way to act on the plan rather than part of the simulation."),
    h("p", { class: "small" }, h("strong", {}, "Included in the SWP: "),
      `an estimated ${inr(w.firstTax)} tax in the first year (${pct(w.firstTaxRate)} of withdrawals: interest and debt-fund gains at slab rates, equity gains at 12.5% above ₹1.25 lakh, assuming ${pct(r.inputs.assumptions["tax.equityGainShare"] ?? 0.5, 0)} of equity withdrawals is gain), and `,
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
  const rows = progress(S.user.snapshots || []);
  const signed = (x, fmt) => (x == null ? "" : x === 0 ? "no change" : `${x > 0 ? "+" : "−"}${fmt(Math.abs(x))}`);
  const cell = (value, change, fmt, better) => h("td", { class: "num" }, value,
    change != null && change !== 0 ? h("small", { class: ["help", better(change) ? "better" : "worse"] }, signed(change, fmt)) : null);
  const last = rows.at(-1);
  return card("Check-ins",
    h("p", { class: "muted small" }, "Every few months, update what changed (your savings total or Investments, spending, loans), then record a check-in. Each row shows the change since the one before. It's saved in your plan file, on your device."),
    rows.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", { class: "num" }, "FIRE savings"), h("th", { class: "num" }, "Net worth"),
        h("th", { class: "num" }, "Earliest age"), h("th", { class: "num" }, "Chance it lasts"))),
      h("tbody", {}, ...rows.map((s) => h("tr", {},
        h("td", {}, s.date, s.change?.answersChanged ? h("small", { class: "help" }, "answers changed too") : null),
        cell(inrShort(s.fireCorpus), s.change?.fireCorpus, inrShort, (d) => d > 0),
        cell(inrShort(s.netWorth), s.change?.netWorth, inrShort, (d) => d > 0),
        cell(s.earliestFireAge == null ? "—" : age1(s.earliestFireAge), s.change?.earliestFireAge, (x) => `${x} yr`, (d) => d < 0),
        cell(s.chance == null ? "—" : `${s.chance}%`, s.change?.chance, (x) => `${x} pts`, (d) => d > 0))))))
      : null,
    last?.change?.answersChanged ? h("p", { class: "muted small" }, "“Answers changed too” means you added detail or changed a target since the last check-in, so part of the difference comes from that, not from progress.") : null,
    h("button", { type: "button", class: "btn", onClick: recordCheckIn }, rows.some((x) => x.date === new Date().toISOString().slice(0, 10)) ? "Update today's check-in" : "Record today's check-in"));
}

// ---------------- refine ----------------
function refineView(id) {
  const section = S.pack.questionFlow.refine.find((s) => s.id === id);
  if (!section) { location.hash = "#/results"; return h("span"); }
  const u = S.user;
  u.sectionsDone ||= [];
  const done = u.sectionsDone.includes(id);
  const ctx = { user: u, pack: S.pack, market: S.market, hpi: S.hpi, save, redraw };
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
    ...((S.result?.overlaps || []).filter((o) => o.section === id).map((o) => h("p", { class: "overlap-warn", role: "note" }, "⚠ ", o.message))),
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
  if (!S.result) return;
  S.user.snapshots = withSnapshot(S.user.snapshots, snapshotOf(S.result, new Date().toISOString().slice(0, 10)));
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
// On phones, tables with three or more columns stack each row into a small card. Every cell
// gets its column's heading as a label (data-label), which the CSS shows in stacked mode.
function labelTables() {
  for (const t of app.querySelectorAll("table:not([data-labelled])")) {
    t.dataset.labelled = "1";
    const heads = [...(t.tHead?.rows[0]?.cells || [])].map((c) => c.textContent.trim());
    if (heads.length < 3) continue;
    t.classList.add("stackable");
    for (const row of t.tBodies[0]?.rows || [])
      [...row.cells].forEach((c, i) => {
        if (!heads[i]) return;
        c.dataset.label = heads[i];
        // A row whose heading is just a number ("69") reads as "Age 69" when stacked.
        if (i === 0 && /^[\d.,\s]+$/.test(c.textContent.trim())) c.classList.add("num-head");
      });
  }
}

new MutationObserver(() => {
  labelTables();
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
  try {
    const res = await fetch(`data/house-price-index.json?v=${BUILD}`);
    if (res.ok) S.hpi = await res.json();
  } catch { /* optional: price references for the Property section */ }
  S.user = migrate(store.loadWorking());
  if (S.user) store.saveWorking(S.user);
  recompute();
  window.addEventListener("hashchange", route);
  route();
  ai.init(); // resumes an AI download the user started before a refresh
}

boot();
