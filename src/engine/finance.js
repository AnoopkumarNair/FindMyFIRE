// Spreadsheet-compatible time-value-of-money functions.
// Same argument order and sign conventions as Excel / Google Sheets, so
// formulas from the original workbook port over one-to-one.

export function fv(rate, nper, pmt, pv = 0, type = 0) {
  if (rate === 0) return -(pv + pmt * nper);
  const g = (1 + rate) ** nper;
  return -(pv * g + pmt * (1 + rate * type) * (g - 1) / rate);
}

export function pmt(rate, nper, pv, fvTarget = 0, type = 0) {
  if (rate === 0) return -(pv + fvTarget) / nper;
  const g = (1 + rate) ** nper;
  return -(rate * (pv * g + fvTarget)) / ((1 + rate * type) * (g - 1));
}

export function nper(rate, payment, pv, fvTarget = 0, type = 0) {
  if (rate === 0) return -(pv + fvTarget) / payment;
  const p = payment * (1 + rate * type);
  return Math.log((p - fvTarget * rate) / (p + pv * rate)) / Math.log(1 + rate);
}

/** Present value of a list of amounts, the first one paid now (annuity-due). */
export function pvDue(amounts, rate) {
  let pv = 0;
  for (let k = 0; k < amounts.length; k++) pv += amounts[k] / (1 + rate) ** k;
  return pv;
}
