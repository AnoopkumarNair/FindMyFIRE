// Plain-English meanings, written by hand and reviewed. The assistant shows these as they are
// (the model may only reword them), so every definition here is the one the app stands behind.

export const GLOSSARY = {
  fire: {
    names: ["fire", "financial independence", "retire early", "financially independent"],
    text: "FIRE means Financial Independence, Retire Early: having enough invested that its returns and planned withdrawals pay your costs for life, so paid work becomes optional.",
  },
  corpus: {
    names: ["corpus"],
    text: "The corpus is the money you invest for FIRE. The corpus needed is the amount that, invested at the assumed return after FIRE, pays every year's withdrawals until your plan-until age.",
  },
  swp: {
    names: ["swp", "systematic withdrawal"],
    text: "An SWP (systematic withdrawal plan) takes a fixed amount out of your investments every month, like a salary. The rest stays invested and keeps growing.",
  },
  buckets: {
    names: ["bucket", "buckets", "bucket strategy"],
    text: "The bucket method keeps about 3 years of withdrawals in cash-like savings, the next 5 years in debt funds, and the rest in equity. You spend from cash and refill it every year, so a market fall doesn't force you to sell equity at a low.",
  },
  inflation: {
    names: ["inflation"],
    text: "Inflation is how fast prices rise. At 6% a year, what costs ₹1 lakh today costs about ₹1.8 lakh in 10 years. Healthcare and education usually rise faster than other costs.",
  },
  real_return: {
    names: ["real return", "inflation-adjusted return", "real returns"],
    text: "The real return is what your money earns after inflation. A 10% return with 6% inflation is roughly a 4% real return: that is how fast your buying power grows.",
  },
  step_up: {
    names: ["step-up", "step up", "stepup", "top-up sip", "step-up sip"],
    text: "A step-up SIP raises your monthly investment by a fixed percentage every year, usually in line with pay rises.",
  },
  epf: {
    names: ["epf", "pf", "provident fund", "vpf"],
    text: "EPF (provident fund) takes 12% of your basic pay each month, and your employer adds a matching share. It earns a fixed rate set each year and is counted separately from the money you invest yourself.",
  },
  nps: {
    names: ["nps", "national pension"],
    text: "NPS (National Pension System) is mostly locked until 60. At 60 part of it can be taken as a lump sum and the rest buys an annuity that pays a monthly pension. This plan assumes 60% as a lump sum and 40% into an annuity.",
  },
  ltcg: {
    names: ["ltcg", "capital gains", "long term capital gain", "long-term capital gains"],
    text: "Long-term capital gains tax applies when you sell investments held long enough. For equity it is 12.5% on gains above ₹1.25 lakh a year.",
  },
  monte_carlo: {
    names: ["monte carlo", "simulation", "simulated", "market histories"],
    text: "The chance figures come from running your plan through 1,000 made-up market histories, with good and bad years in random order, and counting how often the money lasts. A bad run just after you stop working hurts most.",
  },
  sequence_risk: {
    names: ["sequence risk", "sequence of returns", "bad years early"],
    text: "Sequence risk: two retirements with the same average return can end very differently. If markets fall in the first few years, withdrawals eat into a smaller corpus and it may not recover.",
  },
  withdrawal_rate: {
    names: ["withdrawal rate", "4% rule", "safe withdrawal", "4 percent rule"],
    text: "The withdrawal rate is the first year's withdrawal as a share of the corpus. The \"4% rule\" comes from US data. This app instead works out the corpus from your own year-by-year costs, taxes and Indian inflation.",
  },
  emergency_fund: {
    names: ["emergency fund", "contingency fund"],
    text: "An emergency fund is money kept aside for surprises, usually 6 months of expenses in a savings account or liquid fund. It isn't counted in the FIRE corpus.",
  },
  confidence: {
    names: ["confidence score", "confidence"],
    text: "The confidence score shows how much of your plan is based on detailed, checked numbers rather than quick estimates. Filling in more sections raises it.",
  },
  coast_fire: {
    names: ["coast fire", "coastfire", "coast"],
    text: "Coast FIRE is the point where what you have already invested will grow to the corpus you need by your target age, even if you stop adding to it.",
  },
};

/** The glossary entry a question names, or null. Longer names win ("real return" over "return"). */
export function termIn(text) {
  const t = String(text).toLowerCase();
  let best = null, len = 0;
  for (const [id, g] of Object.entries(GLOSSARY))
    for (const n of g.names)
      if (n.length > len && new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}([^a-z]|$)`).test(t)) { best = id; len = n.length; }
  return best;
}
