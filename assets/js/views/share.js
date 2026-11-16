// One DSE share: today's session, price history with the Mtaji model's forecast, value against T-bills,
// dividends, and a buy-and-hold calculator.
import {db} from '../data.js';
import {compact, fmt, fmt2, money as tzs, pct, pp, ppHtml, dstr, esc, clamp} from '../lib/fmt.js';
import {$, bind, load, persist, money, number, select, seg, check, stat, kpi, table, ago} from '../lib/ui.js';
import {draw, bar, line, colors, alpha} from '../lib/charts.js';
import {SECTOR, FORECAST, HORIZON, HORIZON_YEARS, histStats, growthPath, dividendOf, holdSim, beatChance, WHT} from '../engine/dse.js';
import {geoAvg} from '../engine/sim.js';
import {addHolding} from '../lib/holdings.js';

const CAP_RULE = {0.15:'15% (market value under TZS 1T)', 0.05:'5% (TZS 1T+, over 2B shares)', 0.02:'2% (TZS 1T+, under 2B shares)'};

export default function share(app, t){
  const s = db.dse.tickers[t];
  if (!s){ app.innerHTML = '<div class="card"><h2>Share not found</h2><p><a href="#/shares">All shares</a></p></div>'; return; }
  const h = histStats(s), dv = dividendOf(s), M = s.model, MM = db.dse.model || {};
  const st = load('share', {amt:10e6, years:5, basis:'model', g:8, dps:0, dg:5, reinv:false, fees:true, range:'5'});
  if (!st.v2){ st.basis = 'model'; st.v2 = 1; }   // the model replaced the fixed trend as the default
  if (st.basis === 'model' && !M) st.basis = 'ease';
  st.dps = dv.dps; if (st.basis !== 'custom') st.g = +(growthPath(s, st.basis, 1).g0).toFixed(1);
  const lowLiq = s.liq.traded < 60 && !s.ref;
  const tb = db.treasury?.bills?.['364'], rf = tb ? tb.y/100*(1 - (db.treasury.tax?.bill_wht ?? 10)/100) : null;
  const split = (s.splits || []).at(-1);

  app.innerHTML = `
  <div class="crumb"><a href="#/shares">DSE shares</a> / ${SECTOR[s.sec]}</div>
  <div class="page-head"><div><h1>${t} · ${esc(s.name)}</h1><p>${SECTOR[s.sec]}${s.x ? ' · cross-listed Kenyan company' : ' · domestic listing'} · last close ${dstr(s.date)}${s.mcap ? ' · market value TZS ' + compact(s.mcap) : ''}</p></div>
    <button class="btn" id="add-pf">+ Add to portfolio</button></div>
  <div class="grid g4" style="margin-bottom:16px">
    ${s.ref && s.refq ? kpi('DSE reference price', 'TZS ' + fmt(s.refq.last), 'not traded on the DSE · last close on record ' + fmt(s.close), true) : kpi('Last close', 'TZS ' + fmt(s.close), pp(s.chg.d1) + ' on the day', true)}
    ${kpi('12 months', pp(s.chg.y1, 1), 'this year ' + pp(s.chg.ytd, 1))}
    ${kpi('52-week range', fmt(s.lo52) + ' – ' + fmt(s.hi52), 'TZS, closing prices')}
    ${kpi('Dividend', dv.dps ? 'TZS ' + fmt2(dv.dps, 2) : 'none on record', dv.dps ? 'yield ' + (dv.dps/s.close*100).toFixed(2) + '% before 5% tax' : '')}
  </div>
  ${s.ref ? `<p class="note warn" style="margin-bottom:16px">${t} has not traded on the DSE in the past year. Its DSE price is a reference figure (for a cross-listed company it follows the home market), so there is no forecast here and buying or selling it on the DSE may not be possible.</p>` : ''}
  ${lowLiq ? `<p class="note warn" style="margin-bottom:16px">${t} traded on only ${s.liq.traded} of ${s.liq.sessions} sessions in the past year, so its price is often stale and selling at the forecast price may not be possible.</p>` : ''}
  ${s.today ? todayCard() : ''}
  <div class="card" style="margin-bottom:16px">
    <div class="card-head"><div><h2>Price history${M ? ' and forecast' : ''}</h2><p>Month-end closes from the DSE${M ? ', then the Mtaji model\'s central forecast and likely range' : ''}.${split ? ` Earlier prices are divided by ${split[1]} for the ${dstr(split[0])} split.` : ''}</p></div>${seg('range', [['5', '5Y'], ['10', '10Y']], {cls:'sm', label:'History'})}</div>
    <div class="stats soft" id="hs" style="margin-bottom:14px"></div>
    <div class="legend" id="fleg"></div>
    <div class="chart lg"><canvas id="fc"></canvas></div>
    ${split ? `<p class="hint" style="margin-top:8px">◆ ${dstr(split[0])}: 1-for-${split[1]} share split. Each share became ${split[1]}, so the DSE price dropped about ${split[1]}×. Prices before it are divided by ${split[1]} here so the line compares like with like; holders' wealth did not change.</p>` : ''}
    ${M ? `<div class="tbl" style="margin-top:14px" id="fct"></div><p class="hint" style="margin-top:10px" id="fnote"></p>` : ''}
  </div>
  ${M && rf != null ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Is it worth more than a T-bill?</h2><p>Chance that buying ${t} today and holding it (price plus dividends after 5% tax) ends ahead of rolling 364-day T-bills at ${tb.y.toFixed(2)}% (${(rf*100).toFixed(2)}% after tax), on the model's central growth and range. Trading costs not included.</p></div></div><div class="stats" id="val"></div></div>` : ''}
  <div class="planner">
    <form class="card inputs" onsubmit="return false">
      <h2>Buy and hold ${t}</h2>
      ${money('amt', 'Amount to invest', {hint:'Trading costs come out of this, so slightly less goes into shares.'})}
      ${number('years', 'Hold for', 'years', {min:1, max:30, slider:[1, 20, 1]})}
      ${select('basis', 'Forecast price growth from', Object.entries(FORECAST).filter(([k]) => k !== 'model' || M))}
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

  function todayCard(){
    const d = s.today, cap = s.cap || 0.15, avgVol = s.liq.avgTurn && s.close ? s.liq.avgTurn/s.close : null;
    const share = avgVol ? d.vol/avgVol : null;
    return `<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Today on the DSE</h2><p>From the DSE market watch (15 minutes delayed), fetched ${ago(d.at)}. Refresh data for a newer view.</p></div></div>
      <div class="stats">${stat('Traded so far', fmt(d.vol) + ' shares', share ? (share*100).toFixed(0) + '% of an average day' : '')}${stat("Today's range", fmt(d.low) + ' – ' + fmt(d.high), 'previous close ' + fmt(d.prev))}
        ${stat('Price cap today', fmt(d.prev*(1 - cap)) + ' – ' + fmt(d.prev*(1 + cap)), '±' + (CAP_RULE[cap] || (cap*100) + '%'))}${stat('Closing price will be', 'within ' + fmt(d.low) + ' – ' + fmt(d.high), "the day's volume-weighted average")}</div>
      <p class="hint" style="margin-top:12px">The DSE sets the official close as the volume-weighted average price of all the session's trades, provided at least 100 shares trade (Rule 203). It is therefore always inside the day's high–low range. The public feed gives volume, high and low during the session but not the traded prices, so the exact close is known only after 4 pm.</p></div>`;
  }

  $('#add-pf', app).onclick = e => { addHolding(t, st.amt); e.target.textContent = 'Added ✓ · open portfolio'; e.target.onclick = () => { location.hash = '#/portfolio'; }; };
  const b = bind(app, st, k => {
    if (k === 'basis' && st.basis !== 'custom'){ st.g = +(growthPath(s, st.basis, 1).g0).toFixed(1); b.write(); }
    if (k === 'g' && st.basis !== 'custom'){ st.basis = 'custom'; b.write(); }
    persist('share', {...st, dps:undefined}); update();
  });

  function update(){
    const c = colors(), years = clamp(Math.round(st.years) || 1, 1, 30);
    const gp = growthPath(s, st.basis, years, st.basis === 'custom' ? st.g : null);
    $('#aside-g', app).textContent = st.basis === 'custom' ? 'your rate' : gp.label;
    /* history + model forecast */
    const pc = v => Number.isFinite(v) ? ppHtml(v, 1) : '–';
    $('#hs', app).innerHTML = (M ? stat('Model growth', pc(M.g*100), 'a year, price only · ' + (M.own != null ? `own 10-yr ${pp(M.own*100, 0)}, ${Math.round(M.w*100)}% weight` : 'DSE average')) : '') +
      (h ? stat('5 / 3 / 1-year growth', [h.c5, h.c3, h.c1].map(v => Number.isFinite(v) ? pp(v, 0) : '–').join(' / '), 'a year, price only') +
      stat('Volatility', ((M ? M.vol : h.vol)*100).toFixed(0) + '% a year', '5-yr range ' + fmt(h.lo) + '–' + fmt(h.hi)) : stat('History', 'not enough')) +
      stat('Traded last year', s.liq.traded + ' of ' + s.liq.sessions + ' days', 'avg TZS ' + compact(s.liq.avgTurn) + ' a day');
    const mc = s.monthly.c, m0 = s.monthly.m0, n = +st.range === 10 ? mc.length : Math.min(61, mc.length), start = mc.length - n;
    const [yy, mm] = m0.split('-').map(Number), mt = i => new Date(yy, mm - 1 + i, 28).getTime();
    const now = new Date(s.date).getTime(), YR = 365.25*864e5;
    const hist = mc.slice(start).map((v, i) => v ? {x:mt(start + i), y:v} : null).filter(Boolean);
    const pts = M ? [['0', [s.close, s.close, s.close]], ...['1m', '3m', '1y', '2y', '3y', '5y'].filter(k => M.h[k]).map(k => [k, M.h[k]])] : [];
    const F = j => pts.map(([k, v]) => ({x:now + (k === '0' ? 0 : HORIZON_YEARS[k])*YR, y:v[j]}));
    const all = hist.map(p => p.y).concat(pts.flatMap(([, v]) => v)).filter(v => v > 0);
    const ds = [line('Close', hist, c.ink, {borderWidth:1.6, tension:.1})];
    if (M) ds.push(line('Low (1 in 10)', F(0), 'transparent', {fill:false}), line('High (1 in 10)', F(2), 'transparent', {fill:'-1', backgroundColor:alpha(c.series[0], .18)}),
      line('Central', F(1), c.series[0], {borderDash:[6, 4], pointRadius:2.5}));
    if (split && split[0] >= new Date(hist[0]?.x || 0).toISOString().slice(0, 10)){
      const sx = new Date(split[0]).getTime(), near = hist.reduce((a, p) => Math.abs(p.x - sx) < Math.abs(a.x - sx) ? p : a, hist[0]);
      ds.push(line(`1-for-${split[1]} split`, [{x:sx, y:near.y}], c.series[3], {pointRadius:6, pointStyle:'rectRot', showLine:false}));
    }
    $('#fleg', app).innerHTML = `<span><i class="line" style="background:${c.ink}"></i>Month-end close</span>` + (M ? `<span><i class="line" style="background:${c.series[0]}"></i>Central forecast</span><span><i style="background:${alpha(c.series[0], .25)}"></i>Likely range (8 in 10 by design)</span>` : '') + (split ? `<span><i style="background:${c.series[3]}"></i>Split</span>` : '');
    draw($('#fc', app), {type:'line', datasets:ds, xType:'linear', logY:true, yMin:Math.min(...all)*0.85, yMax:Math.max(...all)*1.15, xMin:hist[0]?.x,
      interaction:{mode:'nearest', axis:'x', intersect:false}, xTick:v => new Date(v).getFullYear(),
      tooltip:{title:it => dstr(new Date(it[0].parsed.x)), label:ctx => ' ' + ctx.dataset.label + (ctx.dataset.label.includes('split') ? '' : ': TZS ' + fmt(ctx.parsed.y))}});
    if (M){
      const held = k => M.held?.[k] ?? MM.held?.[k];
      // once today's session has started, its close is bounded by the day's high and low (VWAP, Rule 203)
      const td = s.today && s.today.low > 0 ? [Math.max(s.today.low, s.today.prev*(1 - M.cap)), (s.today.low + s.today.high)/2, Math.min(s.today.high, s.today.prev*(1 + M.cap))] : null;
      $('#fct', app).innerHTML = table(['After', 'Low (1 in 10)', 'Central', 'High (1 in 10)', 'vs last close', 'Held in tests'], HORIZON.filter(([k]) => M.h[k]).map(([k, lbl]) => {
        if (k === '1d' && td) return `<tr><td>Today's close<span class="sub">session in progress</span></td><td>${fmt(td[0])}</td><td><b>${fmt(td[1])}</b></td><td>${fmt(td[2])}</td><td>${ppHtml((td[1]/s.close - 1)*100, 1)}</td><td>always<span class="sub">DSE rule: inside the day's range</span></td></tr>`;
        const [lo, mid, hi] = M.h[k], hd = held(k);
        return `<tr><td>${lbl}</td><td>${fmt(lo)}</td><td><b>${fmt(mid)}</b></td><td>${fmt(hi)}</td><td>${ppHtml((mid/s.close - 1)*100, k.endsWith('y') ? 0 : 1)}</td><td>${hd != null ? `<span class="${hd >= .7 ? '' : 'down'}">${Math.round(hd*100)}%</span>${M.held?.[k] == null ? '<span class="sub">all shares</span>' : ''}` : '<span class="mut">–</span>'}</td></tr>`; }));
      const e = MM.err?.['1y'];
      $('#fnote', app).innerHTML = `<b>How this is made.</b> Rebuilt from the DSE's full price history at every data refresh. Expected growth is ${t}'s own long-run growth pulled towards the DSE average (${pp((MM.prior || 0)*100, 1)} a year), more strongly when its history is short or jumpy, so one strong run is not assumed to repeat. Ranges come from ${t}'s own past moves over the same period and are sized to hold 8 times in 10. The next session's range stays inside the DSE price cap of ±${Math.round(M.cap*100)}%.
        <b>How well it did.</b> Rebuilt from earlier data only and tested from ${MM.test_from?.slice(0, 4) || 2023} onwards, ranges like these held ${Math.round((MM.held?.['1m'] || 0)*100)}% of the time a month ahead and ${Math.round((MM.held?.['1y'] || 0)*100)}% a year ahead, short of 8 in 10 because the 2024–26 re-rating was bigger than anything before it.${e ? ` The central forecast was about as accurate as assuming no change (typical miss a year out ${(e[0]*100).toFixed(0)}% vs ${(e[1]*100).toFixed(0)}%): day-to-day DSE prices are not predictable from past prices, so read the range, not the central line.` : ''}`;
      if ($('#val', app)) $('#val', app).innerHTML = [1, 3, 5].map(y => { const p = beatChance(s, y, rf); return stat(`Over ${y} year${y > 1 ? 's' : ''}`, Number.isFinite(p) ? Math.round(p*100) + '%' : '–', Number.isFinite(p) ? (p >= .6 ? 'more likely than not' : p >= .45 ? 'close to a coin flip' : 'T-bill more likely ahead') : ''); }).join('') +
        stat('Expected yearly return', pct(M.g + (dv.dps || 0)/s.close*(1 - WHT), 1), `${pp(M.g*100, 1)} price + ${((dv.dps || 0)/s.close*(1 - WHT)*100).toFixed(1)}% dividends vs T-bill ${(rf*100).toFixed(1)}%`);
    }

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
