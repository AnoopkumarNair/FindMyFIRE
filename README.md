# FindMyFIRE — local-first FIRE planner (India)

A guided FIRE calculator that runs entirely in the browser. Your data lives in a JSON file on your device, never on a server. No accounts, no analytics, no LLM.

## How it fits together

| Piece | File | Who owns it | Contains personal data? |
|---|---|---|---|
| Rules pack | `rules/in.2026.1.json` | This repo, updated after each Union Budget | No |
| User file | Created by the UI, saved on the user's device | The user | Yes |
| Engine *(next)* | `src/engine/` | This repo | No — pure functions |

The contract between them is two JSON Schemas in `schemas/`.

- **`rules-pack.schema.json`**: India-specific knowledge. It covers the question flow, expense catalogue, instrument catalogue (lock-ins, tax treatment), assumptions, tiers, scenarios and nudges. Update this file when rules change; the code stays as it is.
- **`user-file.schema.json`**: one household's answers. Every list item carries a `source` of `exact`, `estimate` or `default`. Scalar answers record theirs in `provenance`.

## Quick answer first, refine later

1. **Quick pass (9 questions).** These fill `/quick/*` and give a first FIRE age with a confidence score.
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

## Keeping it honest

- `npm test` validates every rules pack and example against the schemas. It then checks cross-references that schemas can't express:
  - unknown instrument, category, goal or section ids
  - question binds that don't exist in the user schema
  - allocations that don't sum to 100%
  - broken child links
  - assumptions outside their own min/max
- Every tax item or administered rate that changes with Budgets or EPFO/PFRDA notices has `verify: true`. Re-check them all when publishing a new pack version.
- User files carry `schemaVersion` and `rulesPackVersion`, so the app can migrate old files forward. Never mutate a published pack; ship `in.2027.1.json`.

## Privacy rules for the app

- Static hosting only.
- A Content-Security-Policy with `connect-src 'self'`, so the page cannot send data anywhere.
- No analytics or third-party scripts.
- Working copy in IndexedDB, autosaved. Explicit Save / Open for the JSON file.
- Optional passphrase encryption of the file (WebCrypto AES-GCM).

## Roadmap

1. ✅ Schemas, India rules pack, examples, validator
2. Port the engine (year-by-year projection, required corpus, earliest age, scenarios) with golden tests taken from the Google Sheets template
3. Quick-pass UI + live result
4. Refine sections, confidence meter, nudges
5. Save/Open/encrypt, snapshots chart, PWA offline

## Disclaimer

Planning tool, not investment, tax or legal advice. Tax rules summarised as of FY2025-26 and flagged for verification.
