import {db, loadLive, liveToday} from '../data.js';
import {compact, fmt, fmt2, pp, ppHtml, dstr, esc, date} from '../lib/fmt.js';
import {seg, bind, load, persist, kpi, $, spark, thin, table} from '../lib/ui.js';
import {draw as plot, line, colors} from '../lib/charts.js';
import {SECTOR, dividendOf} from '../engine/dse.js';
import {addHolding, getHoldings} from '../lib/holdings.js';

export default function shares(app){
  const st = load('shares', {sec:'all', sort:'turn'});
  const T = db.dse.tickers, M = db.dse.market;
  const all = Object.entries(T);
  const big = all.slice().sort((a, b) => b[1].liq.avgTurn - a[1].liq.avgTurn)[0];
  app.innerHTML = `
  <div class="page-head"><div><h1>DSE shares</h1><p>${all.length} listed companies, closing prices for ${dstr(db.dse.asof)}. Select a share for its 5-year history, a price forecast and a buy-and-hold calculator.</p></div><a class="btn primary" href="#/portfolio">My portfolio (${getHoldings().length})</a></div>
  <div class="grid g4" style="margin-bottom:16px">
    ${kpi('Latest session', dstr(db.dse.asof), `${M.up} up · ${M.down} down · ${M.count - M.up - M.down} unchanged`, true)}
    ${kpi('Turnover', 'TZS ' + compact(M.turnover), 'value traded that day')}
    ${kpi('Most traded over a year', big[0], 'TZS ' + compact(big[1].liq.avgTurn) + ' a day on average')}
    ${kpi('Dividend tax', '5%', 'withheld on DSE dividends')}
  </div>
  <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);margin-bottom:16px" id="sh-top">
    <div class="card"><div class="card-head"><div><h2>DSE indices, last 12 months</h2><p>Each index rebased to 100 a year ago.</p></div></div><div class="legend" id="ilg"></div><div class="chart"><canvas id="ich"></canvas></div></div>
    <div class="card"><div class="card-head"><div><h2>Exchange-traded funds</h2><p>DSE price against the fund's own NAV.</p></div></div><div class="tbl" id="etf"></div>
      <p class="hint" style="margin-top:10px">A discount means you buy the fund's holdings for less than they are worth; you can also only sell at the market price. ETF prices are recorded each day by the pipeline.</p></div>
  </div>
  <div class="toolbar">
    ${seg('sec', [['all', 'All'], ['BI', 'Banks & finance'], ['IA', 'Industrial'], ['CS', 'Services']], {label:'Sector'})}
    ${seg('sort', [['turn', 'Most traded'], ['d1', 'Day'], ['y1', '12 months'], ['yld', 'Dividend yield'], ['az', 'A–Z']], {label:'Sort by'})}
  </div>
  <div class="tbl" id="sl"></div>
  <p class="foot">Day, 1W and 1M compare with the close 1, 5 and 21 sessions earlier; 12M with a year ago. Dividend yield = the regular annual dividend from the DSE record divided by today's price, before tax. Shares marked <span class="chip">X</span> are cross-listed Kenyan companies; those that have not traded on the DSE in a year show the DSE reference price. "Model, 1 yr" is the Mtaji model's central change over the next year, with the range it is built to hold 8 times in 10; open a share for how it is made and how well it tested. "Traded" counts sessions with at least one trade in the past year; thinly traded prices can be stale. During trading hours, "today" under the close shows the session's range so far from the DSE market watch (15 minutes delayed), updated every 20 minutes.</p>`;
  const yld = s => { const d = dividendOf(s).dps; return d ? d/s.close*100 : -1; };
  let L = null, timer = null;
  const draw = () => {
    persist('shares', st);
    const rows = all.filter(([, s]) => st.sec === 'all' || s.sec === st.sec).sort((a, b) =>
      st.sort === 'az' ? a[0].localeCompare(b[0]) : st.sort === 'yld' ? yld(b[1]) - yld(a[1]) : st.sort === 'turn' ? b[1].liq.avgTurn - a[1].liq.avgTurn : (b[1].chg[st.sort] ?? -1e9) - (a[1].chg[st.sort] ?? -1e9));
    $('#sl', app).innerHTML = `<table><thead><tr><th>Share</th><th>Sector</th><th>Close</th><th>Day</th><th>1W</th><th>1M</th><th>12M</th><th>Last year</th><th title="Mtaji model: central price change over the next year, and the range it should land in 8 times in 10">Model, 1 yr</th><th>Dividend</th><th>Yield</th><th>Traded</th><th></th></tr></thead><tbody>` +
      rows.map(([t, s]) => { const d = dividendOf(s);
        return `<tr class="link" data-go="#/shares/${t}"><td><b>${t}</b>${s.x ? ' <span class="chip">X</span>' : ''}<span class="sub">${esc(s.name)}</span></td><td>${SECTOR[s.sec]}</td><td><b>${fmt(s.ref && s.refq ? s.refq.last : s.close)}</b>${s.ref ? '<span class="sub">DSE reference</span>' : (lv => lv ? `<span class="sub" title="Today so far (DSE, 15 minutes delayed): ${fmt(lv.vol)} shares traded">${lv.open ? '<i class="live-dot"></i>' : ''}today ${lv.low === lv.high ? fmt(lv.low) : fmt(lv.low) + '–' + fmt(lv.high)}</span>` : s.date !== db.dse.asof ? `<span class="sub">${dstr(s.date)}</span>` : '')(liveToday(t, L))}</td>
          <td>${ppHtml(s.chg.d1)}</td><td>${ppHtml(s.chg.w1)}</td><td>${ppHtml(s.chg.m1)}</td><td>${ppHtml(s.chg.y1, 1)}</td><td>${spark(thin(s.daily.slice(-250).map(r => r[1]), 50), {w:84, h:24})}</td>
          <td>${s.model?.h?.['1y'] ? ppHtml((s.model.h['1y'][1]/s.close - 1)*100, 0) + `<span class="sub">${pp((s.model.h['1y'][0]/s.close - 1)*100, 0)} to ${pp((s.model.h['1y'][2]/s.close - 1)*100, 0)}</span>` : s.ref ? '<span class="mut">reference price</span>' : '–'}</td>
          <td>${d.dps ? fmt2(d.dps, 2) + (d.stale ? `<span class="sub">last paid ${d.stale}</span>` : '') : '–'}</td><td>${d.dps ? (d.dps/s.close*100).toFixed(2) + '%' : '–'}</td>
          <td>${s.liq.traded}/${s.liq.sessions}<span class="sub">${s.liq.avgTurn ? compact(s.liq.avgTurn) + '/day' : 'no trades'}</span></td>
          <td><button class="btn sm" data-add="${t}" title="Add to my portfolio">+ Portfolio</button></td></tr>`; }).join('') + '</tbody></table>';
  };
  const mk = db.dse.market || {}, NAMES = {DSEI:'All Share (DSEI)', TSI:'Tanzania Share (TSI)', BI:'Banks & finance', IA:'Industrial', CS:'Services'};
  function charts(){
    const c = colors(), ix = mk.indices || [];
    $('#ilg', app).innerHTML = ix.map((i, k) => `<span><i style="background:${c.series[k]}"></i>${NAMES[i.name] || i.name} <b>${fmt2(i.close, 0)}</b> ${ppHtml((i.series.at(-1)[1]/i.series[0][1] - 1)*100, 0)}</span>`).join('');
    plot($('#ich', app), {type:'line', datasets:ix.map((i, k) => line(NAMES[i.name] || i.name, i.series.map(p => ({x:date(p[0]).getTime(), y:p[1]/i.series[0][1]*100})), c.series[k], {borderWidth:i.name.length > 2 ? 2.2 : 1.5})),
      xType:'linear', money:false, xTick:v => dstr(new Date(v)).replace(/^\d+ /, ''), interaction:{mode:'nearest', axis:'x', intersect:false},
      tooltip:{title:it => dstr(new Date(it[0].parsed.x)), label:ctx => ' ' + ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1)}});
    const E = Object.entries(mk.etfs || {});
    $('#etf', app).innerHTML = E.length ? table(['ETF', 'Price', 'NAV', 'vs NAV'], E.map(([t, e]) =>
      `<tr${e.fund ? ` class="link" data-go="#/funds/${e.fund}"` : ''}><td><b>${esc(t)}</b><span class="sub">${esc(e.name)}</span></td><td>${fmt(e.price)}</td><td>${e.nav ? fmt2(e.nav, 2) : '–'}</td><td>${Number.isFinite(e.prem) ? `<span class="${e.prem < 0 ? 'up' : 'down'}">${e.prem > 0 ? '+' : ''}${e.prem}%</span><span class="sub">${e.prem < 0 ? 'discount' : 'premium'}</span>` : '–'}</td></tr>`)) : '<p class="hint">No ETF prices yet.</p>';
  }
  const q = matchMedia('(max-width:1000px)'), fit = () => { $('#sh-top', app).style.gridTemplateColumns = q.matches ? 'minmax(0,1fr)' : 'minmax(0,1.6fr) minmax(0,1fr)'; }; fit(); q.addEventListener('change', fit);
  charts();
  bind(app, st, draw);
  app.addEventListener('click', e => {
    const a = e.target.closest('[data-add]');
    if (a){ e.stopPropagation(); addHolding(a.dataset.add); a.textContent = 'Added ✓'; a.disabled = true; app.querySelector('.page-head .btn').textContent = `My portfolio (${getHoldings().length})`; return; }
    const r = e.target.closest('[data-go]'); if (r) location.hash = r.dataset.go;
  });
  draw();
  const poll = async () => { if (document.hidden) return; const n = await loadLive(); if (n && n.at !== L?.at){ L = n; draw(); } if (!n?.open && timer){ clearInterval(timer); timer = null; } };
  poll().then(() => { if (L?.open) timer = setInterval(poll, 90e3); });
  return {refresh:charts, destroy:() => { if (timer) clearInterval(timer); }};
}
