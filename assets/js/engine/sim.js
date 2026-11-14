// Monthly compounding engine for unit trusts and savings plans.

/**
 * Simulate a plan month by month.
 * initial      lump sum at month 0
 * pmt, every   top-up amount and how often (months); offset = month of the first top-up (0 = with the lump sum)
 * step         yearly increase of the top-up (decimal)
 * mRate        monthly rate when no yearly path is given; yr = annual rates per year (decimals, last one repeats)
 * specials     [{t, amt}] one-off contributions at month t
 * withdrawals  [{t, amt, u}] cash taken out at month t; u = 'l' (pays a loan) or 'p' (personal)
 * wdLoad       exit charge (decimal): units sold to cover a withdrawal are grossed up by it
 */
export function simulate({initial = 0, pmt = 0, every = 1, offset = 0, step = 0, mRate = 0, months = 12, specials = [], withdrawals = [], wdLoad = 0, yr = null}){
  every = Math.max(1, Math.round(every)); offset = Math.max(0, Math.round(offset));
  let bal = initial, inv = initial, yrC = 0, yrS = 0, yrW = 0, count = 0, first = null, last = null, spTotal = 0, spCount = 0;
  let wdTotal = 0, wdGross = 0, wdCount = 0, wdShort = false, topTotal = 0;
  const wdEvents = [], rows = [{year:0, contrib:initial, special:0, withdrawn:0, wdCum:0, inv, bal}], mrows = [];
  const takeOut = t => withdrawals.forEach(w => {
    if (w.t !== t || !(w.amt > 0)) return;
    const need = w.amt/(1 - wdLoad), g = Math.min(need, Math.max(0, bal));
    if (g < need - 0.5) wdShort = true;
    const cash = g*(1 - wdLoad);
    bal -= g; wdGross += g; wdTotal += cash; yrW += cash; wdCount++;
    if (cash > 0) wdEvents.push({t, cash, u:w.u || 'p'});
  });
  const due = t => pmt > 0 && t >= offset && (t - offset) % every === 0 && (offset === 0 ? t < months : t <= months);
  const add = t => {
    const yi = Math.max(0, offset === 0 ? Math.floor(t/12) : Math.floor((t - 1)/12));
    const a = pmt*Math.pow(1 + step, yi);
    bal += a; inv += a; yrC += a; topTotal += a; count++; if (first === null) first = t; last = t;
  };
  const addSpecial = t => specials.forEach(s => { if (s.t === t && s.amt > 0){ bal += s.amt; inv += s.amt; yrC += s.amt; yrS += s.amt; spTotal += s.amt; spCount++; } });
  if (due(0)) add(0);
  addSpecial(0); takeOut(0);
  const mOf = yi => yr && yr.length ? Math.pow(1 + yr[Math.min(yi, yr.length - 1)], 1/12) - 1 : mRate;
  const aOf = yi => yr && yr.length ? yr[Math.min(yi, yr.length - 1)] : Math.pow(1 + mRate, 12) - 1;
  for (let k = 1; k <= months; k++){
    const mr = mOf(Math.floor((k - 1)/12)), b0 = bal, i0 = inv, w0 = wdTotal;
    bal *= 1 + mr;
    const earned = bal - b0;
    if (due(k)) add(k);
    addSpecial(k); takeOut(k);
    mrows.push({m:k, rate:mr, earned, open:b0, contrib:inv - i0, withdrawn:wdTotal - w0, wdCum:wdTotal, inv, bal});
    if (k % 12 === 0 || k === months){
      rows.push({year:Math.ceil(k/12), contrib:yrC, special:yrS, withdrawn:yrW, wdCum:wdTotal, inv, bal, rate:aOf(Math.ceil(k/12) - 1)});
      yrC = yrS = yrW = 0;
    }
  }
  return {bal, inv, rows, mrows, count, first, last, spTotal, spCount, wdTotal, wdGross, wdCount, wdShort, wdEvents, topTotal, initial};
}

/** Annual rates per year: start at r0 %, move in equal steps to lr % by year n, then hold (flat = r0 every year). */
export function ratePath(r0, lr, n, years, flat){
  return Array.from({length:Math.max(1, years)}, (_, i) => (flat ? r0 : i >= n - 1 ? lr : r0 + (lr - r0)*i/(n - 1))/100);
}
export const geoAvg = path => Math.pow(path.reduce((a, r) => a*(1 + r), 1), 1/path.length) - 1;

/* Projection bases a fund may offer, best first when the chosen one is missing. */
export const BASIS = {y3:'3-year average', y5:'5-year average', y1:'Last 12 months', ytda:'This year, annualised', m3a:'Last 3 months, annualised', inca:'Since launch, annualised'};
export const LONG_RUN = {mm:11, fi:11.5, bal:13, eq:14};
export function rateFor(f, basis){
  for (const k of [basis, 'y3', 'y1', 'm3a', 'inca']) if (BASIS[k] && Number.isFinite(f.ret?.[k])) return {k, r:f.ret[k]};
  return {k:null, r:NaN};
}
export const calcable = f => f && f.nav && f.cur === 'TZS' && ['y3', 'y1', 'm3a', 'inca'].some(k => Number.isFinite(f.ret?.[k]));

/** One-off amounts entered by year: {y, w (0 start / 6 mid / 12 end), a, u} -> month events. */
export const WHEN = [['0', 'Start of year'], ['6', 'Mid-year'], ['12', 'End of year']];
export const toEvents = (arr, years) => arr.filter(r => r.a > 0 && r.y >= 1)
  .map(r => ({t:(Math.round(r.y) - 1)*12 + (+r.w), amt:r.a, u:r.u === 'l' ? 'l' : 'p'})).filter(e => e.t <= years*12);
