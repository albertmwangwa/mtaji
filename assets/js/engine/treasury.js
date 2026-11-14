// Government securities: discount T-bills and semi-annual coupon T-bonds.

export const billPrice = (y, d) => 100/(1 + y*d/365);
/** amount is face value (mode 'face') or cash to invest; y yield (decimal); d days; wht tax on the discount. */
export function bill(amount, mode, y, d, wht){
  const p = billPrice(y, d), face = mode === 'face' ? amount : amount*100/p;
  const cost = face*p/100, disc = face - cost, tax = disc*wht, netInt = disc - tax, rec = face - tax;
  return {p, face, cost, disc, tax, netInt, rec, ny:cost > 0 ? (netInt/cost)*365/d : 0};
}
/** Clean price per 100 of a bond with coupon c (%), yield y (decimal), n years, semi-annual. */
export function bondPrice(c, y, n){
  const N = n*2, i = y/2, k = c/2;
  if (i === 0) return k*N + 100;
  return k*(1 - Math.pow(1 + i, -N))/i + 100*Math.pow(1 + i, -N);
}
export function irr(flows){
  const npv = r => flows.reduce((s, cf, t) => s + cf/Math.pow(1 + r, t), 0);
  let lo = -0.9, hi = 1;
  if (npv(lo)*npv(hi) > 0) return NaN;
  for (let j = 0; j < 100; j++){ const m = (lo + hi)/2; if (npv(lo)*npv(m) <= 0) hi = m; else lo = m; }
  return (lo + hi)/2;
}
