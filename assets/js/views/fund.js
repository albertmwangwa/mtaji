import {db, loadHistory, CAT} from '../data.js';
import {compact, ppHtml, pp, fmt, fmt2, dstr, esc, iso, date, parseMoney, money} from '../lib/fmt.js';
import {seg, stat, kpi, $} from '../lib/ui.js';
import {draw, line, colors, alpha} from '../lib/charts.js';
import {calcable} from '../engine/sim.js';

export default function fund(app, id){
  const f = db.byId[id];
  if (!f){ app.innerHTML = '<div class="card"><h2>Fund not found</h2><p><a href="#/funds">Back to all funds</a></p></div>'; return; }
  const cur = f.cur === 'USD' ? 'USD' : 'TZS', R = f.ret || {};
  const load = f.nav && f.rep ? 1 - f.rep/f.nav : 0;
  const win = [['m1', 'Last month'], ['m3', 'Last 3 months'], ['ytd', 'This year'], ['y1', 'Last 12 months'], ['y3', '3 years, a year'], ['y5', '5 years, a year'], ['inc', 'Since launch']]
    .filter(([k]) => Number.isFinite(R[k]));
  app.innerHTML = `
  <div class="crumb"><a href="#/funds">Unit trusts</a> / ${esc(f.mgr)}</div>
  <div class="page-head"><div><h1>${esc(f.name)}</h1><p>${esc(f.desc || '')}</p></div>
    <div style="display:flex;gap:8px">${calcable(f) ? `<a class="btn primary" href="#/plan/${f.id}">Plan with this fund</a>` : ''}${f.link ? `<a class="btn" href="${esc(f.link)}" target="_blank" rel="noopener">Manager site ↗</a>` : ''}</div></div>
  <div class="grid g4" style="margin-bottom:16px">
    ${kpi('Price per unit', cur + ' ' + fmt2(f.nav, 4), (f.src || '') + ' · ' + dstr(f.date), true)}
    ${kpi(f.yld ? 'Published yearly yield' : 'Last 12 months', Number.isFinite(R.y1) ? pp(R.y1) : Number.isFinite(R.inc) ? pp(R.inc) : '–', Number.isFinite(R.y1) ? (f.dpu ? 'including payouts' : 'price change') : 'since launch')}
    ${kpi('Fund size', f.aum ? cur + ' ' + compact(f.aum) : '–', esc(CAT[f.cat]) + (f.risk ? ' · ' + esc(f.risk) + ' risk' : ''))}
    ${kpi('Costs', f.fee != null ? f.fee.toFixed(2) + '% a year' : '–', load > 0 ? (load*100).toFixed(1) + '% exit charge (repurchase ' + fmt2(f.rep, 4) + ')' : 'no exit charge published')}
  </div>
  <div class="grid" style="grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)" id="fd-grid">
    <div class="stack">
      <div class="card">
        <div class="card-head"><div><h2>Price history</h2><p id="fd-src"></p></div><div id="fd-range"></div></div>
        <div class="chart lg"><canvas id="fd-chart"></canvas></div>
      </div>
      ${f.market ? `<div class="note">Listed on the DSE: last traded at <b>TZS ${fmt(f.market.price)}</b> on ${dstr(f.market.date)}, a ${Math.abs(f.market.prem)}% ${f.market.prem < 0 ? 'discount' : 'premium'} to its NAV. Buying on the market, your return depends on that price as well.</div>` : ''}
      <div class="card" id="fd-whatif" hidden>
        <div class="card-head"><div><h2>What if I had invested?</h2><p>Uses the actual published prices: units bought at the sale price on the day, valued at today's price.</p></div></div>
        <div class="two" style="margin-bottom:12px">
          <div class="field"><label for="wi-d">Invested on</label><div class="box"><input type="date" id="wi-d"></div></div>
          <div class="field"><label for="wi-a">Amount</label><div class="box"><span>${cur}</span><input id="wi-a" inputmode="decimal" value="10,000,000"></div></div>
        </div>
        <div class="stats" id="wi-out"></div>
      </div>
    </div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Returns</h2></div>
        <div class="stats">${win.map(([k, t]) => stat(t, ppHtml(R[k]), f.dpu && Number.isFinite(R[k + 'nav']) ? 'price only ' + pp(R[k + 'nav']) : k === 'm3' && Number.isFinite(R.m3a) ? 'about ' + R.m3a.toFixed(1) + '% a year' : k === 'ytd' && Number.isFinite(R.ytda) ? 'about ' + R.ytda.toFixed(1) + '% a year' : k === 'inc' && Number.isFinite(R.inca) ? 'about ' + R.inca.toFixed(1) + '% a year' : '')).join('') || '<p class="hint">No returns published yet.</p>'}</div>
        ${Number.isFinite(R.y1) && R.y1 > 25 && f.cat !== 'eq' ? `<p class="note warn" style="margin-top:12px">The last 12 months (${pp(R.y1)}) are far above what this type of fund earns over longer periods, mostly because DSE share prices rose sharply in 2025–26. Plan with a lower long-run rate as well.</p>` : ''}
      </div>
      <div class="card"><div class="card-head"><h2>Key facts</h2></div>
        <div class="stats soft">
          ${stat('Manager', esc(f.mgr))}${stat('Minimum', f.min != null ? cur + ' ' + compact(f.min) : '–')}
          ${stat('Money back in', f.liq || '–')}${stat('Currency', cur)}
          ${f.sale ? stat('Sale price', fmt2(f.sale, 4)) + stat('Repurchase price', fmt2(f.rep, 4)) : ''}
        </div>
        ${f.proxy ? `<p class="hint" style="margin-top:10px">Uses the ${esc(db.byId[f.proxy]?.name || f.proxy)} yield as a stand-in. Confirm the current rate in the M-Pesa menu.</p>` : ''}
      </div>
    </div>
  </div>`;
  const q = matchMedia('(max-width:1000px)'), fit = () => { $('#fd-grid', app).style.gridTemplateColumns = q.matches ? 'minmax(0,1fr)' : 'minmax(0,1.7fr) minmax(0,1fr)'; }; fit(); q.addEventListener('change', fit);

  let rows = [], range = '1y';
  const chart = () => {
    const c = colors();
    if (rows.length > 1){
      const last = date(rows[rows.length - 1][0]), from = range === 'all' ? null : new Date(last.getFullYear() - {'1y':1, '3y':3, '5y':5}[range], last.getMonth(), last.getDate());
      const pts = rows.filter(r => !from || date(r[0]) >= from);
      draw($('#fd-chart', app), {type:'line', labels:pts.map(r => r[0]), datasets:[line('Price per unit', pts.map(r => r[1]), c.series[0], {fill:'origin', backgroundColor:alpha(c.series[0], .12)})],
        money:false, xTick:function(v){ const l = this.getLabelForValue(v); return l ? dstr(l).replace(/^\d+ /, '') : ''; },
        tooltip:{title:it => dstr(it[0].label), label:ctx => ' ' + cur + ' ' + fmt2(ctx.parsed.y, 4)}});
    } else if (f.spark?.length){
      const n = f.spark.length;
      draw($('#fd-chart', app), {type:'line', labels:f.spark.map((_, i) => i === n - 1 ? 'now' : Math.round((n - 1 - i)) + 'w ago'), datasets:[line('Index (start = 100)', f.spark, c.series[0], {fill:'origin', backgroundColor:alpha(c.series[0], .12)})], money:false,
        tooltip:{label:ctx => ' Index ' + fmt2(ctx.parsed.y, 2)}});
    }
    const y = $('.chart', app); if (y && !rows.length && !f.spark?.length) y.innerHTML = '<p class="hint" style="padding:40px 0;text-align:center">No price history published for this fund yet.</p>';
  };
  loadHistory().then(h => {
    const hh = h[f.id];
    rows = hh?.rows || [];
    if (rows.length > 30){
      $('#fd-src', app).textContent = hh.src + ' · ' + rows.length.toLocaleString() + ' prices since ' + dstr(rows[0][0]);
      $('#fd-range', app).innerHTML = seg('fd-r', [['1y', '1Y'], ['3y', '3Y'], ['5y', '5Y'], ['all', 'All']], {cls:'sm', label:'Range'});
      $('#fd-range', app).querySelector('input[value="1y"]').checked = true;
      $('#fd-range', app).addEventListener('change', e => { range = e.target.value; chart(); });
      whatIf();
    } else {
      rows = [];
      $('#fd-src', app).textContent = f.spark?.length ? 'Weekly index over the last 12 months (NAVView TZ). Daily history builds up as the pipeline runs.' : '';
    }
    chart();
  });
  function whatIf(){
    const box = $('#fd-whatif', app); box.hidden = false;
    const d = $('#wi-d', app), a = $('#wi-a', app);
    d.min = rows[0][0]; d.max = rows[rows.length - 2][0];
    d.value = iso(new Date(date(rows[rows.length - 1][0]).getTime() - 365*864e5));
    const run = () => {
      const amt = parseMoney(a.value), i = rows.findIndex(r => r[0] >= d.value); if (i < 0 || !amt) return;
      const then = rows[i][1], now = rows[rows.length - 1], units = amt/then, val = units*now[1], cash = units*now[2];
      const days = (date(now[0]) - date(rows[i][0]))/864e5, ann = Math.pow(val/amt, 365/days) - 1;
      $('#wi-out', app).innerHTML = stat('Bought on ' + dstr(rows[i][0]), fmt(units) + ' units', 'at ' + fmt2(then, 4)) + stat('Worth today', money(val, cur), dstr(now[0])) +
        stat('Gain', ppHtml((val/amt - 1)*100), Number.isFinite(ann) && days > 60 ? 'about ' + (ann*100).toFixed(1) + '% a year' : '') +
        stat(now[2] < now[1] ? 'Cash if sold today' : 'Profit', money(now[2] < now[1] ? cash : val - amt, cur), now[2] < now[1] ? 'after the exit charge' : '') +
        (f.dpu ? '<p class="hint" style="grid-column:1/-1">Price only; the monthly payouts of about TZS 1.00 a unit come on top.</p>' : '');
    };
    d.addEventListener('input', run); a.addEventListener('input', run); a.addEventListener('change', () => { a.value = fmt(parseMoney(a.value)); }); run();
  }
  return {refresh:chart};
}
