// One DSE share: 5-year history with a forecast band, dividends, and a buy-and-hold calculator.
import {db} from '../data.js';
import {compact, fmt, fmt2, money as tzs, pct, pp, ppHtml, dstr, esc, clamp} from '../lib/fmt.js';
import {$, bind, load, persist, money, number, select, seg, check, stat, kpi, table} from '../lib/ui.js';
import {draw, bar, line, colors, alpha} from '../lib/charts.js';
import {SECTOR, FORECAST, histStats, growthPath, priceBand, dividendOf, holdSim, dseFee} from '../engine/dse.js';
import {geoAvg} from '../engine/sim.js';
import {addHolding} from '../lib/holdings.js';

export default function share(app, t){
  const s = db.dse.tickers[t];
  if (!s){ app.innerHTML = '<div class="card"><h2>Share not found</h2><p><a href="#/shares">All shares</a></p></div>'; return; }
  const h = histStats(s), dv = dividendOf(s), y0 = +db.dse.asof.slice(0, 4);
  const st = load('share', {amt:10e6, years:5, basis:'ease', g:8, dps:0, dg:5, reinv:false, fees:true, range:'5'});
  st.dps = dv.dps; if (st.basis !== 'custom') st.g = +(growthPath(s, st.basis, 1).g0).toFixed(1);
  const lowLiq = s.liq.traded < 60;
  app.innerHTML = `
  <div class="crumb"><a href="#/shares">DSE shares</a> / ${SECTOR[s.sec]}</div>
  <div class="page-head"><div><h1>${t} · ${esc(s.name)}</h1><p>${SECTOR[s.sec]}${s.x ? ' · cross-listed Kenyan company' : ' · domestic listing'} · last close ${dstr(s.date)}</p></div>
    <button class="btn" id="add-pf">+ Add to portfolio</button></div>
  <div class="grid g4" style="margin-bottom:16px">
    ${kpi('Last close', 'TZS ' + fmt(s.close), pp(s.chg.d1) + ' on the day', true)}
    ${kpi('12 months', pp(s.chg.y1, 1), 'this year ' + pp(s.chg.ytd, 1))}
    ${kpi('52-week range', fmt(s.lo52) + ' – ' + fmt(s.hi52), 'TZS')}
    ${kpi('Dividend', dv.dps ? 'TZS ' + fmt2(dv.dps, 2) : 'none on record', dv.dps ? 'yield ' + (dv.dps/s.close*100).toFixed(2) + '% before 5% tax' : '')}
  </div>
  ${lowLiq ? `<p class="note warn" style="margin-bottom:16px">${t} traded on only ${s.liq.traded} of ${s.liq.sessions} sessions in the past year, so its price is often stale and selling at the forecast price may not be possible.</p>` : ''}
  <div class="card" style="margin-bottom:16px">
    <div class="card-head"><div><h2>Price history and forecast</h2><p>Month-end closes from the DSE, then the forecast you choose below with its likely range.</p></div>${seg('range', [['5', '5Y'], ['10', '10Y']], {cls:'sm', label:'History'})}</div>
    <div class="stats soft" id="hs" style="margin-bottom:14px"></div>
    <div class="legend" id="fleg"></div>
    <div class="chart lg"><canvas id="fc"></canvas></div>
    <div class="tbl" style="margin-top:14px" id="fct"></div>
    <p class="hint" style="margin-top:10px" id="fnote"></p>
  </div>
  <div class="planner">
    <form class="card inputs" onsubmit="return false">
      <h2>Buy and hold ${t}</h2>
      ${money('amt', 'Amount to invest', {hint:'Trading costs come out of this, so slightly less goes into shares.'})}
      ${number('years', 'Hold for', 'years', {min:1, max:30, slider:[1, 20, 1]})}
      ${select('basis', 'Forecast price growth from', Object.entries(FORECAST))}
      ${number('g', 'Price growth, year 1', '% / yr', {min:-60, max:150, step:0.1, slider:[-30, 80, 0.5], aside:' '})}
      <div class="two">${number('dps', 'Dividend a share', 'TZS', {min:0, max:5000, step:0.01})}${number('dg', 'Dividend growth', '% / yr', {min:-30, max:50, step:0.5})}</div>
      <p class="hint">${dv.note ? esc(dv.note) + ' ' : ''}${dv.years.length ? 'Paid per year: ' + dv.years.map(([y, a]) => y + ' TZS ' + fmt2(a, 2)).join(' · ') + '.' : 'No dividend on the DSE record.'}${dv.stale ? ' Nothing paid in the last 12 months.' : ''}</p>
      ${check('reinv', 'Reinvest dividends in more shares')}
      ${check('fees', 'Include DSE trading costs (about 2.4% each way under TZS 10M)')}
    </form>
    <div class="stack">
      <div class="stats soft" id="strip"></div>
      <div class="grid g4" id="ek"></div>
      <div class="card"><div class="card-head"><h2>How the investment builds</h2></div>
        <div class="legend" id="eleg"></div><div class="chart"><canvas id="ec"></canvas></div></div>
      <details class="card"><summary>Year-by-year table</summary><div class="tbl" id="et"></div></details>
      ${dv.list.length ? `<div class="card"><div class="card-head"><h2>Dividend record</h2></div><div class="tbl">${table(['Per share', 'Announced', 'Books close', 'Paid', ''], dv.list.map(d =>
        `<tr><td><b>TZS ${fmt2(d.dps, 2)}</b>${d.note ? `<span class="sub">${esc(d.note)}</span>` : ''}</td><td>${d.announced ? (d.announced.length > 4 ? dstr(d.announced) : d.announced) : '–'}</td><td>${d.books ? dstr(d.books) : '–'}</td><td>${d.payment ? dstr(d.payment) : '–'}</td><td>${d.doc ? `<a href="${esc(d.doc)}" target="_blank" rel="noopener">Notice ↗</a>` : esc(d.src || '')}</td></tr>`))}</div></div>` : ''}
    </div>
  </div>`;
  $('#add-pf', app).onclick = e => { addHolding(t, st.amt); e.target.textContent = 'Added ✓ · open portfolio'; e.target.onclick = () => { location.hash = '#/portfolio'; }; };

  const b = bind(app, st, k => {
    if (k === 'basis' && st.basis !== 'custom'){ st.g = +(growthPath(s, st.basis, 1).g0).toFixed(1); b.write(); }
    if (k === 'g' && st.basis !== 'custom'){ st.basis = 'custom'; b.write(); }
    persist('share', {...st, dps:undefined}); update();
  });

  function update(){
    const c = colors(), years = clamp(Math.round(st.years) || 1, 1, 30);
    const gp = growthPath(s, st.basis, years, st.basis === 'custom' ? st.g : null), vol = h ? h.vol : 0.25;
    $('#aside-g', app).textContent = st.basis === 'custom' ? 'your rate' : gp.label;
    /* history + forecast */
    const pc = v => Number.isFinite(v) ? ppHtml(v, 1) : '–';
    $('#hs', app).innerHTML = h ? stat('5-year trend', pc(h.trend), 'a year · fit R² ' + h.r2.toFixed(2)) + stat('5 / 3 / 1-year growth', [h.c5, h.c3, h.c1].map(v => Number.isFinite(v) ? pp(v, 0) : '–').join(' / '), 'a year, price only') +
      stat('Volatility', (h.vol*100).toFixed(0) + '% a year', '5-yr range ' + fmt(h.lo) + '–' + fmt(h.hi)) + stat('Traded last year', s.liq.traded + ' of ' + s.liq.sessions + ' days', 'avg TZS ' + compact(s.liq.avgTurn) + ' a day') : stat('History', 'not enough');
    const mc = s.monthly.c, m0 = s.monthly.m0, n = +st.range === 10 ? mc.length : Math.min(61, mc.length), start = mc.length - n;
    const [yy, mm] = m0.split('-').map(Number), mt = i => new Date(yy, mm - 1 + i, 28).getTime();
    const now = new Date(s.date).getTime(), YR = 365.25*864e5, band = priceBand(s.close, gp.path, vol);
    const hist = mc.slice(start).map((v, i) => v ? {x:mt(start + i), y:v} : null).filter(Boolean);
    const F = k => band.map(p => ({x:now + p.y*YR, y:p[k]}));
    $('#fleg', app).innerHTML = `<span><i class="line" style="background:${c.ink}"></i>Month-end close</span><span><i class="line" style="background:${c.series[0]}"></i>Central forecast</span><span><i style="background:${alpha(c.series[0], .25)}"></i>Likely range (8 in 10)</span>`;
    draw($('#fc', app), {type:'line', datasets:[line('Close', hist, c.ink, {borderWidth:1.6, tension:.1}), line('Low (1 in 10)', F('lo'), 'transparent', {fill:false}),
      line('High (1 in 10)', F('hi'), 'transparent', {fill:'-1', backgroundColor:alpha(c.series[0], .18)}), line('Central', F('mid'), c.series[0], {borderDash:[6, 4], pointRadius:2.5})],
      xType:'linear', logY:true, interaction:{mode:'nearest', axis:'x', intersect:false}, xTick:v => new Date(v).getFullYear(),
      tooltip:{title:it => dstr(new Date(it[0].parsed.x)), label:ctx => ' ' + ctx.dataset.label + ': TZS ' + fmt(ctx.parsed.y)}});
    const show = [...new Set([1, 2, 3, 5, 10, years].filter(y => y <= years))].sort((a, b2) => a - b2);
    $('#fct', app).innerHTML = table(['After', 'Low (1 in 10)', 'Central', 'High (1 in 10)', 'vs today'], show.map(y => `<tr><td>${y} yr${y > 1 ? 's' : ''} · ${y0 + y}</td><td>${fmt(band[y].lo)}</td><td><b>${fmt(band[y].mid)}</b></td><td>${fmt(band[y].hi)}</td><td>${ppHtml((band[y].mid/s.close - 1)*100, 0)}</td></tr>`));
    const warn = [];
    if (h && h.trend > 25) warn.push(`The 5-year trend of ${h.trend.toFixed(0)}% a year comes from the 2024–26 DSE re-rating and is very unlikely to continue; "easing to 10%" is the safer basis.`);
    if (h && h.trend < -5) warn.push('The share has fallen over 5 years and the trend carries that decline forward.');
    if (h && h.r2 < 0.4) warn.push(`The trend fits the history poorly (R² ${h.r2.toFixed(2)}), so treat the central line as rough.`);
    $('#fnote', app).innerHTML = 'Method: a straight-line fit to the logarithm of 60 month-end closes gives the trend; the range widens with the share\'s own 5-year volatility (lognormal, 10th–90th percentile). It shows where the price would land if the past pattern repeated, not a promise.' + (warn.length ? ' <b>' + warn.join(' ') + '</b>' : '');

    /* buy and hold */
    const r = holdSim({p0:s.close, amt:st.amt, years, path:gp.path, dps0:+st.dps || 0, dg:st.dg/100, reinv:st.reinv, fees:st.fees});
    $('#strip', app).innerHTML = stat('Shares bought', fmt(r.n0)) + stat('Cost of shares', 'TZS ' + compact(r.buyVal)) + stat('Buying costs', 'TZS ' + fmt(r.buyFee), r.buyVal ? (r.buyFee/r.buyVal*100).toFixed(2) + '%' : '') + stat('Break-even sale price', 'TZS ' + fmt(r.breakEven));
    $('#ek', app).innerHTML = kpi('Cash after ' + years + ' years', tzs(r.end), 'shares sold for ' + compact(r.sale) + ' + dividend cash ' + compact(r.divCash + r.left), true) +
      kpi('Annual return', pct(r.irr), (r.end/st.amt).toFixed(2) + '× · price ' + pct(geoAvg(gp.path), 1) + ' a yr + dividends') +
      kpi('Dividends after tax', tzs(r.divTot), st.dps ? 'yield ' + (st.dps/s.close*100).toFixed(2) + '% today' : 'none entered') +
      kpi('Trading costs', tzs(r.feeTot), st.fees ? 'buy ' + compact(r.buyFee) + ' · sell ' + compact(r.sellFee) : 'excluded');
    $('#eleg', app).innerHTML = `<span><i style="background:${c.series[0]}"></i>Value of your shares</span><span><i style="background:${c.series[1]}"></i>Dividends kept as cash</span>`;
    draw($('#ec', app), {labels:r.rows.map(x => 'Y' + x.y), datasets:[bar('Shares', r.rows.map(x => x.val), c.series[0]), bar('Dividend cash', r.rows.map(x => Math.max(0, x.cash)), c.series[1])], stacked:true});
    $('#et', app).innerHTML = table(['Year', 'Price', 'Shares', 'Dividend / share', 'Dividends after tax', 'Value of shares', 'Dividend cash'], r.rows.map(x => `<tr><td>${x.y}</td><td>${fmt(x.price)}</td><td>${fmt(x.n)}</td><td>${x.y ? fmt2(x.dps, 2) : '–'}</td><td>${x.y ? fmt(x.div) : '–'}</td><td>${fmt(x.val)}</td><td>${fmt(x.cash)}</td></tr>`));
  }
  b.write(); update();
  return {refresh:update};
}
