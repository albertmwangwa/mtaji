import {db} from '../data.js';
import {compact, fmt, fmt2, ppHtml, dstr, esc} from '../lib/fmt.js';
import {seg, bind, load, persist, kpi, $} from '../lib/ui.js';
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
  <div class="toolbar">
    ${seg('sec', [['all', 'All'], ['BI', 'Banks & finance'], ['IA', 'Industrial'], ['CS', 'Services']], {label:'Sector'})}
    ${seg('sort', [['turn', 'Most traded'], ['d1', 'Day'], ['y1', '12 months'], ['yld', 'Dividend yield'], ['az', 'A–Z']], {label:'Sort by'})}
  </div>
  <div class="tbl" id="sl"></div>
  <p class="foot">Day, 1W and 1M compare with the close 1, 5 and 21 sessions earlier; 12M with a year ago. Dividend yield = the regular annual dividend from the DSE record divided by today's price, before tax. Shares marked <span class="chip">X</span> are cross-listed Kenyan companies. "Traded" counts sessions with at least one trade in the past year; thinly traded prices can be stale.</p>`;
  const yld = s => { const d = dividendOf(s).dps; return d ? d/s.close*100 : -1; };
  const draw = () => {
    persist('shares', st);
    const rows = all.filter(([, s]) => st.sec === 'all' || s.sec === st.sec).sort((a, b) =>
      st.sort === 'az' ? a[0].localeCompare(b[0]) : st.sort === 'yld' ? yld(b[1]) - yld(a[1]) : st.sort === 'turn' ? b[1].liq.avgTurn - a[1].liq.avgTurn : (b[1].chg[st.sort] ?? -1e9) - (a[1].chg[st.sort] ?? -1e9));
    $('#sl', app).innerHTML = `<table><thead><tr><th>Share</th><th>Sector</th><th>Close</th><th>Day</th><th>1W</th><th>1M</th><th>12M</th><th>Dividend</th><th>Yield</th><th>Traded</th><th></th></tr></thead><tbody>` +
      rows.map(([t, s]) => { const d = dividendOf(s);
        return `<tr class="link" data-go="#/shares/${t}"><td><b>${t}</b>${s.x ? ' <span class="chip">X</span>' : ''}<span class="sub">${esc(s.name)}</span></td><td>${SECTOR[s.sec]}</td><td><b>${fmt(s.close)}</b>${s.date !== db.dse.asof ? `<span class="sub">${dstr(s.date)}</span>` : ''}</td>
          <td>${ppHtml(s.chg.d1)}</td><td>${ppHtml(s.chg.w1)}</td><td>${ppHtml(s.chg.m1)}</td><td>${ppHtml(s.chg.y1, 1)}</td>
          <td>${d.dps ? fmt2(d.dps, 2) + (d.stale ? `<span class="sub">last paid ${d.stale}</span>` : '') : '–'}</td><td>${d.dps ? (d.dps/s.close*100).toFixed(2) + '%' : '–'}</td>
          <td>${s.liq.traded}/${s.liq.sessions}<span class="sub">${s.liq.avgTurn ? compact(s.liq.avgTurn) + '/day' : 'no trades'}</span></td>
          <td><button class="btn sm" data-add="${t}" title="Add to my portfolio">+ Portfolio</button></td></tr>`; }).join('') + '</tbody></table>';
  };
  bind(app, st, draw);
  app.addEventListener('click', e => {
    const a = e.target.closest('[data-add]');
    if (a){ e.stopPropagation(); addHolding(a.dataset.add); a.textContent = 'Added ✓'; a.disabled = true; app.querySelector('.page-head .btn').textContent = `My portfolio (${getHoldings().length})`; return; }
    const r = e.target.closest('[data-go]'); if (r) location.hash = r.dataset.go;
  });
  draw();
}
