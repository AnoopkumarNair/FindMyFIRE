# FindMyFIRE

A FIRE (financial independence, retire early) planner for India that runs entirely in your browser. There are no accounts and no analytics, and nothing you enter is sent to a server. Your plan stays in the browser and in a JSON file you can save and open again.

**Try it:** https://fire.byteheaven.in/

## What it does

Answer nine quick questions: your ages, take-home pay, spending, EMIs, savings, monthly investments, PF, NPS, and any income that continues after you stop working. You get the earliest age you could stop working, how much money that needs, and the chance it lasts. From there you can fill in as much detail as you like: expenses by category, each investment, goals, loans, property, family, other income and insurance. Each section you complete makes the answer more accurate, and the estimate-quality score shows how complete your answers are.

A few things it handles that simpler calculators don't:

- **Emergency fund.** You give one total for your savings, and the planner keeps six months of spending and EMIs aside before counting the rest.
- **Inflation by category.** Everyday costs, healthcare and education each rise at their own rate. Children's costs stop when they become independent.
- **Locked money.** NPS follows PFRDA's exit rules: exit between 60 and 85, up to 80% as a lump sum (60% for government employees), the rest as a pension, and tax on any lump sum above the tax-free 60%. You choose the exit age and lump sum; the default is 60% at 60. Employer superannuation unlocks at 58, a third as a lump sum. Neither counts as spendable before then.
- **Income after you stop.** A spouse who keeps working, a pension, an annuity, rent or part-time work reduces what you draw, each taxed the right way and each with its own start and end age.
- **Tax on withdrawals**, worked out every year under the new regime (FY2026-27 rules, including the ₹12 lakh rebate with marginal relief): slab rates on interest and pensions, 12.5% on equity gains above ₹1.25 lakh, and no exemption for foreign shares.
- **Health cover after FIRE.** Once employer cover ends, a family floater premium is added. It rises with age and with medical inflation.
- **Market ups and downs.** 10,000 simulated market histories show how often your money lasts, and the ages at which 75% and 90% of them last. The 90% age is the safe planning age.
- **Property, goals and lump sums.** Rent, upkeep, planned sales (after capital-gains tax, using indexation where a pre-July-2024 purchase allows it), repeating goals such as a car every eight years, gratuity and policy payouts.
- **What moves the answer.** A ranked view of which inputs shift your FIRE age most, and a step-by-step "show me the math" from today's spending to the corpus needed.

## Ask about your plan

The results page has a question box. It works in two ways.

**Plain answers (always available).** The question is matched to one of a fixed set of topics: why this age, will the money last, what the corpus pays for, how withdrawals work, what if I change something, what it would take to stop at a given age, a summary, or what a term means. The answer comes straight from the plan's own calculations. What-ifs show before and after, and can be applied to your plan with one click.

**On-device AI (optional, laptops and desktops).** You can download a small open model, Gemma 4 E2B at about 3.1 GB, and it runs inside the browser on your graphics chip using WebGPU. It does two things: it works out what a question is asking when the plain matching isn't sure, and it rewords the plan's facts as a short conversational answer. It never calculates anything. Every sentence it writes is checked before it's shown:

- Every number in it must match one the plan produced or one you typed.
- It can't contradict the plan: for example, it can't say you're on track when you aren't, get your age wrong, or describe a chance as anything other than the chance the money lasts.
- It can't make promises, recommend products or include links.

If a sentence fails, the plain facts are shown instead, and the facts are always one tap away under "The numbers behind this". Each answer says whether it came from the AI or straight from the calculations.

About the model:

- **Download.** It starts only when you ask for it. It resumes after a refresh, and every 8 MB piece is checked against a SHA-256 hash in `src/assistant/models.json`.
- **Source.** It comes from the publisher's Hugging Face repository, pinned to a single commit.
- **Loading.** Once downloaded, it starts loading in the background when the results page opens.
- **Which GPU.** On laptops with two graphics chips it asks for the faster one, although Windows can override that choice.
- **Phones.** A model this size doesn't fit in a phone browser's memory, so phones and tablets get plain answers only.

