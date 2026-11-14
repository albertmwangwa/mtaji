// Fund planner: lump sum + top-ups + one-off amounts + withdrawals (to a loan or personal) + a salary loan.
import {db, fundsPriced, managers, CAT} from '../data.js';
import {fmt, fmt2, compact, money as tzs, pct, pp, ppHtml, mstr, addMonths, esc, clamp} from '../lib/fmt.js';
import {$, $$, bind, list, load, persist, money, number, seg, check, opt, stat, kpi, table} from '../lib/ui.js';
import {draw, bar, line, colors} from '../lib/charts.js';
import {simulate, ratePath, geoAvg, BASIS, LONG_RUN, rateFor, calcable, WHEN, toEvents} from '../engine/sim.js';
import {amort, runLoan, loanPeriods} from '../engine/loan.js';

const DEF = {fund:'utt.liquid', basis:'y1', rate:11.77, path:'fade', lr:11, lrn:5, years:10, init:10e6, add:500e3, freq:'1', every:2, off:1, step:0,
  exit:false, view:'y', lview:'y', alt:'all', sp:[], sw:[], lb:[], lamt:0, lrate:17, lpaid:0, ln:36, lmode:'keep'};

export default function plan(app, fundId){
  const st = load('plan', DEF);
  if (fundId && db.byId[fundId] && calcable(db.byId[fundId])){ st.fund = fundId; st.basis = 'y1'; }
  const funds = fundsPriced().filter(calcable);
  if (st.fund !== 'custom' && !db.byId[st.fund]) st.fund = 'utt.liquid';
  const fundOpts = managers().map(m => ({group:m, items:funds.filter(f => f.mgr === m).map(f => [f.id, f.name])})).filter(g => g.items.length);

  app.innerHTML = `
  <div class="page-head"><div><h1>Fund planner</h1><p>See how a unit trust plan grows month by month: a lump sum, regular top-ups, one-off amounts, withdrawals for a loan or for yourself, and the loan itself.</p></div></div>
  <div class="planner">
    <form class="card inputs" onsubmit="return false">
      <div class="field"><label for="f-fund">Fund</label><div class="box"><select id="f-fund" name="fund">${fundOpts.map(g => `<optgroup label="${esc(g.group)}">${g.items.map(i => opt(i[0], i[1])).join('')}</optgroup>`).join('')}${opt('custom', 'Custom rate (any fund)')}</select></div><p class="hint" id="fund-note"></p></div>
      <div class="field"><label for="f-basis">Project using</label><div class="box"><select id="f-basis" name="basis"></select></div></div>
      ${number('rate', 'Return in year 1', '% / yr', {min:-50, max:150, step:0.01, slider:[0, 40, 0.1], aside:' '})}
      <div class="field"><span class="lbl">Growth path</span>${seg('path', [['fade', 'Ease to long-run rate'], ['flat', 'Same rate every year']], {label:'Growth path'})}</div>
      <div class="two" id="path-f">${number('lr', 'Long-run rate', '%', {min:0, max:40, step:0.5})}${number('lrn', 'Reached by year', '', {min:2, max:30})}</div>
      <p class="hint" id="path-note"></p>
      ${number('years', 'Invest for', 'years', {min:1, max:60, slider:[1, 40, 1]})}
      <div class="section-t">Money in</div>
      ${money('init', 'Lump sum today')}
      ${money('add', 'Regular top-up', {max:50e6})}
      <div class="field"><span class="lbl">Every</span>${seg('freq', [['1', 'Month'], ['3', 'Quarter'], ['12', 'Year'], ['c', 'Custom']], {label:'Top-up frequency'})}</div>
      <div id="every-f">${number('every', 'Every', 'months', {min:1, max:60})}</div>
      <div class="two">${number('off', 'First top-up after', 'months', {min:0, max:120})}${number('step', 'Raise top-up yearly by', '%', {min:0, max:50})}</div>
      <p class="hint" id="sched"></p>
      <div class="field"><div class="lbl-row"><span class="lbl">Special contributions</span><small>bonus, gratuity, a sale</small></div><div class="rows" id="sp"></div><button type="button" class="btn ghost sm" id="sp-add">+ Add contribution</button></div>
      <div class="section-t">Money out</div>
      <div class="field"><div class="lbl-row"><span class="lbl">Special withdrawals</span><small>choose where each goes</small></div><div class="rows" id="sw"></div><button type="button" class="btn ghost sm" id="sw-add">+ Add withdrawal</button>
        <p class="hint"><b>Loan payment</b> pays it into the loan below; <b>Personal use</b> keeps it as cash for you. Either way it stops growing once it leaves the fund.</p></div>
      <div id="exit-f">${check('exit', 'Deduct the exit charge when you sell (<b id="exit-pct"></b>)')}</div>
      <div class="section-t">Salary loan <span class="mut" style="text-transform:none;letter-spacing:0;font-weight:400">optional</span></div>
      ${money('lamt', 'Loan amount')}
      <div class="two">${number('lrate', 'Interest', '% / yr', {min:0, max:60, step:0.1})}${number('lpaid', 'Already repaid', 'months', {min:0, max:360})}</div>
      ${number('ln', 'Repayment period', 'months', {min:1, max:360, slider:[1, 120, 1], hint:'Sets the monthly salary deduction. Interest is charged monthly on the reducing balance.'})}
      <div class="field"><div class="lbl-row"><span class="lbl">Loan top-ups</span><small>borrow more later</small></div><div class="rows" id="lb"></div><button type="button" class="btn ghost sm" id="lb-add">+ Add top-up</button></div>
      <div class="field" id="lmode-f"><span class="lbl">When a withdrawal is paid in</span>${seg('lmode', [['keep', 'Same deduction, finish sooner'], ['term', 'Same end date, lower deduction']], {label:'After a pay-down'})}</div>
    </form>

    <div class="stack" id="out">
      <div class="stats soft" id="track"></div>
      <div class="grid g4" id="kpis"></div>
      <div class="card"><div class="card-head"><h2>Your money at a glance</h2></div><div class="flow" id="flow"></div><p class="note" id="sp-note" style="margin-top:14px" hidden></p></div>
      <div class="card">
        <div class="card-head"><h2>How the money builds</h2>${seg('view', [['y', 'Yearly'], ['m', 'Monthly'], ['e', 'Monthly earnings']], {cls:'sm', label:'Show by'})}</div>
        <div class="stats soft" id="mstrip" style="margin-bottom:12px"></div>
        <div class="legend" id="leg"></div>
        <div class="chart lg"><canvas id="ch"></canvas></div>
        <p class="hint" style="margin-top:8px" id="ch-hint"></p>
        <details style="margin-top:12px"><summary class="lbl" id="tbl-sum" style="cursor:pointer">Table</summary><div class="tbl scroll" style="margin-top:10px" id="tbl"></div></details>
      </div>
      <div class="card" id="loan-card">
        <div class="card-head"><div><h2>Loan path</h2><p id="loan-sub"></p></div>${seg('lview', [['y', 'Yearly'], ['m', 'Monthly']], {cls:'sm', label:'Loan path by'})}</div>
        <div class="stats soft" id="lkpi" style="margin-bottom:12px"></div>
        <p class="note" id="lnote" style="margin-bottom:12px" hidden></p>
        <div class="legend" id="lleg"></div>
        <div class="chart lg"><canvas id="lch"></canvas></div>
        <p class="hint" style="margin-top:8px" id="lhint"></p>
        <div class="tbl" style="margin-top:12px" id="levents" hidden></div>
        <details style="margin-top:12px"><summary class="lbl" style="cursor:pointer" id="ltbl-sum">Loan table</summary><div class="tbl scroll" style="margin-top:10px" id="ltbl"></div></details>
      </div>
      <div class="card"><div class="card-head"><div><h2>Compare plans</h2><p>Same fund, rate and years; each row changes one thing.</p></div></div><div class="tbl" id="cmp"></div></div>
      <div class="card">
        <div class="card-head"><div><h2>Same plan in other funds</h2><p>Your amounts, withdrawals and growth path run through each fund's own record.</p></div>
          ${seg('alt', [['all', 'All'], ['mm', 'Money mkt'], ['fi', 'Fixed inc.'], ['bal', 'Balanced'], ['eq', 'Equity']], {cls:'sm', label:'Fund type'})}</div>
        <div class="tbl" id="alt"></div>
        <p class="hint" style="margin-top:8px">Each fund starts at its return for the period under "Project using" (or the nearest one it has) and, with "Ease to long-run", steps to the long-run rate for its type. Short records and one-off rallies make poor long-run guides.</p>
      </div>
    </div>
  </div>`;

  const today = new Date(), when = m => mstr(addMonths(today, m));
  const fundOf = () => st.fund === 'custom' ? null : db.byId[st.fund];

  /* ---- basis options depend on the fund ---- */
  function syncBasis(){
    const f = fundOf(), sel = $('#f-basis', app);
    const opts = Object.entries(BASIS).filter(([k]) => f && Number.isFinite(f.ret?.[k]));
    sel.innerHTML = opts.map(([k, t]) => opt(k, `${t} (${f.ret[k].toFixed(2)}%)`, st.basis)).join('') + opt('custom', 'My own rate', st.basis);
    if (!opts.some(o => o[0] === st.basis) && st.basis !== 'custom') st.basis = opts[0]?.[0] || 'custom';
    if (!f) st.basis = 'custom';
    sel.value = st.basis;
  }
  function applyFund(){
    syncBasis();
    const f = fundOf();
    if (f){ st.lr = LONG_RUN[f.cat] ?? 12; if (st.basis !== 'custom') st.rate = +f.ret[st.basis].toFixed(2); }
    b.write();
  }

  /* ---- lists ---- */
  const yrBox = (r, k) => `<div class="box"><span>Year</span><input type="number" min="1" max="60" data-f="y" value="${r.y}" aria-label="Year"></div>`;
  const whenBox = r => `<div class="box"><select data-f="w" aria-label="When in the year">${WHEN.map(w => opt(w[0], w[1], r.w)).join('')}</select></div>`;
  const amtBox = (r, lbl) => `<div class="box wide"><span>${lbl}</span><input data-f="a" data-money inputmode="decimal" value="${fmt(r.a)}" aria-label="Amount"></div>`;
  const del = '<button type="button" class="icon-btn" data-del aria-label="Remove">×</button>';
  const changed = () => { persist('plan', st); update(); };
  const SP = list($('#sp', app), st.sp, (r, i) => `<div class="row-item" data-i="${i}">${yrBox(r)}${whenBox(r)}${del}${amtBox(r, 'TZS')}</div>`, changed);
  const SW = list($('#sw', app), st.sw, (r, i) => `<div class="row-item${r.u === 'l' ? ' loan' : ''}" data-i="${i}">${yrBox(r)}${whenBox(r)}${del}${amtBox(r, '− TZS')}
    <div class="box wide"><span>Goes to</span><select data-f="u" aria-label="Where this withdrawal goes">${opt('l', 'Loan payment', r.u)}${opt('p', 'Personal use', r.u === 'l' ? 'l' : 'p')}</select></div></div>`, changed);
  const LB = list($('#lb', app), st.lb, (r, i) => `<div class="row-item" data-i="${i}">${yrBox(r)}${whenBox(r)}${del}${amtBox(r, 'Borrow TZS')}
    <div class="box wide"><select data-f="mode" aria-label="New repayment period">${opt('auto', 'Keep today\'s deduction, work out the months', r.mode)}${opt('orig', 'Restart the original term', r.mode)}${opt('custom', 'Set the months', r.mode)}</select></div>
    ${r.mode === 'custom' ? `<div class="box wide"><span>Repay over</span><input type="number" min="1" max="360" data-f="n" value="${r.n || 36}"><span>months</span></div>` : ''}<div class="res" id="lb-r-${i}"></div></div>`, changed);
  $('#sp-add', app).onclick = () => SP.add({y:Math.min(st.years, (st.sp.at(-1)?.y || 0) + 1), w:'12', a:10e6});
  $('#sw-add', app).onclick = () => SW.add({y:Math.min(st.years, (st.sw.at(-1)?.y || 0) + 1), w:'12', a:5e6, u:st.lamt > 0 || st.lb.length ? 'l' : 'p'});
  $('#lb-add', app).onclick = () => LB.add({y:(st.lb.at(-1)?.y || 0) + 1, w:'0', a:20e6, mode:'auto', n:36});

  const b = bind($('form', app), st, k => {
    if (k === 'fund' || k === 'basis') applyFund();
    if (k === 'rate'){ st.basis = 'custom'; $('#f-basis', app).value = 'custom'; }
    persist('plan', st); update();
  });
  bind($('#out', app), st, () => { persist('plan', st); update(); });
  syncBasis(); b.write();

  /* ---------------- the calculation ---------------- */
  function update(){
    const c = colors(), f = fundOf();
    const years = clamp(Math.round(st.years) || 1, 1, 60), flat = st.path === 'flat', lrn = clamp(Math.round(st.lrn) || 5, 2, 30);
    const loadPct = f && f.rep && f.nav ? 1 - f.rep/f.nav : 0, useLoad = st.exit && loadPct > 0 ? loadPct : 0;
    $('#exit-f', app).hidden = !(loadPct > 0); $('#exit-pct', app).textContent = (loadPct*100).toFixed(1) + '%';
    $('#path-f', app).hidden = flat; $('#every-f', app).hidden = st.freq !== 'c';
    $('#fund-note', app).innerHTML = f ? esc(f.desc || '') + (f.dpu ? ' The projection assumes the payouts are reinvested.' : '') : 'Enter the return you expect.';
    $('#aside-rate', app).textContent = st.basis === 'custom' ? 'your rate' : BASIS[st.basis] || '';
    const path = ratePath(st.rate, st.lr, lrn, years, flat), avg = geoAvg(path);
    $('#path-note', app).innerHTML = flat ? `Every year earns <b>${st.rate.toFixed(2)}%</b>.` : `Year 1 earns <b>${st.rate.toFixed(2)}%</b>, stepping to <b>${(+st.lr).toFixed(2)}%</b> by year ${lrn}. Average <b>${pct(avg)}</b> a year over ${years} years.`;
    $('#track', app).innerHTML = f ? [['m1', 'Last month'], ['m3', '3 months'], ['y1', '12 months'], ['y3', '3 years / yr'], ['inc', 'Since launch']].filter(([k]) => Number.isFinite(f.ret[k])).slice(0, 3)
      .map(([k, t]) => stat(t, ppHtml(f.ret[k]))).join('') + stat('Price / unit', fmt2(f.nav, 4), f.mgrShort) : '';

    const every = st.freq === 'c' ? Math.max(1, Math.round(st.every)) : +st.freq;
    const base = {initial:st.init, pmt:st.add, every, offset:st.off, step:st.step/100, months:years*12, yr:path};
    const sp = toEvents(st.sp, years), sw = toEvents(st.sw, years);
    const sim = simulate({...base, specials:sp, withdrawals:sw, wdLoad:useLoad});
    const withC = simulate({...base, specials:sp}).bal, without = simulate(base).bal;
    const charge = useLoad ? sim.bal*useLoad : 0, net = sim.bal - charge, wealth = net + sim.wdTotal, growth = wealth - sim.inv, multiple = sim.inv ? wealth/sim.inv : 0;
    // mark one-off rows that fall after the plan ends
    [['#sp', st.sp], ['#sw', st.sw]].forEach(([sel, arr]) => $$(sel + ' [data-i]', app).forEach(row => { const r = arr[+row.dataset.i]; if (r) row.classList.toggle('out', (Math.round(r.y) - 1)*12 + (+r.w) > years*12); }));
    $('#sched', app).textContent = !st.add ? 'No regular top-ups.' : !sim.count ? 'The first top-up falls after the plan ends.' :
      `${sim.count} top-ups totalling TZS ${fmt(sim.topTotal)}, first in ${when(sim.first)}${sim.count > 1 ? ', last in ' + when(sim.last) : ''}.`;

    /* loan */
    const draws = st.lb.map((r, idx) => ({idx, t:(Math.round(r.y) - 1)*12 + (+r.w), amt:r.a, mode:r.mode || 'auto', n:Math.max(1, Math.round(r.n || 36)), ok:r.a > 0 && r.y >= 1})).filter(d => d.ok);
    const P = st.lamt, li = st.lrate/1200, ln = Math.max(1, Math.round(st.ln)), paid = Math.min(Math.max(0, Math.round(st.lpaid)), ln - 1);
    const loanOn = P > 0 || draws.length > 0;
    const loanEv = loanOn ? sim.wdEvents.filter(e => e.u === 'l') : [];
    const wdLoan = loanEv.reduce((a, e) => a + e.cash, 0);

    $('#kpis', app).innerHTML = kpi('Left in the fund after ' + years + ' years', tzs(net), (charge ? 'after ' + compact(charge) + ' exit charge · ' : '') + (sim.wdTotal ? 'plus ' + compact(sim.wdTotal) + ' withdrawn' : multiple.toFixed(2) + '× what you put in'), true) +
      kpi('Total put in', tzs(sim.inv), 'lump sum' + (sim.count ? ' + ' + sim.count + ' top-ups' : '') + (sim.spCount ? ' + ' + sim.spCount + ' special' : '')) +
      kpi('Growth', tzs(growth), sim.inv ? pct(growth/sim.inv, 1) + ' on money in' : '') +
      kpi('Units held', f ? fmt(sim.bal/f.nav) : '–', f ? 'at today\'s price' : '');

    /* glance */
    const lump = sim.inv - sim.spTotal - sim.topTotal, scale = Math.max(sim.inv, wealth + charge, 1), w = v => (Math.max(0, v)/scale*100).toFixed(2) + '%';
    const segs = parts => parts.filter(p => p[1] > 0).map(p => `<span style="width:${w(p[1])};background:${p[2]}"></span>`).join('');
    const keys = parts => parts.filter(p => p[1] > 0).map(p => `<span><i class="dot" style="background:${p[2]}"></i>${p[0]} <b>${compact(p[1])}</b></span>`).join('');
    const inParts = [['Lump sum', lump, c.series[2]], ['Top-ups', sim.topTotal, c.series[0]], ['Special', sim.spTotal, c.series[1]]];
    const outParts = [['Still in the fund', net, c.series[0]], ['Paid to the loan', wdLoan, c.series[1]], ['Personal cash', sim.wdTotal - wdLoan, c.neutral], ['Exit charge', charge, c.bad]];
    $('#flow', app).innerHTML = `<div><div class="flow-top"><span>What you put in</span><b>TZS ${fmt(sim.inv)}</b></div><div class="flow-bar">${segs(inParts)}</div><div class="flow-key">${keys(inParts)}</div></div>
      <div><div class="flow-top"><span>What it became</span><b>TZS ${fmt(wealth)}</b></div><div class="flow-bar">${segs(outParts)}</div><div class="flow-key">${keys(outParts)}${growth > 0 ? `<span>of which growth <b>${compact(growth)}</b></span>` : ''}</div></div>`;
    const notes = [];
    if (sim.spCount) notes.push(`<b>Special contributions</b> of ${tzs(sim.spTotal)} add <b>${tzs(withC - without)}</b> by the end, ${tzs(withC - without - sim.spTotal)} of it growth.`);
    if (sim.wdCount) notes.push(`<b>Withdrawals</b>: ${tzs(sim.wdTotal)} taken out${wdLoan ? ` (${tzs(wdLoan)} to the loan, ${tzs(sim.wdTotal - wdLoan)} personal)` : ''}. They lower the end value by <b>${tzs(withC - sim.bal)}</b>, including ${tzs(Math.max(0, withC - sim.bal - sim.wdGross))} of growth they would have earned.` +
      (sim.wdShort ? ' <span class="down">The balance was too small for at least one withdrawal.</span>' : ''));
    $('#sp-note', app).hidden = !notes.length; $('#sp-note', app).innerHTML = notes.join('<br>');

    /* how the money builds */
    const view = st.view, monthly = view !== 'y', earn = view === 'e';
    const src = monthly ? sim.mrows : sim.rows, labels = monthly ? sim.mrows.map(x => when(x.m).replace(/ (\d\d)(\d\d)$/, ' $2')) : sim.rows.map(x => 'Y' + x.year);
    const still = x => Math.min(x.bal, Math.max(0, x.inv - x.wdCum));
    if (earn){
      const M = sim.mrows;
      $('#leg', app).innerHTML = `<span><i style="background:${c.series[0]}"></i>Earned that month</span><span><i class="line" style="background:${c.series[1]}"></i>Balance at month end (right scale)</span>`;
      draw($('#ch', app), {labels, datasets:[bar('Earned', M.map(x => x.earned), c.series[0], {yAxisID:'y', stack:undefined, order:2}), line('Balance', M.map(x => x.bal), c.series[1], {yAxisID:'y1', order:1})], y1:true, displayColors:false,
        tooltip:{title:it => it[0].label + ' · month ' + M[it[0].dataIndex].m, label:ctx => { if (ctx.datasetIndex) return null; const x = M[ctx.dataIndex], fl = x.contrib - x.withdrawn;
          return ['Opening balance  TZS ' + fmt(x.open), '× ' + (x.rate*100).toFixed(3) + '% this month', '= earned  TZS ' + fmt(x.earned)].concat(fl ? [(fl > 0 ? '+ added  TZS ' : '− withdrawn  TZS ') + fmt(Math.abs(fl))] : []).concat(['Closing balance  TZS ' + fmt(x.bal), '(next month starts here)']); }}});
      $('#ch-hint', app).textContent = 'Each month: opening balance × that month\'s rate = what it earns. The earnings join the balance, so the next month starts higher and earns more.';
      const step = x => fmt(x.open) + ' × ' + (x.rate*100).toFixed(3) + '%', tot = M.reduce((a, x) => a + x.earned, 0);
      $('#mstrip', app).innerHTML = stat('Month 1 earns', tzs(M[0].earned), step(M[0])) + (M[1] ? stat('Month 2 earns', tzs(M[1].earned), step(M[1])) : '') + stat('Last month earns', tzs(M.at(-1).earned), step(M.at(-1))) + stat('Total earned', 'TZS ' + compact(tot), 'over ' + M.length + ' months');
      $('#tbl', app).innerHTML = table(['Month', 'Opening balance', '× Rate', '= Earned', 'Added / withdrawn', 'Closing balance'], M.map(x => { const fl = x.contrib - x.withdrawn;
        return `<tr${fl ? ' class="hl"' : ''}><td>${when(x.m)} <span class="mut">M${x.m}</span></td><td>${fmt(x.open)}</td><td>${(x.rate*100).toFixed(3)}%</td><td><b>${fmt(x.earned)}</b></td><td>${fl ? (fl > 0 ? '+' : '−') + fmt(Math.abs(fl)) : '–'}</td><td>${fmt(x.bal)}</td></tr>`; }));
    } else {
      $('#leg', app).innerHTML = `<span><i style="background:${c.series[0]}"></i>Your money still invested</span><span><i style="background:${c.series[1]}"></i>Growth</span>${sim.wdTotal ? `<span><i style="background:${c.neutral}"></i>Withdrawn so far</span>` : ''}`;
      const ds = [bar('Your money still invested', src.map(still), c.series[0]), bar('Growth', src.map(x => Math.max(0, x.bal - still(x))), c.series[1])];
      if (sim.wdTotal) ds.push(bar('Withdrawn so far', src.map(x => x.wdCum), c.neutral));
      draw($('#ch', app), {labels, datasets:ds, stacked:true, tooltip:{label:ctx => ' ' + ctx.dataset.label + ': TZS ' + fmt(ctx.parsed.y)}});
      $('#ch-hint', app).textContent = 'The full bar is the wealth your plan has built by then: what is still in the fund plus cash you have taken out.';
      const m12 = sim.mrows.slice(0, 12);
      $('#mstrip', app).innerHTML = monthly && sim.mrows.length ? stat('Monthly rate, year 1', (sim.mrows[0].rate*100).toFixed(3) + '%') + stat('Earned in month 1', tzs(sim.mrows[0].earned)) + stat('Average a month, year 1', tzs(m12.reduce((a, x) => a + x.earned, 0)/m12.length)) + stat('Earned in the last month', tzs(sim.mrows.at(-1).earned)) : '';
      $('#tbl', app).innerHTML = monthly
        ? table(['Month', 'Return', 'Earned', 'Added', 'Withdrawn', 'Total in', 'Value'], sim.mrows.map(x => `<tr${x.withdrawn ? ' class="hl"' : ''}><td>${when(x.m)}</td><td>${(x.rate*100).toFixed(3)}%</td><td>${fmt(x.earned)}</td><td>${x.contrib ? fmt(x.contrib) : '–'}</td><td>${x.withdrawn ? '−' + fmt(x.withdrawn) : '–'}</td><td>${fmt(x.inv)}</td><td>${fmt(x.bal)}</td></tr>`))
        : table(['Year', 'Return', 'Added', 'of which special', 'Withdrawn', 'Total in', 'Value', 'Growth'], sim.rows.map(x => `<tr${x.special || x.withdrawn ? ' class="hl"' : ''}><td>${x.year}</td><td>${x.year ? pct(x.rate) : '–'}</td><td>${fmt(x.contrib)}</td><td>${x.special ? fmt(x.special) : '–'}</td><td>${x.withdrawn ? '−' + fmt(x.withdrawn) : '–'}</td><td>${fmt(x.inv)}</td><td>${fmt(x.bal)}</td><td>${fmt(x.bal + x.wdCum - x.inv)}</td></tr>`));
    }
    $('#mstrip', app).hidden = !monthly;
    $('#tbl-sum', app).textContent = earn ? 'Monthly earnings table' : monthly ? 'Month-by-month table' : 'Year-by-year table';

    /* loan path */
    $('#loan-card', app).hidden = !loanOn; $('#lmode-f', app).hidden = !loanEv.length;
    if (loanOn) loanPath({P, li, ln, paid, draws, loanEv, sim});

    /* compare plans */
    const fin = s => s.bal*(1 - useLoad) + s.wdTotal, run = o => simulate({...base, specials:sp, withdrawals:sw, wdLoad:useLoad, ...o});
    const scen = [['Your plan', sim]];
    if (sw.length) scen.push(['Without the withdrawals', run({withdrawals:[]})]);
    if (sp.length) scen.push(['Without the special contributions', run({specials:[]})]);
    if (st.add > 0) [[1, 'month'], [3, 'quarter'], [12, 'year']].forEach(([e, t]) => { if (e !== every) scen.push([`Top-up every ${t}`, run({every:e})]); });
    if (st.add > 0) scen.push(['Top-ups 10% higher', run({pmt:st.add*1.1})]);
    scen.push(['Lump sum only', run({pmt:0, specials:[], withdrawals:[]})]);
    const mx = Math.max(...scen.map(([, s]) => fin(s)), 1);
    $('#cmp', app).innerHTML = table(['Plan', 'Put in', 'Withdrawn', 'Total wealth', 'vs your plan'], scen.map(([n, s], k) => { const d = fin(s) - wealth;
      return `<tr${k ? '' : ' class="me"'}><td>${n}<div class="bar-in" style="width:${(fin(s)/mx*100).toFixed(1)}%"></div></td><td>${compact(s.inv)}</td><td>${s.wdTotal ? compact(s.wdTotal) : '–'}</td><td><b>${compact(fin(s))}</b></td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : 'mut'}">${Math.abs(d) < Math.max(1, wealth*5e-4) ? '–' : (d > 0 ? '+' : '−') + compact(Math.abs(d))}</td></tr>`; }));

    /* same plan in other funds */
    const basis = st.basis === 'custom' ? 'y1' : st.basis;
    const alt = funds.filter(g => st.alt === 'all' || g.cat === st.alt).map(g => {
      const rr = rateFor(g, basis), gl = st.exit && g.rep < g.nav ? 1 - g.rep/g.nav : 0, glr = g.id === st.fund ? +st.lr : LONG_RUN[g.cat] ?? 12;
      const gp = ratePath(rr.r, glr, lrn, years, flat), s = simulate({...base, yr:gp, specials:sp, withdrawals:sw, wdLoad:gl});
      return {g, rr, glr, avg:geoAvg(gp), tw:s.bal*(1 - gl) + s.wdTotal};
    }).filter(a => Number.isFinite(a.tw)).sort((a, b2) => b2.tw - a.tw);
    const am = Math.max(...alt.map(a => a.tw), 1);
    $('#alt', app).innerHTML = table(['Fund', 'Rate used', 'Average / yr', 'Total wealth', 'vs your plan'], alt.map(a => { const d = a.tw - wealth;
      return `<tr class="link${a.g.id === st.fund ? ' me' : ''}" data-fund="${a.g.id}"><td><b>${esc(a.g.name)}</b><span class="sub">${esc(a.g.mgr)} · ${CAT[a.g.cat]}</span><div class="bar-in" style="width:${(a.tw/am*100).toFixed(1)}%"></div></td>
        <td>${a.rr.r.toFixed(2)}%${flat ? '' : ' → ' + a.glr + '%'}<span class="sub">${BASIS[a.rr.k] || ''}</span></td><td>${pct(a.avg)}</td><td><b>${compact(a.tw)}</b></td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : 'mut'}">${Math.abs(d) < Math.max(1, wealth*5e-4) ? '–' : (d > 0 ? '+' : '−') + compact(Math.abs(d))}</td></tr>`; }));
  }

  function loanPath({P, li, ln, paid, draws, loanEv, sim}){
    const c = colors(), yearly = st.lview !== 'm';
    const emi = P > 0 ? amort(P, li, ln) : 0;
    let start = P; for (let k = 0; k < paid; k++) start = Math.max(0, start*(1 + li) - emi);
    const base = runLoan(start, li, emi, ln - paid, [], 'keep', draws, ln);
    const withP = loanEv.length ? runLoan(start, li, emi, ln - paid, loanEv.map(e => ({t:e.t, cash:e.cash})), st.lmode, draws, ln) : null;
    const src = withP || base, firstEmi = emi || base.drawLog[0]?.emi || 0;
    $('#loan-sub', app).textContent = `TZS ${fmt(start)} outstanding today at ${st.lrate}% a year · deduction TZS ${fmt(firstEmi)} a month`;
    const totPre = src.mrows.reduce((a, x) => a + x.pre, 0);
    $('#lkpi', app).innerHTML = stat('Cleared', when(src.months), src.months + ' months' + (withP && base.months > src.months ? ' · ' + (base.months - src.months) + ' sooner' : '')) +
      stat('Interest you pay', 'TZS ' + compact(src.interest), withP ? 'saves ' + compact(base.interest - src.interest) + ' vs no pay-ins' : 'over the life of the loan') +
      stat('From your salary', 'TZS ' + compact(src.salary), compact(firstEmi) + ' a month to start') +
      stat('From withdrawals', 'TZS ' + compact(totPre), loanEv.length ? loanEv.length + ' marked Loan payment' : 'none marked Loan payment');
    const n = $('#lnote', app), parts = [];
    if (draws.length){ const last = base.drawLog.at(-1); parts.push(`<b>Top-ups</b>: you borrow ${tzs(draws.reduce((a, d) => a + d.amt, 0))} more; they add <b>${tzs(base.interest - runLoan(start, li, emi, ln - paid, [], 'keep', [], ln).interest)}</b> in interest.` + (last ? ` After the last one the deduction is <b>${tzs(last.emi)}</b> a month for ${last.n} months.` : '')); }
    if (withP) parts.push(`<b>Withdrawals paid in</b>: ${tzs(totPre)} goes to the loan. ${st.lmode === 'keep' ? `Keeping the deduction, it clears in <b>${src.months} months</b> instead of ${base.months}` : `Keeping the end date, the deduction falls to <b>${tzs(withP.emiEnd)}</b>`}, saving <b>${tzs(base.interest - src.interest)}</b> in interest.` +
      (withP.pre.some(p => p.cash - p.used > 0.5) ? ` ${tzs(withP.pre.reduce((a, p) => a + p.cash - p.used, 0))} arrives after the loan is cleared and stays with you.` : ''));
    else parts.push(st.sw.length ? 'None of your withdrawals is set to <b>Loan payment</b>, so they all stay with you. Switch one to see the effect on the loan.' : 'Add a special withdrawal and set it to <b>Loan payment</b> to see how paying into the loan changes the deduction, the end date and the interest.');
    n.hidden = false; n.innerHTML = parts.join('<br>');
    // per top-up note on its row
    st.lb.forEach((r, idx) => { const o = $('#lb-r-' + idx, app); if (!o) return; const d = src.drawLog.find(x => x.idx === idx);
      o.innerHTML = d ? `${when(d.t)}: loan ${compact(d.before)} → <b>${compact(d.after)}</b>, deduction <b>TZS ${fmt(d.emi)}</b> for ${d.n} months.` : r.a > 0 ? '' : 'Enter an amount.'; });

    const LP = loanPeriods(src, yearly), BQ = withP ? loanPeriods(base, yearly) : null, N = Math.max(LP.length, BQ ? BQ.length : 0);
    const per = Array.from({length:N}, (_, j) => LP[j] || {k:yearly ? j + 1 : LP.at(-1).k + j - LP.length + 1, open:0, int:0, pay:0, draw:0, pre:0, close:0, emi:0, m:0, pad:true});
    const endM = x => yearly ? (x.pad ? x.k*12 : Math.min(x.m, x.k*12)) : x.k;
    const bc = j => BQ ? (BQ[j] ? BQ[j].close : 0) : null;
    $('#lleg', app).innerHTML = `<span><i style="background:${c.series[0]}"></i>Principal repaid from salary</span><span><i style="background:${c.interest}"></i>Interest</span>${totPre ? `<span><i style="background:${c.series[1]}"></i>Paid from withdrawals</span>` : ''}<span><i class="line" style="background:${c.ink}"></i>Balance (right scale)</span>${BQ ? `<span style="color:${c.muted}"><i class="dash"></i>Without pay-ins</span>` : ''}`;
    const ds = [bar('Principal repaid', per.map(x => Math.max(0, x.pay - x.int)), c.series[0], {yAxisID:'y', order:3}), bar('Interest', per.map(x => x.int), c.interest, {yAxisID:'y', order:3}),
      bar('From withdrawals', per.map(x => x.pre), c.series[1], {yAxisID:'y', order:3}), line('Balance', per.map(x => x.close), c.ink, {yAxisID:'y1', order:1, pointRadius:per.map(x => x.pre || x.draw ? 3.5 : 0)})];
    if (BQ) ds.push(line('Without pay-ins', per.map((_, j) => bc(j)), c.muted, {yAxisID:'y1', order:2, borderDash:[5, 4]}));
    draw($('#lch', app), {labels:per.map(x => yearly ? 'Y' + x.k : when(x.k).replace(/ (\d\d)(\d\d)$/, ' $2')), datasets:ds, stacked:true, y1:true, displayColors:false,
      tooltip:{title:it => { const x = per[it[0].dataIndex]; return (yearly ? 'Year ' + x.k : 'Month ' + x.k) + ' · ends ' + when(endM(x)); },
        label:ctx => { if (ctx.datasetIndex) return null; const x = per[ctx.dataIndex], j = ctx.dataIndex;
          if (x.pad) return ['Loan already cleared'].concat(BQ ? ['Without pay-ins: TZS ' + fmt(bc(j))] : []);
          return ['Opening balance  TZS ' + fmt(x.open), '+ interest  TZS ' + fmt(x.int), '− salary deductions  TZS ' + fmt(x.pay) + ' (principal ' + fmt(Math.max(0, x.pay - x.int)) + ')']
            .concat(x.pre ? ['− paid from withdrawals  TZS ' + fmt(x.pre)] : []).concat(x.draw ? ['+ top-up borrowed  TZS ' + fmt(x.draw)] : [])
            .concat(['= closing balance  TZS ' + fmt(x.close), x.close > 0.5 ? 'Deduction now TZS ' + fmt(x.emi) + ' a month' : 'Loan cleared']).concat(BQ ? ['Without pay-ins: TZS ' + fmt(bc(j))] : []); }}});
    $('#lhint', app).textContent = `Each bar is one ${yearly ? 'year' : 'month'}: the salary deduction split into loan repaid and interest, plus any withdrawal paid in. The line is the balance left, which the next ${yearly ? 'year' : 'month'} starts from.`;
    $('#ltbl-sum', app).textContent = yearly ? 'Loan path by year' : 'Loan path by month';
    $('#ltbl', app).innerHTML = table([yearly ? 'Year' : 'Month', 'Ends', 'Opening', '+ Interest', '− Salary', '− From withdrawals', '+ Top-up', '= Closing'].concat(BQ ? ['Without pay-ins'] : []),
      per.filter(x => !x.pad).map((x, j) => `<tr${x.pre || x.draw ? ' class="hl"' : ''}><td>${yearly ? x.k : 'M' + x.k}</td><td>${when(endM(x))}</td><td>${fmt(x.open)}</td><td>${fmt(x.int)}</td><td>${fmt(x.pay)}<span class="sub">principal ${compact(Math.max(0, x.pay - x.int))}</span></td><td>${x.pre ? fmt(x.pre) : '–'}</td><td>${x.draw ? fmt(x.draw) : '–'}</td><td><b>${fmt(x.close)}</b></td>${BQ ? `<td>${fmt(bc(j))}</td>` : ''}</tr>`));
    const evs = src.drawLog.map(d => ({t:d.t, k:'Top-up borrowed', a:'+' + fmt(d.amt), b:fmt(d.after), e:fmt(d.emi)}))
      .concat((withP?.pre || []).map(p => ({t:p.t, k:'Withdrawal paid in', a:p.used ? '−' + fmt(p.used) : fmt(p.cash) + ' (loan already cleared)', b:p.used ? fmt(p.after) : '–', e:p.used && p.after > 0.5 ? fmt(p.emi) : p.used ? 'cleared' : '–'}))).sort((a, b2) => a.t - b2.t);
    $('#levents', app).hidden = !evs.length;
    $('#levents', app).innerHTML = table(['When', 'Event', 'Loan change', 'Balance after', 'Deduction after'], evs.map(e => `<tr><td>${when(e.t)}</td><td>${e.k}</td><td>${e.a}</td><td>${e.b}</td><td>${e.e}</td></tr>`));
  }

  app.addEventListener('click', e => { const r = e.target.closest('[data-fund]'); if (r){ st.fund = r.dataset.fund; applyFund(); persist('plan', st); update(); window.scrollTo({top:0, behavior:'smooth'}); } });
  update();
  return {refresh:update};
}
