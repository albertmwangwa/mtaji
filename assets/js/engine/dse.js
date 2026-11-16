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
export const FORECAST = {model:'Mtaji model (rebuilt from DSE data at every refresh)', ease:'5-year trend, easing to 10% a year by year 5', trend:'5-year trend (fitted to 60 monthly closes)', c5:'5-year average growth', c3:'3-year average growth', c1:'Last 12 months', custom:'My own rate'};
/** Yearly price growth path for a share: own rate g (percent), or a basis from its history. */
export function growthPath(s, basis, years, g){
  if (basis === 'custom' || (g != null && g !== '' && Number.isFinite(+g))){ const r = +g || 0; return {path:ratePath(r, r, 2, years, true), g0:r, label:'your rate'}; }
  if (basis === 'model'){
    if (s.model && Number.isFinite(s.model.g)){ const r = s.model.g*100; return {path:ratePath(r, r, 2, years, true), g0:r, label:'Mtaji model'}; }
    basis = 'ease';
  }
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

/** Buy in year `start` (0 = today) at the forecast price then, hold to the end of year `years`, sell.
 *  Dividends are paid at each year end while held, taxed, optionally reinvested. Rows before the purchase have n = 0. */
export function holdSim({p0, amt, years, path, dps0, dg = 0, reinv = false, fees = true, start = 0}){
  start = Math.max(0, Math.min(Math.round(start) || 0, years - 1));
  let price = p0;
  const rows = [];
  for (let y = 0; y < start; y++){ rows.push({y, price, n:0, dps:0, div:0, val:0, cash:0, pre:true}); price *= 1 + path[y]; }
  const pBuy = price, n0 = sharesFor(amt, pBuy, fees);
  let n = n0, divCash = 0, divTot = 0;
  const buyVal = n*pBuy, buyFee = fees ? dseFee(buyVal) : 0, left = amt - buyVal - buyFee;
  let feeTot = buyFee, reFee = 0;
  rows.push({y:start, price, n, dps:0, div:0, val:buyVal, cash:0});
  for (let y = start + 1; y <= years; y++){
    price *= 1 + path[y - 1];
    const dps = dps0*Math.pow(1 + dg, y - 1), div = n*dps*(1 - WHT);
    divTot += div;
    if (reinv && div > 0){
      const add = sharesFor(div + divCash, price, fees), cost = add*price, f = fees ? dseFee(cost) : 0;
      n += add; divCash = div + divCash - cost - f; feeTot += f; reFee += f;
    } else divCash += div;
    rows.push({y, price, n, dps, div, val:n*price, cash:divCash});
  }
  const last = rows[rows.length - 1], sellFee = fees ? dseFee(last.val) : 0, held = years - start;
  feeTot += sellFee;
  const sale = last.val - sellFee, end = sale + divCash + left;
  return {rows, end, sale, divCash, divTot, feeTot, buyFee, reFee, sellFee, buyVal, left, n0, start, pBuy, held,
    irr:amt > 0 && end > 0 ? Math.pow(end/amt, 1/held) - 1 : NaN,
    breakEven:n0 > 0 ? ((buyVal + buyFee)/n0)/(1 - (fees ? dseFee(buyVal + buyFee)/(buyVal + buyFee) : 0)) : 0};
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

/* ---------- Mtaji model (pipeline/model.py): ranges for each horizon, rebuilt at every refresh ---------- */
export const HORIZON = [['1d', 'Next session'], ['1w', '1 week'], ['1m', '1 month'], ['3m', '3 months'], ['1y', '1 year'], ['2y', '2 years'], ['3y', '3 years'], ['5y', '5 years']];
export const HORIZON_YEARS = {'1d':1/252, '1w':5/252, '1m':21/252, '3m':63/252, '1y':1, '2y':2, '3y':3, '5y':5};
/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
export function ncdf(x){
  const t = 1/(1 + 0.3275911*Math.abs(x)/Math.SQRT2), y = 1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - 0.284496736)*t + 0.254829592)*t*Math.exp(-x*x/2);
  return x >= 0 ? (1 + y)/2 : (1 - y)/2;
}
/** Chance that holding the share for `years` (price + dividends after 5% tax) beats a T-bill rolled at yield rf (after tax),
 *  from the model's central growth and its own 1-year range. */
export function beatChance(s, years, rf){
  const m = s.model; if (!m?.h?.['1y']) return NaN;
  const [lo, mid, hi] = m.h['1y'], sd = Math.log(hi/lo)/(2*1.2816), dy = (dividendOf(s).dps || 0)/s.close*(1 - WHT);
  const mu = Math.log(1 + m.g) + Math.log(1 + dy) - Math.log(1 + rf);
  return ncdf(mu*years/(sd*Math.sqrt(years)));
}
