// Salary-deduction loan: interest monthly on the reducing balance, optional top-ups and pay-downs.

export const amort = (P, i, n) => n <= 0 ? P : i ? P*i/(1 - Math.pow(1 + i, -n)) : P/n;
const monthsToClear = (B, i, E) => i ? Math.ceil(-Math.log(1 - B*i/E)/Math.log(1 + i)) : Math.ceil(B/E);

/**
 * start  balance today; i monthly rate; emi0 deduction; nLeft months left; nOrig original term
 * prepay [{t, cash}] withdrawals paid into the loan; mode 'keep' (same deduction, finish sooner) or 'term' (same end, lower deduction)
 * draws  [{t, amt, mode:'auto'|'orig'|'custom', n, idx}] top-ups borrowed
 * Returns totals and mrows: per month {m, open, int, pay, draw, pre, close, emi}.
 */
export function runLoan(start, i, emi0, nLeft, prepay = [], mode = 'keep', draws = [], nOrig = nLeft){
  let bal = start, emi = emi0, endM = nLeft, interest = 0, salary = 0, m = 0, cDraw = 0, cPre = 0;
  const pre = [], drawLog = [], mrows = [];
  const lastDraw = draws.reduce((a, d) => Math.max(a, d.t), -1);
  const applyDraw = k => draws.forEach(d => {
    if (d.t !== k) return;
    const before = bal; bal += d.amt; cDraw += d.amt;
    let pm = d.mode, months;
    if (pm === 'auto' && !(emi > bal*i + 1)) pm = 'orig';
    if (pm === 'auto') months = monthsToClear(bal, i, emi);
    else { months = pm === 'custom' ? d.n : nOrig; emi = amort(bal, i, months); }
    endM = k + months;
    drawLog.push({idx:d.idx, t:k, amt:d.amt, before, after:bal, emi, n:months, mode:pm, asked:d.mode});
  });
  const applyPre = k => prepay.forEach(p => {
    if (p.t !== k) return;
    if (bal <= 0.5){ pre.push({t:k, cash:p.cash, used:0, after:0, emi}); return; }
    const use = Math.min(p.cash, bal); bal -= use; cPre += use;
    if (mode === 'term' && bal > 0.5) emi = amort(bal, i, Math.max(1, endM - k));
    pre.push({t:k, cash:p.cash, used:use, after:bal, emi});
  });
  applyDraw(0); applyPre(0);
  mrows.push({m:0, open:start, int:0, pay:0, draw:cDraw, pre:cPre, close:Math.max(0, bal), emi}); cDraw = cPre = 0;
  while ((bal > 0.5 || m < lastDraw) && m < 600){
    m++;
    const open = Math.max(0, bal); let int = 0, pay = 0;
    if (bal > 0.5){ int = bal*i; pay = Math.min(emi, bal + int); bal = bal + int - pay; interest += int; salary += pay; }
    applyDraw(m); applyPre(m);
    mrows.push({m, open, int, pay, draw:cDraw, pre:cPre, close:Math.max(0, bal), emi:bal > 0.5 ? emi : 0}); cDraw = cPre = 0;
  }
  prepay.filter(p => p.t > m).forEach(p => pre.push({t:p.t, cash:p.cash, used:0, after:0, emi:0}));
  return {months:m, interest, salary, pre, drawLog, emiEnd:emi, mrows};
}

/** Group a loan path into years (or keep months), folding month 0 events into the first period. */
export function loanPeriods(run, yearly){
  const M = run.mrows, R = M.slice(1).map(x => ({...x}));
  if (!R.length) R.push({...M[0], m:1});
  else { R[0].open = M[0].open; R[0].draw += M[0].draw; R[0].pre += M[0].pre; }
  if (!yearly) return R.map(x => ({k:x.m, ...x}));
  const out = [];
  R.forEach(x => { const y = Math.ceil(x.m/12) - 1;
    const o = out[y] || (out[y] = {k:y + 1, open:x.open, int:0, pay:0, draw:0, pre:0});
    o.int += x.int; o.pay += x.pay; o.draw += x.draw; o.pre += x.pre; o.close = x.close; o.emi = x.emi; o.m = x.m; });
  return out.filter(Boolean);
}
