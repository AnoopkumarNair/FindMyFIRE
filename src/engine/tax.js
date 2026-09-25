// Income tax on retirement withdrawals, new regime, from the rules pack's `incomeTax` table.
//
// Each retired year the corpus pays out W. Where that money comes from decides the tax:
// - Debt and cash buckets (3 + 5 years of withdrawals) earn interest / debt-fund gains → slab rates.
// - About W of equity is sold each year to refill them; only the gain part is taxed, at 12.5%
//   above the yearly exemption.
// - Rent (after the 30% standard deduction), pensions and part-time income are slab income too.
// Slabs and exemptions are assumed to rise with inflation, so everything is compared in
// today's rupees.

export function slabTax(income, tax) {
  if (income <= (tax.rebateUpTo ?? 0)) return 0; // Sec 87A rebate
  let owed = 0, from = 0;
  for (const s of tax.slabs) {
    const to = s.upTo ?? Infinity;
    if (income > from) owed += (Math.min(income, to) - from) * s.rate;
    from = to;
  }
  return owed;
}

/**
 * Tax (today's rupees) for a year in which the corpus pays out `w` and `otherSlabIncome`
 * arrives from rent, pension or work. `interestPerRupee` is the slab-taxed return earned by
 * the debt and cash buckets per rupee withdrawn.
 */
export function yearTax(w, otherSlabIncome, { tax, gainShare, interestPerRupee }) {
  const slab = slabTax(w * interestPerRupee + otherSlabIncome, tax);
  const ltcg = tax.ltcgEquityRate * Math.max(0, w * gainShare - tax.ltcgEquityExemption);
  return (slab + ltcg) * (1 + tax.cess);
}

/**
 * Gross withdrawal g that covers `need` plus the year's whole tax bill (including tax on rent or
 * pension): g = need + tax(g). The marginal rate is well under 100%, so this converges.
 */
export function grossUp(need, otherSlabIncome, ctx) {
  if (!ctx.tax) return need;
  let g = need;
  for (let i = 0; i < 40; i++) {
    const next = need + yearTax(g, otherSlabIncome, ctx);
    if (Math.abs(next - g) < 0.5) return next;
    g = next;
  }
  return g;
}