The model was chosen by running several candidates (Gemma 4, Qwen 3 and 3.5, Llama 3.2) through the same questions and checker with `scripts/assistant-eval.mjs`. Gemma 4 E2B was the only one whose answers were both accurate and concise. To try a different model, use **Actions → Publish AI model**. It fetches and hashes the files, evaluates the model, runs a browser test, and can then publish it. See [docs/hosting-the-ai-model.md](docs/hosting-the-ai-model.md).

## Privacy

- It's a static site with a strict Content-Security-Policy. The page can only fetch from itself and, for the optional AI, the Hugging Face file hosts. Those hosts only serve file downloads and never see your plan.
- Your working copy autosaves to the browser. **Save** and **Open** read and write a JSON file on your device, which you can optionally encrypt with a passphrase (AES-GCM).
- Inflation reference data (World Bank CPI and IMF projections) is fetched when the site is built and served from the same site. The browser never calls outside APIs.
- The AI runs locally. Your questions and answers stay on the device.

## Running it locally

```sh
npm install
npm test        # schemas, rules pack, engine, assistant and golden tests
npm run serve   # http://localhost:8080
npm run vendor  # optional: fetch the AI runtime into vendor/ to try the assistant locally
```

There's no build step. The app is plain ES modules (`index.html` and `src/`), so any static host works. Pushing to `main` runs the tests and deploys to GitHub Pages through GitHub Actions (`.github/workflows/pages.yml`).

## How it's put together

| Part | Where | Notes |
|---|---|---|
| Rules pack | `rules/in.2026.1.json` | India-specific knowledge: questions, expense and instrument catalogues, tax tables, assumptions, nudges. Updated after each Union Budget. |
| Engine | `src/engine/` | Pure functions: projection, corpus needed, earliest age, simulations, what-ifs. |
| App | `index.html`, `src/ui/` | Reads and writes the user's plan locally. |
| Assistant | `src/assistant/` | Question matching, fact tools, the answer checker, and the optional model worker. |
| Schemas | `schemas/` | The contract between the rules pack and a user's plan file. |

The rules pack is data, not code. When tax rules or rates change, the pack changes and the code stays the same. Published packs are never edited: a new year gets a new file (`in.2027.1.json`), and plan files record which pack they used. Items that change with Budgets or EPFO/PFRDA notices are marked `verify: true` so they get re-checked.

Quick answers and detailed sections map onto the same inputs. Each detailed section lists the quick answers it replaces, and once you mark it done the engine uses the detail instead. Money that could be entered in two places is counted once. For example, rent entered under both Income and Property is counted only under Property, and the results page says when a rule like this applies.

### The engine in brief

All amounts are in nominal rupees, projected one year at a time.

- **Before FIRE**, savings grow with your monthly investments (stepping up each year) and PF contributions, both paid month by month, less any goals that fall due.
- **After FIRE**, each year's withdrawal is the spending for that year: each expense rises at its own rate and is adjusted for life after work. Add health cover, EMIs still running and goals; subtract income that continues; then add tax on top.
- **The corpus needed** at an age is the present value of every withdrawal from then until the age your money should last to. The earliest FIRE age is the first age at which your projected savings reach that amount.
- **Withdrawals** come from three buckets: three years in cash, five in debt, the rest in equity.

### Property price data

The Property section compares your growth rate with RBI's All-India House Price Index. The data lives in `data/house-price-index.json`. It's a reference only; it never changes your number unless you press "Use". City and state figures can be switched on later from RBI's own city table (the importer's `--with-cities` option); they're left out until that table is available, rather than using figures that can't be checked.

To refresh it when RBI publishes a new quarter (about two months after each quarter ends):
1. Save the city-wise table from RBI's House Price Index release as a spreadsheet with the columns City, State/Region, HPI_Q<n>_<yyyy>_<yy>, QoQ_Growth_Percent and YoY_Growth_Percent, plus an ALL INDIA row. Check the All-India figures against RBI's press release.
2. Run `python3 scripts/import-hpi.py <file.xlsx>` (needs `pip install openpyxl`); add `--with-cities` only for RBI's own table. It checks the rows and works out each city's yearly rate since the 2022-23 base.
3. Update the `rbi-hpi` entry in the rules pack's sources, run `npm test`, and commit the JSON file. The spreadsheet itself isn't committed.

### Tests

`npm test` covers:

