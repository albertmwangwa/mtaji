// Compare funds side by side: growth of the same amount on one chart, and returns, costs and access in a table.
import {db, fundsPriced, loadHistory, CAT} from '../data.js';
import {fmt, fmt2, compact, money as tzs, pp, ppHtml, dstr, esc, date, addDays} from '../lib/fmt.js';
import {$, load, persist, seg, money, bind, table, opt} from '../lib/ui.js';
import {draw, line, colors} from '../lib/charts.js';

export default function compare(app, arg){
  const all = fundsPriced();
  const st = load('compare', {ids:['utt.liquid', 'itrust.iCash', 'orbit.inuka', 'whi.faida'], range:'1y', amt:10e6});
  if (arg) arg.split(',').filter(id => db.byId[id]).forEach(id => { if (!st.ids.includes(id)) st.ids.unshift(id); });
  st.ids = st.ids.filter(id => db.byId[id]?.nav).slice(0, 6);
  app.innerHTML = `
  <div class="page-head"><div><h1>Compare funds</h1><p>Put up to six unit trusts side by side: what the same amount became, and how their returns, costs and access compare.</p></div></div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-head"><div class="picker" id="pk"></div>
      <div class="box" style="width:280px"><select id="add" aria-label="Add a fund"><option value="">+ Add a fund…</option>${[...new Set(all.map(f => f.mgr))].map(m => `<optgroup label="${esc(m)}">${all.filter(f => f.mgr === m).map(f => opt(f.id, f.name)).join('')}</optgroup>`).join('')}</select></div></div>
    <div class="card-head" style="margin-bottom:10px"><div><h2>What ${'<span id="amt-t"></span>'} became</h2><p id="sub"></p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><div class="box" style="width:170px"><span>TZS</span><input name="amt" data-money inputmode="decimal" aria-label="Amount"></div>${seg('range', [['1y', '1 year'], ['3y', '3 years'], ['5y', '5 years']], {cls:'sm', label:'Period'})}</div></div>
    <div class="legend" id="lg"></div>
    <div class="chart lg"><canvas id="ch"></canvas></div>
    <p class="hint" style="margin-top:8px" id="note"></p>
  </div>
  <div class="card"><div class="card-head"><h2>Side by side</h2></div><div class="tbl" id="tb"></div></div>`;
  let hist = {};
  const save = () => { persist('compare', st); history.replaceState(null, '', '#/compare'); };
  $('#add', app).addEventListener('change', e => { const v = e.target.value; e.target.value = ''; if (v && !st.ids.includes(v) && st.ids.length < 6){ st.ids.push(v); save(); update(); } });
  app.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b){ st.ids = st.ids.filter(x => x !== b.dataset.rm); save(); update(); } });
  bind(app, st, () => { save(); update(); });

  /** Series of [date, index] for one fund over the chosen period: daily history where we have it, else the weekly 1-year index. */
  function series(f, years){
    const h = hist[f.id]?.rows;
    if (h && h.length > 60){
      const end = date(h.at(-1)[0]), from = new Date(end.getFullYear() - years, end.getMonth(), end.getDate());
      if (date(h[0][0]) > addDays(from, 10)) return null;
      const pts = h.filter(r => date(r[0]) >= from);
      const dpu = f.dpu || 0, b = pts[0][1];
      return pts.map(r => [r[0], (r[1] + dpu*((date(r[0]) - date(pts[0][0]))/864e5/30.4375))/b]);   // payouts added back for the Bond Fund
    }
    if (years === 1 && f.spark?.length > 4){
      const n = f.spark.length, end = date(f.date);
      return f.spark.map((v, i) => [addDays(end, -7*(n - 1 - i)).toISOString().slice(0, 10), v/f.spark[0]]);
    }
    if (years === 1 && f.yld && Number.isFinite(f.ret?.y1)){   // priced at 1.00: grow at the published yield
      const end = date(f.date), r = f.ret.y1/100;
      return Array.from({length:53}, (_, i) => [addDays(end, -7*(52 - i)).toISOString().slice(0, 10), Math.pow(1 + r, i/52)]);
    }
    return null;
  }
  function update(){
    const c = colors(), years = {'1y':1, '3y':3, '5y':5}[st.range], F = st.ids.map(id => db.byId[id]);
    $('#pk', app).innerHTML = F.map((f, i) => `<span class="pill"><i class="dot" style="background:${c.series[i]}"></i>${esc(f.name)}<button type="button" data-rm="${f.id}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('') || '<span class="mut">Add funds to compare.</span>';
    $('#amt-t', app).textContent = 'TZS ' + compact(st.amt);
    const S = F.map(f => ({f, s:series(f, years)}));
    const shown = S.filter(x => x.s), missing = S.filter(x => !x.s).map(x => x.f.name);
    $('#lg', app).innerHTML = shown.map(x => `<span><i style="background:${c.series[F.indexOf(x.f)]}"></i>${esc(x.f.name)} <b>${compact(st.amt*x.s.at(-1)[1])}</b></span>`).join('');
    $('#sub', app).textContent = `Over the last ${years} year${years > 1 ? 's' : ''}, from the published prices${F.some(f => f.dpu) ? ' (Bond Fund payouts included)' : ''}.`;
    $('#note', app).textContent = missing.length ? `Not enough history for: ${missing.join(', ')}. ${years > 1 ? 'Daily history is published for UTT AMIS funds; for others it builds up as the pipeline runs.' : ''}` : 'Past growth does not promise future growth.';
    draw($('#ch', app), {type:'line', datasets:shown.map(x => line(x.f.name, x.s.map(p => ({x:date(p[0]).getTime(), y:st.amt*p[1]})), c.series[F.indexOf(x.f)], {pointRadius:0})),
      xType:'linear', xTick:v => dstr(new Date(v)).replace(/^\d+ /, ''), interaction:{mode:'nearest', axis:'x', intersect:false},
      tooltip:{title:it => dstr(new Date(it[0].parsed.x)), label:ctx => ' ' + ctx.dataset.label + ': TZS ' + fmt(ctx.parsed.y)}});
    const row = (lbl, fn) => `<tr><td>${lbl}</td>${F.map(fn).map(v => `<td>${v}</td>`).join('')}</tr>`;
    const best = k => Math.max(...F.map(f => f.ret?.[k] ?? -1e9));
    const r = (k, d = 2) => f => Number.isFinite(f.ret?.[k]) ? (f.ret[k] === best(k) && F.length > 1 ? '<b>' + ppHtml(f.ret[k], d) + '</b>' : ppHtml(f.ret[k], d)) : '<span class="mut">–</span>';
    $('#tb', app).innerHTML = F.length ? table(['', ...F.map((f, i) => `<a href="#/funds/${f.id}" style="color:inherit"><i class="dot" style="background:${c.series[i]};margin-right:6px"></i>${esc(f.name)}</a>`)], [
      row('Manager', f => esc(f.mgrShort)), row('Type', f => CAT[f.cat]), row('Risk', f => esc(f.risk || '–')),
      row('Price / unit', f => fmt2(f.nav, 4) + (f.cur === 'USD' ? ' USD' : '')), row('Last month', r('m1')), row('3 months', r('m3')), row('This year', r('ytd')),
      row('12 months', r('y1')), row('3 years, a year', r('y3')), row('5 years, a year', r('y5')),
      row('Fund size', f => f.aum ? compact(f.aum) : '–'), row('Fee a year', f => f.fee != null ? f.fee.toFixed(2) + '%' : '–'),
      row('Exit charge', f => f.rep && f.nav && f.rep < f.nav ? ((1 - f.rep/f.nav)*100).toFixed(1) + '%' : 'none'),
      row('Minimum', f => f.min != null ? compact(f.min) : '–'), row('Money back in', f => f.liq || '–'),
      row('', f => `<a class="btn sm" href="#/plan/${f.id}">Plan with it</a>`)]) : '';
  }
  update();
  loadHistory().then(h => { hist = h; update(); });
  return {refresh:update};
}
