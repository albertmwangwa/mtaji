// DSE shares: trading costs, history statistics, price forecasts, buy-and-hold and portfolio maths.
import {ratePath} from './sim.js';

export const WHT = 0.05;   // dividend withholding tax
export const SECTOR = {BI:'Banks & finance', IA:'Industrial', CS:'Services'};

/** Total DSE cost on a trade of value v: tiered brokerage + 18% VAT, DSE 0.14%, CMSA 0.14%, Fidelity 0.02%, CDS 0.06% + VAT. */
export function dseFee(v){
  if (v <= 0) return 0;
  const brk = Math.min(v, 10e6)*0.017 + Math.min(Math.max(v - 10e6, 0), 40e6)*0.015 + Math.max(v - 50e6, 0)*0.008;
  return brk*1.18 + v*(0.0014 + 0.0014 + 0.0002) + v*0.0006*1.18;
}
/** Most whole shares cash c buys at price p, fees included. */
export function sharesFor(c, p, fees){
  if (c <= 0 || p <= 0) return 0;
  let n = Math.floor(c/p);
  if (fees) while (n > 0 && n*p + dseFee(n*p) > c) n = Math.min(n - 1, Math.floor(c/(p*(1 + dseFee(n*p)/(n*p)))));
  return Math.max(0, n);
}
/** Last 61 month-end closes (5 years). */
export const last5y = s => (s.monthly?.c || []).slice(-61);

/** Fitted log trend, CAGRs, volatility over the last 5 years of month-end closes. Percent values except vol (decimal). */
export function histStats(s){
  const px = last5y(s), pts = px.map((v, i) => [i/12, v]).filter(p => p[1] > 0);
  if (pts.length < 13) return null;
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => Math.log(p[1]));
  const mx = xs.reduce((a, b) => a + b)/n, my = ys.reduce((a, b) => a + b)/n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++){ sxy += (xs[i] - mx)*(ys[i] - my); sxx += (xs[i] - mx)**2; syy += (ys[i] - my)**2; }
  const slope = sxy/sxx, r2 = syy ? sxy*sxy/(sxx*syy) : 0;
  const rets = []; for (let i = 1; i < px.length; i++) if (px[i] > 0 && px[i - 1] > 0) rets.push(Math.log(px[i]/px[i - 1]));
  const mr = rets.reduce((a, b) => a + b, 0)/rets.length;
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mr)**2, 0)/Math.max(1, rets.length - 1))*Math.sqrt(12);
  const L = px.length - 1, cg = k => L - 12*k >= 0 && px[L - 12*k] > 0 ? (Math.pow(px[L]/px[L - 12*k], 1/k) - 1)*100 : NaN;
  const valid = px.filter(v => v > 0);
  return {trend:(Math.exp(slope) - 1)*100, c5:cg(5), c3:cg(3), c1:cg(1), vol, r2, hi:Math.max(...valid), lo:Math.min(...valid), months:px.length};
}
export const FORECAST = {ease:'5-year trend, easing to 10% a year by year 5', trend:'5-year trend (fitted to 60 monthly closes)', c5:'5-year average growth', c3:'3-year average growth', c1:'Last 12 months', custom:'My own rate'};
/** Yearly price growth path for a share: own rate g (percent), or a basis from its history. */
export function growthPath(s, basis, years, g){
  if (basis === 'custom' || (g != null && g !== '' && Number.isFinite(+g))){ const r = +g || 0; return {path:ratePath(r, r, 2, years, true), g0:r, label:'your rate'}; }
  const h = histStats(s), g0 = h ? (basis === 'ease' ? h.trend : h[basis]) : NaN;
  if (!Number.isFinite(g0)) return {path:ratePath(0, 0, 2, years, true), g0:0, label:'no history, 0%'};
  return basis === 'ease' ? {path:ratePath(g0, 10, 5, years, false), g0, label:'trend easing to 10%'} : {path:ratePath(g0, g0, 2, years, true), g0, label:{trend:'5-yr trend', c5:'5-yr average', c3:'3-yr average', c1:'last 12 months'}[basis]};
}
/** Central price path and an 80% band (10th-90th percentile, lognormal) for each future year. */
export function priceBand(p0, path, vol){
  const out = [{y:0, mid:p0, lo:p0, hi:p0}]; let pr = p0;
  path.forEach((g, i) => { pr *= 1 + g; const z = 1.2816*vol*Math.sqrt(i + 1); out.push({y:i + 1, mid:pr, lo:pr*Math.exp(-z), hi:pr*Math.exp(z)}); });
  return out;
}
/** Regular annual dividend per share and a note on where it came from. */
export function dividendOf(s){
  const d = s.div || {};
  return {dps:d.regular || 0, stale:d.stale, note:d.note, years:d.years || [], list:d.list || []};
}

/** Buy at p0 today, hold `years`, sell at the end. Dividends paid at each year end, taxed, optionally reinvested. */
export function holdSim({p0, amt, years, path, dps0, dg = 0, reinv = false, fees = true}){
  let n = sharesFor(amt, p0, fees), price = p0, divCash = 0, divTot = 0;
  const buyVal = n*p0, buyFee = fees ? dseFee(buyVal) : 0, left = amt - buyVal - buyFee;
  let feeTot = buyFee, reFee = 0;
  const rows = [{y:0, price, n, dps:0, div:0, val:buyVal, cash:0}];
  for (let y = 1; y <= years; y++){
    price *= 1 + path[y - 1];
    const dps = dps0*Math.pow(1 + dg, y - 1), div = n*dps*(1 - WHT);
    divTot += div;
    if (reinv && div > 0){
      const add = sharesFor(div + divCash, price, fees), cost = add*price, f = fees ? dseFee(cost) : 0;
      n += add; divCash = div + divCash - cost - f; feeTot += f; reFee += f;
    } else divCash += div;
    rows.push({y, price, n, dps, div, val:n*price, cash:divCash});
  }
  const last = rows[rows.length - 1], sellFee = fees ? dseFee(last.val) : 0;
  feeTot += sellFee;
  const sale = last.val - sellFee, end = sale + divCash + left;
  return {rows, end, sale, divCash, divTot, feeTot, buyFee, reFee, sellFee, buyVal, left, n0:rows[0].n,
    irr:amt > 0 && end > 0 ? Math.pow(end/amt, 1/years) - 1 : NaN,
    breakEven:rows[0].n > 0 ? ((buyVal + buyFee)/rows[0].n)/(1 - (fees ? dseFee(buyVal + buyFee)/(buyVal + buyFee) : 0)) : 0};
}

/** Annual volatility of a weighted mix, from the covariance of monthly log returns over the last 5 years. */
export function mixVol(series, w){
  const R = series.map(s => { const px = last5y(s), r = []; for (let i = 1; i < px.length; i++) r.push(px[i] > 0 && px[i - 1] > 0 ? Math.log(px[i]/px[i - 1]) : 0); return r; });
  const L = Math.min(...R.map(r => r.length)); if (!(L >= 12)) return NaN;
  const m = R.map(r => r.slice(-L).reduce((a, b) => a + b, 0)/L), RR = R.map(r => r.slice(-L));
  let v = 0;
  for (let i = 0; i < RR.length; i++) for (let j = 0; j < RR.length; j++){
    let c = 0; for (let k = 0; k < L; k++) c += (RR[i][k] - m[i])*(RR[j][k] - m[j]);
    v += w[i]*w[j]*c/(L - 1);
  }
  return Math.sqrt(Math.max(0, v)*12);
}
