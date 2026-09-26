# FindMyFIRE — local-first FIRE planner (India)

A guided FIRE calculator that runs entirely in the browser. Your data lives in a JSON file on your device, never on a server. No accounts, no analytics, no LLM.

**Use it:** https://fire.byteheaven.in/ (published from `main` by GitHub Actions; the old github.io address redirects here)

## Run it locally

```sh
npm install
npm test        # schemas, rules pack, engine and golden tests
npm run serve   # http://localhost:8080
```

There is no build step. The app is plain ES modules (`index.html`, `src/`), so any static host works.

## How it fits together

| Piece | File | Who owns it | Contains personal data? |
|---|---|---|---|
| Rules pack | `rules/in.2026.1.json` | This repo, updated after each Union Budget | No |
| User file | Created by the UI, saved on the user's device | The user | Yes |
| Engine | `src/engine/` | This repo | No — pure functions |
| App | `index.html`, `src/ui/` | This repo | No — reads/writes the user file locally |

The contract between them is two JSON Schemas in `schemas/`.

- **`rules-pack.schema.json`**: India-specific knowledge. It covers the question flow, expense catalogue, instrument catalogue (lock-ins, tax treatment), assumptions, tiers, scenarios and nudges. Update this file when rules change; the code stays as it is.
- **`user-file.schema.json`**: one household's answers. Every list item carries a `source` of `exact`, `estimate` or `default`. Scalar answers record theirs in `provenance`.

## Quick answer first, refine later

1. **Quick pass (8 questions).** Results show one "most useful next step" (the section that raises accuracy most); finishing a section offers the next one. Everything else stays optional.
    These fill `/quick/*` and give a first FIRE age with a confidence score.
2. **Refine sections** (expenses, holdings, goals, …). Each one lists the quick answers it replaces (`replacesQuick`). Once a section is in `sectionsDone`, the engine uses the detailed data instead. See `resolution` in the rules pack.
3. **Confidence** is computed from each answer's source, weighted by section:
   - Σ(section weight × mean answer score) ÷ Σ(weights of visible sections), shown as 0–100.
   - Bands: *Rough* / *Reasonable* / *Solid*.
   - The same sources set an uncertainty band (estimate ±15%, default ±30%), which gives an earliest-FIRE-age *range*.

## Rules the rules pack encodes

- **Lean FIRE** = only expense categories marked `essential`. No arbitrary multiplier.
- **Post-FIRE adjustments per category** (`postFireFactor`): commuting falls, electricity and hobbies rise.
- **Inflation per category**: general, health or education.
- **Children's costs stop** when the child becomes independent. The term premium stops at the end of the policy term.
- **Default FIRE-corpus treatment per instrument**:
  - NPS Tier-1 is excluded before 60.
  - Endowment policies use surrender value.
  - SSY is treated as goal money.
  - The emergency fund is always excluded.
- **Nudges**: a declarative `when` condition plus a message. Examples: NPS is locked, no personal health cover, no term cover with dependants, emergency fund short, uninvested surplus.

Conditions use a small safe format (`all` / `any` / `not` / `{ref, op, value}`) with no `eval`. `ref` is either a JSON Pointer into the user file or a derived value such as `$age`.

## How the engine works

All amounts are nominal rupees, stepped one year at a time from today (`src/engine/project.js`).