- **Golden tests** reproduce the original spreadsheet this started from. `scripts/golden-from-sheet.py` recalculates the workbook in LibreOffice and records its outputs. The workbook itself is never committed. (The sheet puts a year's investments in at its start; the planner invests monthly, and the golden tests use the sheet's timing.)
- **Example tests** cover specific cases: tax slabs, NPS and superannuation unlocking, emergency fund, income after FIRE, foreign-share tax, repeating goals and each double-counting rule.
- **Maths tests** check that monthly investing matches month-by-month compounding, zero and negative returns, tax continuity at every slab edge and the rebate limit, boundary ages, a 110-year horizon, and that money arriving later can't pay for earlier years.
- **Regression households** (`test/fixtures/households/`) are six typical plans whose key results are recorded. Any engine or rules change that moves them fails the tests until it's reviewed and re-recorded with `node scripts/regression.mjs --update`; `node scripts/regression.mjs --rules <file>` compares a new rules pack before release.
- **Property tests** generate 150 random households and check that the results move in the right direction. More spending never needs less money, more savings never delays FIRE, and quick and detailed entry of the same household give the same answer. The breakdown must also add up.
- **Assistant tests** check question matching, amounts written in different ways, and the answer checker against mistakes small models have actually made.

`scripts/validate.mjs` also checks what the schemas can't: unknown ids, question bindings, allocations that don't add up to 100%, and assumptions outside their own limits.

## Roadmap

**Done:** quick pass and live result; detailed sections with an estimate-quality score; nudges; save, open and encrypt; check-ins with changes since the last one; tax on withdrawals (FY2026-27, with marginal relief); income after FIRE; NPS exit choices under the December 2025 PFRDA rules; PPF and NPS kept apart until they unlock; property capital gains with indexation for pre-July-2024 purchases; 10,000-path market simulation with a safe planning age; sensitivity and "show me the math"; a Sources page; the RBI All-India house price trend; the on-device assistant.

**Next steps**, roughly in order, with the thinking behind each:

1. **Simulate the cash, debt and equity buckets separately.** Today the simulation uses one blended return and volatility for the whole corpus, while the withdrawal plan explains itself in three buckets (and says the buckets aren't simulated). Simulating each bucket, with its own returns and the yearly refill rule ("don't sell equity after a bad year"), would show sequence risk more realistically. It needs sourced return and volatility assumptions per asset class and how they move together, and it can't use the current one-pass speed-up, so it's a larger job. Expected effect: the chance figures move a few points, not the headline answer.
2. **"Run down by 90" or "leave something behind".** The corpus is sized to run out at the plan-until age, and the app now says so and shows roughly what never running out would take. A choice to leave a set amount (for children, or as a longevity buffer) would make that explicit in the number itself.
3. **City and state property trends.** The Property section shows RBI's All-India house price trend. City and state figures switch on automatically once RBI's own city table is imported with `scripts/import-hpi.py --with-cities`; a longer history (RBI's older 2010-11 base series) would allow 10-year rates instead of about 3.5 years. Figures that can't be checked against RBI's release aren't used.
4. **Historical stress tests.** Replay Indian market and inflation history (for example 2008 or the early 2000s) instead of only random paths. Needs verified long-run series for Indian equity, debt and inflation.
5. **Tax on actual gains.** Withdrawal tax assumes a share of each equity withdrawal is gain (an assumption you can change). Optional cost basis per holding would make it exact for people with very old or very new investments.
6. **Work-optional scenarios as first-class plans.** Coast FIRE, part-time (barista) FIRE, career breaks and traditional retirement side by side; the engine already supports most of the parts.
7. **Check-in trend chart.** A chart of savings, money needed, FIRE age and chance across check-ins, marking where answers changed rather than money.
8. **Offline use (PWA)** and asset-allocation drift against the suggested mix.
9. **Feedback and support.** A "Report a problem" email link with app and rules version (no plan numbers unless the person ticks a box), and a quiet UPI support link with the payee name shown for checking.

**Kept deliberately simple:** one steady-return headline age with simulated ages beside it (rather than a single "probability"); whole-year headline ages; rules as data, refreshed and dated each Budget.

## Disclaimer

A planning tool, not investment, tax or legal advice. Tax rules are for FY2026-27 (Budget 2026 left the new-regime slabs unchanged). Each tax item in the rules pack records when it was last checked, shown under Assumptions.
