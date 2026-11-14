// A DSE portfolio: several shares bought and held together; total result and each share's contribution.
import {db} from '../data.js';
import {compact, fmt, money as tzs, pct, pp, esc, clamp} from '../lib/fmt.js';
import {$, $$, bind, list, load, persist, number, select, check, stat, kpi, table, opt} from '../lib/ui.js';
import {draw, bar, colors} from '../lib/charts.js';
import {SECTOR, FORECAST, histStats, growthPath, dividendOf, holdSim, mixVol} from '../engine/dse.js';
import {getHoldings, saveHoldings} from '../lib/holdings.js';

export default function portfolio(app){
  const T = db.dse.tickers, H = getHoldings().filter(r => T[r.t]);
  const st = load('portfolio-set', {years:5, basis:'ease', dg:5, reinv:false, fees:true});
  const tickers = Object.keys(T).sort();
  app.innerHTML = `
  <div class="page-head"><div><h1>My DSE portfolio</h1><p>Buy and hold several shares together. See what the whole portfolio could be worth, how much each share adds, and how much the mix lowers your risk.</p></div></div>
  <div class="planner">
    <form class="card inputs" onsubmit="return false">
      <div class="field"><div class="lbl-row"><span class="lbl">Holdings</span><small>share · amount · own growth %</small></div>
        <div class="rows" id="hl"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost sm" id="add">+ Add share</button><a class="btn sm" href="#/shares">Browse shares</a></div>
        <p class="hint">Leave the % box empty to use each share's own forecast (shown faintly in the box). Type a rate to override it for that share.</p></div>
      <div class="two">${number('years', 'Hold for', 'years', {min:1, max:30})}${number('dg', 'Dividend growth', '% / yr', {min:-30, max:50, step:0.5})}</div>
      ${select('basis', 'Forecast each share from', Object.entries(FORECAST).filter(([k]) => k !== 'custom'))}
      ${check('reinv', "Reinvest each share's dividends in more of it")}
      ${check('fees', 'Include DSE trading costs')}
    </form>
    <div class="stack">
      <p class="note" id="empty" hidden>Add at least one share with an amount.</p>
      <div class="stack" id="res">
        <div class="grid g4" id="k"></div>
        <div class="card"><div class="card-head"><h2>Diversification</h2></div><div class="stats" id="dv"></div><p class="hint" style="margin-top:12px" id="dvn"></p></div>
        <div class="card"><div class="card-head"><div><h2>How the portfolio builds</h2><p>Each colour is one share's value; grey is dividend cash kept.</p></div></div><div class="legend" id="lg"></div><div class="chart lg"><canvas id="ch"></canvas></div></div>
        <div class="card"><div class="card-head"><div><h2>What each share contributes</h2><p>Total gain = sale proceeds + dividends after 5% tax − money put in, after trading costs.</p></div></div><div class="tbl" id="cmp"></div></div>
        <details class="card"><summary>Year-by-year table</summary><div class="tbl" id="yt"></div></details>
      </div>
    </div>
  </div>`;
  const colOf = i => colors().series[i % 10];
  const L = list($('#hl', app), H, (r, i) => `<div class="hold" data-i="${i}"><i class="dot" style="background:${colOf(i)}"></i>
    <div class="box"><select data-f="t" aria-label="Share">${tickers.map(k => opt(k, k + ' · ' + T[k].name, r.t)).join('')}</select></div>
    <div class="box"><span>TZS</span><input data-f="a" data-money inputmode="decimal" value="${fmt(r.a)}" aria-label="Amount"></div>
    <div class="box"><input type="number" step="0.5" data-f="g" value="${r.g ?? ''}" aria-label="Own growth %, empty uses the forecast"><span>%</span></div>
    <button type="button" class="icon-btn" data-del aria-label="Remove">×</button></div>`, () => { saveHoldings(H); update(); });
  $('#add', app).onclick = () => { const have = H.map(r => r.t); L.add({t:tickers.slice().sort((a, b) => T[b].liq.avgTurn - T[a].liq.avgTurn).find(k => !have.includes(k)) || 'CRDB', a:5e6, g:null}); };
  bind($('form', app), st, () => { persist('portfolio-set', st); update(); });

  function update(){
    const c = colors(), years = clamp(Math.round(st.years) || 1, 1, 30);
    $$('#hl [data-i]', app).forEach(row => { const r = H[+row.dataset.i], el = row.querySelector('[data-f="g"]'); if (r && T[r.t] && el) el.placeholder = growthPath(T[r.t], st.basis, years).g0.toFixed(1); });
    const P = H.map((r, i) => ({r, i})).filter(o => T[o.r.t] && o.r.a > 0).map(({r, i}) => {
      const s = T[r.t], gp = growthPath(s, st.basis, years, r.g);
      return {t:r.t, a:r.a, s, gp, col:colOf(i), sim:holdSim({p0:s.close, amt:r.a, years, path:gp.path, dps0:dividendOf(s).dps, dg:st.dg/100, reinv:st.reinv, fees:st.fees})};
    });
    $('#empty', app).hidden = P.length > 0; $('#res', app).hidden = !P.length;
    if (!P.length) return;
    const inv = P.reduce((a, p) => a + p.a, 0), end = P.reduce((a, p) => a + p.sim.end, 0), gain = end - inv;
    const divTot = P.reduce((a, p) => a + p.sim.divTot, 0), feeTot = P.reduce((a, p) => a + p.sim.feeTot, 0), irr = end > 0 ? Math.pow(end/inv, 1/years) - 1 : NaN;
    $('#k', app).innerHTML = kpi('Portfolio cash after ' + years + ' years', tzs(end), (end/inv).toFixed(2) + '× the ' + compact(inv) + ' put into ' + P.length + ' shares', true) +
      kpi('Total gain', (gain < 0 ? '−' : '') + tzs(Math.abs(gain)), 'after ' + compact(feeTot) + ' trading costs') + kpi('Annual return', pct(irr), 'whole portfolio, price + dividends') +
      kpi('Dividends after tax', tzs(divTot), st.reinv ? 'reinvested' : 'yield ' + (P.reduce((a, p) => a + p.a*dividendOf(p.s).dps/p.s.close, 0)/inv*100).toFixed(2) + '% today');
    const w = P.map(p => p.a/inv), pv = mixVol(P.map(p => p.s), w), avg = P.reduce((a, p, k) => { const h = histStats(p.s); return a + (h ? h.vol*w[k] : 0); }, 0);
    const secs = [...new Set(P.map(p => p.s.sec))], top = P.reduce((a, p) => p.a > a.a ? p : a, P[0]);
    const sale = P.reduce((a, p) => a + p.sim.sale, 0), cash = end - sale, z = 1.2816*(Number.isFinite(pv) ? pv : avg)*Math.sqrt(years);
    $('#dv', app).innerHTML = stat('Spread', P.length + ' shares · ' + secs.length + ' sector' + (secs.length > 1 ? 's' : ''), secs.map(x => SECTOR[x]).join(', ')) +
      stat('Biggest holding', top.t + ' ' + (top.a/inv*100).toFixed(0) + '%', 'of the money put in') +
      stat('Portfolio volatility', Number.isFinite(pv) ? (pv*100).toFixed(0) + '% a year' : '–', 'vs ' + (avg*100).toFixed(0) + '% for the shares alone') +
      stat('Likely range after ' + years + ' yrs', compact(sale*Math.exp(-z) + cash) + ' – ' + compact(sale*Math.exp(z) + cash), '8 in 10 chance · central ' + compact(end));
    const cut = Number.isFinite(pv) && avg > 0 ? (1 - pv/avg)*100 : NaN, thin = P.filter(p => p.s.liq.traded < 60).map(p => p.t);
    $('#dvn', app).innerHTML = (Number.isFinite(cut) ? `Because these shares do not all move together, the mix swings about <b>${cut.toFixed(0)}% less</b> than holding each on its own (5 years of monthly prices). ` : '') +
      (top.a/inv > .5 && P.length > 1 ? `<b>${top.t} is more than half the portfolio</b>, so it drives most of the result. ` : '') +
      (secs.length === 1 && P.length > 1 ? `All holdings are in ${SECTOR[secs[0]]}, so they tend to move together. ` : '') +
      (thin.length ? `<span class="down">${thin.join(', ')} traded on fewer than 60 days last year; selling at the forecast price may not be possible.</span>` : '');
    const labels = Array.from({length:years + 1}, (_, y) => 'Y' + y), cashAt = y => P.reduce((a, p) => a + p.sim.rows[y].cash + p.sim.left, 0);
    $('#lg', app).innerHTML = P.map(p => `<span><i style="background:${p.col}"></i>${p.t}</span>`).join('') + `<span><i style="background:${c.neutral}"></i>Dividend cash</span>`;
    const ds = P.map(p => bar(p.t, p.sim.rows.map(x => x.val), p.col)).concat([bar('Dividend cash', labels.map((_, y) => cashAt(y)), c.neutral)]);
    draw($('#ch', app), {labels, datasets:ds, stacked:true, tooltip:{title:it => 'Year ' + it[0].dataIndex + ' · total TZS ' + fmt(ds.reduce((a, d) => a + d.data[it[0].dataIndex], 0)),
      label:ctx => { const tot = ds.reduce((a, d) => a + d.data[ctx.dataIndex], 0); return ' ' + ctx.dataset.label + ': TZS ' + fmt(ctx.parsed.y) + (tot ? ' (' + (ctx.parsed.y/tot*100).toFixed(0) + '%)' : ''); }}});
    const mx = Math.max(...P.map(p => Math.abs(p.sim.end - p.a)), 1), g = v => `<td class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}</td>`;
    $('#cmp', app).innerHTML = table(['Share', 'Put in', 'Growth used', 'Sold for', 'Dividends', 'Total gain', 'Share of the gain', 'Return / yr'],
      P.slice().sort((a, b) => (b.sim.end - b.a) - (a.sim.end - a.a)).map(p => { const gn = p.sim.end - p.a, last = p.sim.rows[years];
        return `<tr class="link" data-go="#/shares/${p.t}"><td><i class="dot" style="background:${p.col};margin-right:6px"></i><b>${p.t}</b><span class="sub">${esc(p.s.name)}</span></td><td>${compact(p.a)}<span class="sub">${(p.a/inv*100).toFixed(0)}% of portfolio</span></td>
          <td>${p.gp.g0.toFixed(1)}%${p.gp.label === 'trend easing to 10%' ? ' → 10%' : ''}<span class="sub">${p.gp.label}</span></td><td>${compact(p.sim.sale)}<span class="sub">${fmt(last.n)} at ${fmt(last.price)}</span></td>
          <td>${p.sim.divTot ? compact(p.sim.divTot) : '–'}</td>${g(gn)}<td><b>${gain ? (gn/gain*100).toFixed(1) + '%' : '–'}</b><div class="bar-in" style="width:${(Math.abs(gn)/mx*100).toFixed(1)}%;background:${gn < 0 ? c.bad : p.col}"></div></td><td>${pct(p.sim.irr, 1)}</td></tr>`; }),
      `<tr><td>Portfolio</td><td>${compact(inv)}</td><td>–</td><td>${compact(sale)}</td><td>${compact(divTot)}</td>${g(gain)}<td>100%</td><td>${pct(irr, 1)}</td></tr>`);
    $('#yt', app).innerHTML = table(['Year'].concat(P.map(p => p.t), ['Dividend cash', 'Total']), labels.map((_, y) => `<tr${y === years ? ' class="hl"' : ''}><td>${y}</td>${P.map(p => `<td>${fmt(p.sim.rows[y].val)}</td>`).join('')}<td>${fmt(cashAt(y))}</td><td><b>${fmt(P.reduce((a, p) => a + p.sim.rows[y].val, 0) + cashAt(y))}</b></td></tr>`));
  }
  app.addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r) location.hash = r.dataset.go; });
  update();
  return {refresh:update};
}