- **Before FIRE:** corpus(t+1) = (corpus + SIP + EPF − goals due that year) × (1 + return before FIRE). Contributions go in at the start of the year, like the sheet's `FV(…, type 1)`. The SIP steps up each year, and EPF grows with income.
- **Withdrawals after FIRE:** each expense line is inflated at its own rate (general, health or education) and scaled by its post-FIRE factor. Then add EMIs still running and goals due that year, subtract income that continues after FIRE, and gross the result up for withdrawal tax.
- **Corpus needed at age A:** the present value of every withdrawal from A until `plan.untilAge`, at the post-FIRE return. By construction it runs out exactly after that year.
- **Earliest FIRE age:** the first age where the projected corpus reaches the corpus needed, interpolated between years.
- **One target:** your current lifestyle, adjusted per expense line for life after FIRE. The engine can still compute Lean/Fat/Barista/Coast variants (`tiers`), but the app deliberately shows one number.
- **Living off the corpus:** a yearly-rising SWP paid from three buckets (3 years in cash, 5 in debt, the rest in equity). The app shows the equity return the plan implicitly needs, so an unrealistic post-FIRE return is easy to spot.
- **Money coming in** (gratuity, policy payouts, a property sale): a lump sum before FIRE is invested; one after FIRE pays that year's spending. The corpus needed is then the largest running present value, so a late windfall can't cover earlier years.
- **Property:** each home or plot has a value and a location-specific growth rate. Rent and costs flow in or out while you own it. A planned sale arrives as a lump sum after 2% selling costs and 12.5% LTCG on the gain. Property you keep is shown in net worth but never spent.
- **Locked money:** instruments with an `unlock` rule (NPS Tier-1 at 60) stay out of the FIRE corpus, but grow to that age and then arrive as a lump sum plus a pension.
- **Market ups and downs:** 1,000 simulated market histories (seeded, so a plan always shows the same result) give the chance the money lasts, and the ages with a 3-in-4 and a 9-in-10 chance. The steady-return FIRE age is roughly a coin flip, and the app says so.
- **Tax on withdrawals** is worked out each retired year from the rules pack's `incomeTax` table (new regime, FY2025-26). Interest and debt-fund gains from the cash and debt buckets are taxed at slab rates, with the ₹12 lakh rebate. Equity gains are taxed at 12.5% above ₹1.25 lakh. Rent (after the 30% standard deduction) and pensions are taxed at slab rates too. Slabs are assumed to rise with inflation.
- **Health cover after FIRE:** a family-floater premium from the pack's indicative age table, or your own quote. It rises with age and medical inflation, and only the part beyond any premium already in your spending is added.
- **Repeating goals:** a car every 8 years, renovation every 12, appliances every 5.
- **Levers:** the extra monthly investment, the lower post-FIRE spending, or the later age that each close the gap on their own.
- **Scenarios** re-run the same model with the rules pack's deltas. The **range** re-runs it with expenses and corpus moved by each answer's uncertainty band.

### Relationship to the original Google Sheet

`test/golden-sheet.test.mjs` checks the engine against the sheet's own numbers. `scripts/golden-from-sheet.py` types synthetic inputs into a copy of the workbook, recalculates it with LibreOffice and records the results in `test/fixtures/sheet-golden.json`. The workbook is never committed. The engine reproduces these parts of the sheet exactly:

- `FV`, `PMT` and `NPER`
- the projected corpus with milestones (E11, M9)
- the Lean, Fat and Coast targets
- the three-bucket split
- the 41-year retirement schedule, row by row

The planner deliberately differs from the sheet in three places:

| Sheet | Planner | Why |
|---|---|---|
| Target = spending ÷ 3.25% SWR | Present value of withdrawals until `plan.untilAge` | The horizon, per-category inflation, goals and loans all feed the number directly. The implied first-year withdrawal rate is shown next to it. |
| One blended inflation (85% CPI + 15% health) | Each expense line at its own rate | Healthcare and education compound faster. A blended rate understates them over 40 years. |
| "Current path" table (cols N–Y) earns a year's return on money already withdrawn | Withdraw first, then grow (same as the sheet's target schedule, cols A–L) | Keeps the two schedules consistent. |

## Live inflation data

The deploy workflow runs `scripts/fetch-market-data.mjs` at every deploy and weekly. It pulls India's CPI inflation history (World Bank) and the IMF World Economic Outlook projections, then publishes them as `market/india.json` next to the app. The Assumptions screen compares your inflation figure with both.

- The browser only ever loads this file from the app's own site. It never calls outside APIs, so the "send nothing anywhere" policy still holds.
- The data is a reference, never applied automatically. Projections cover about five years; a plan runs 40+. Healthcare and education inflation have no reliable free public feed yet, so they stay as assumptions.

