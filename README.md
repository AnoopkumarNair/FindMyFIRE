# FindMyFIRE

A FIRE (financial independence, retire early) planner for India that runs entirely in your browser. There are no accounts and no analytics, and nothing you enter is sent to a server. Your plan stays in the browser and in a JSON file you can save and open again.

**Try it:** https://fire.byteheaven.in/

## What it does

Answer nine quick questions: your ages, take-home pay, spending, EMIs, savings, monthly investments, PF, NPS, and any income that continues after you stop working. You get the earliest age you could stop working, how much money that needs, and the chance it lasts. From there you can fill in as much detail as you like: expenses by category, each investment, goals, loans, property, family, other income and insurance. Each section you complete makes the answer more accurate, and the confidence score shows how much to trust it.

A few things it handles that simpler calculators don't:

- **Emergency fund.** You give one total for your savings, and the planner keeps six months of spending and EMIs aside before counting the rest.
- **Inflation by category.** Everyday costs, healthcare and education each rise at their own rate. Children's costs stop when they become independent.
- **Locked money.** NPS unlocks at 60: 60% as a lump sum, the rest as a pension. Employer superannuation unlocks at 58, a third as a lump sum. Neither counts as spendable before then.
- **Income after you stop.** A spouse who keeps working, a pension, an annuity, rent or part-time work reduces what you draw, each taxed the right way and each with its own start and end age.
- **Tax on withdrawals**, worked out every year under the new regime: slab rates on interest and pensions, 12.5% on equity gains above ₹1.25 lakh, and no exemption for foreign shares.
- **Health cover after FIRE.** Once employer cover ends, a family floater premium is added. It rises with age and with medical inflation.
- **Market ups and downs.** 1,000 simulated market histories give the chance your money lasts, and the ages that give a 3 in 4 and a 9 in 10 chance.
- **Property, goals and lump sums.** Rent, upkeep, planned sales (after capital-gains tax), repeating goals such as a car every eight years, gratuity and policy payouts.

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

- **Before FIRE**, savings grow with your monthly investments (stepping up each year), PF contributions and returns, less any goals that fall due.
- **After FIRE**, each year's withdrawal is the spending for that year: each expense rises at its own rate and is adjusted for life after work. Add health cover, EMIs still running and goals; subtract income that continues; then add tax on top.
- **The corpus needed** at an age is the present value of every withdrawal from then until the age your money should last to. The earliest FIRE age is the first age at which your projected savings reach that amount.
- **Withdrawals** come from three buckets: three years in cash, five in debt, the rest in equity.

### Tests

`npm test` covers four areas:

- **Golden tests** reproduce the original spreadsheet this started from. `scripts/golden-from-sheet.py` recalculates the workbook in LibreOffice and records its outputs. The workbook itself is never committed.
- **Example tests** cover specific cases: tax slabs, NPS and superannuation unlocking, emergency fund, income after FIRE, foreign-share tax, repeating goals and each double-counting rule.
- **Property tests** generate 150 random households and check that the results move in the right direction. More spending never needs less money, more savings never delays FIRE, and quick and detailed entry of the same household give the same answer. The breakdown must also add up.
- **Assistant tests** check question matching, amounts written in different ways, and the answer checker against mistakes small models have actually made.

`scripts/validate.mjs` also checks what the schemas can't: unknown ids, question bindings, allocations that don't add up to 100%, and assumptions outside their own limits.

## Roadmap

- Done: quick pass and live result; detailed sections with a confidence score; nudges; save, open and encrypt; check-ins; tax on withdrawals; income after FIRE; on-device assistant.
- Next: property price data by location, a check-in history chart, offline use (PWA), asset-allocation drift.

## Disclaimer

A planning tool, not investment, tax or legal advice. Tax rules are summarised as of FY2025-26 and marked for verification.