### Counting each rupee once

The same money can be entered in two places, so the engine applies fixed rules and reports each one on the results page and in the section concerned:

- Rent under **Income** is ignored when a property under **Property** has rent.
- A property sale under **Money coming in** is ignored when a sale is planned under **Property**.
- An endowment policy counted in **Investments** isn't added again when its payout is under **Money coming in**.
- Investment property isn't offered under Investments; it belongs under Property.
- A finished detailed section that adds up to less than 75% of the quick answer it replaces is flagged, since something is usually missing.

`test/engine.test.mjs` checks that the same household entered through quick answers and through detailed sections gives an identical result. It also checks that each rule above holds, and that the "what the corpus pays for" breakdown adds up to the corpus needed.

### Tests that catch overlaps and calculation errors

`npm test` runs three layers:

1. **Golden tests** (`test/golden-sheet.test.mjs`): the original Google Sheet's formulas, recalculated by LibreOffice, reproduced exactly.
2. **Example tests** (`test/engine.test.mjs`): specific cases such as tax slabs, NPS unlock, repeating goals, and each double-counting rule.
3. **Property tests** (`test/invariants.test.mjs`): 150 seeded random households (quick and detailed, with children, goals, loans, property, PF and lump sums). Every one must satisfy these rules:
   - **Direction:** more spending, a new goal, a loan past FIRE, a longer life, pricier health cover or higher medical inflation never needs *less* money. More savings, PF, a pension or a lump sum never delays FIRE. Stress scenarios never improve the answer.
   - **Same money, different wording:** quick vs detailed, monthly vs yearly, one line vs two, and list order never change the result.
   - **Book-keeping:** the corpus needed pays every withdrawal and ends at zero. The "what it pays for" breakdown adds up to the headline. Results are finite and in range. Money entered twice is counted once. School costs stop at 18, so they can't overlap a college goal.

   A failure prints the exact household, and the generator is seeded, so every failure reproduces.

## Keeping it honest

- `npm test` validates every rules pack and example against the schemas. It then checks cross-references that schemas can't express:
  - unknown instrument, category, goal or section ids
  - question binds that don't exist in the user schema
  - allocations that don't sum to 100%
  - broken child links
  - assumptions outside their own min/max
- Every tax item or administered rate that changes with Budgets or EPFO/PFRDA notices has `verify: true`. Re-check them all when publishing a new pack version.
- User files carry `schemaVersion` and `rulesPackVersion`, so the app can migrate old files forward. Never mutate a published pack; ship `in.2027.1.json`.

## Design

- Type: [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) for headlines and numbers, [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) for text. Both are SIL Open Font License, self-hosted in `src/ui/fonts/` with their licences, and subset to Latin + Latin Extended (which carries ₹).
- Illustrations are small duotone SVGs drawn in code (`src/ui/art.js`), themed by CSS, with no image files.
- The share card (`src/ui/share.js`) is drawn on a canvas on the user's device and handed to the share sheet or downloaded. Amounts appear only if ticked.
- All motion respects `prefers-reduced-motion`.

## Privacy rules for the app

- Static hosting only.
- A Content-Security-Policy with `connect-src 'self'`, so the page cannot send data anywhere.
- No analytics or third-party scripts.
- Working copy in the browser's localStorage, autosaved. Explicit Save / Open for the JSON file.
- Optional passphrase encryption of the file (WebCrypto AES-GCM).

## Roadmap

1. ✅ Schemas, India rules pack, examples, validator
2. ✅ Engine (year-by-year projection, required corpus, earliest age, levels, scenarios) with golden tests from the Google Sheet
3. ✅ Quick-pass UI + live result
4. ✅ Refine sections, confidence meter, nudges
5. ✅ Save/Open/encrypt, check-ins · ⬜ check-in chart, PWA offline, tax estimator (replaces the flat withdrawal-tax assumption), asset-allocation drift

## Disclaimer

Planning tool, not investment, tax or legal advice. Tax rules summarised as of FY2025-26 and flagged for verification.
