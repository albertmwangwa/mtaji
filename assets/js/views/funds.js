import {db, fundsPriced, managers, CAT} from '../data.js';
import {compact, ppHtml, fmt2, dstr, esc} from '../lib/fmt.js';
import {seg, bind, load, persist, opt, $, spark} from '../lib/ui.js';

export default function funds(app){
  const st = load('funds', {cat:'all', mgr:'all', q:'', sort:'y1'});
  const all = fundsPriced();
  app.innerHTML = `
  <div class="page-head"><div><h1>Unit trusts</h1><p>${all.length} collective investment schemes from ${managers().length} managers. Returns are the change in price over each window; select a fund for its history and to plan with it.</p></div><a class="btn" href="#/compare">Compare funds</a></div>
  <div class="toolbar">
    ${seg('cat', [['all', 'All'], ['mm', 'Money market'], ['fi', 'Fixed income'], ['bal', 'Balanced'], ['eq', 'Equity / ETF']], {label:'Fund type'})}
    <div class="box" style="width:220px"><select name="mgr" aria-label="Manager">${opt('all', 'All managers', st.mgr)}${managers().map(m => opt(m, m, st.mgr)).join('')}</select></div>
    <div class="box" style="width:200px"><span>Sort</span><select name="sort" aria-label="Sort by">${[['y1', '12-month return'], ['m3', '3-month return'], ['ytd', 'This year'], ['aum', 'Fund size'], ['name', 'Name']].map(o => opt(o[0], o[1], st.sort)).join('')}</select></div>
    <div class="box search"><span>⌕</span><input name="q" placeholder="Search funds or managers" autocomplete="off"></div>
  </div>
  <div class="tbl" id="fl"></div>
  <p class="foot">12M for the UTT AMIS Bond Fund includes its monthly payout of about TZS 1.00 a unit; Sanlam funds show the published annual yield. Funds under a year old show "since launch" where known. USD funds are in US dollars.</p>`;
  const draw = () => {
    persist('funds', st);
    const q = st.q.trim().toLowerCase();
    const val = f => st.sort === 'aum' ? (f.aum || 0) : st.sort === 'name' ? 0 : (f.ret?.[st.sort] ?? (st.sort === 'y1' ? f.ret?.inc : null) ?? -1e9);
    const rows = all.filter(f => (st.cat === 'all' || f.cat === st.cat) && (st.mgr === 'all' || f.mgr === st.mgr) && (!q || (f.name + ' ' + f.mgr).toLowerCase().includes(q)))
      .sort((a, b) => st.sort === 'name' ? a.name.localeCompare(b.name) : val(b) - val(a));
    $('#fl', app).innerHTML = `<table><thead><tr><th>Fund</th><th>Type</th><th>Price / unit</th><th>1M</th><th>3M</th><th>YTD</th><th>12M</th><th>Last year</th><th>3Y / yr</th><th>Size</th><th>Fee</th><th>Minimum</th><th>Redeem</th></tr></thead><tbody>` +
      rows.map(f => { const c = f.cur === 'USD' ? 'USD ' : '';
        const y1 = Number.isFinite(f.ret.y1) ? ppHtml(f.ret.y1) : Number.isFinite(f.ret.inc) ? ppHtml(f.ret.inc) + '<span class="sub">since launch</span>' : '<span class="mut">–</span>';
        return `<tr class="link" data-go="#/funds/${f.id}"><td><b>${esc(f.name)}</b> ${f.cur === 'USD' ? '<span class="chip">USD</span>' : ''}${f.yld ? ' <span class="chip">yield</span>' : ''}${f.dpu ? ' <span class="chip ok">incl. payouts</span>' : ''}<span class="sub">${esc(f.mgr)} · ${dstr(f.date)}</span></td>
          <td><span class="chip cat">${CAT[f.cat]}</span></td><td>${fmt2(f.nav, 4)}</td><td>${ppHtml(f.ret.m1)}</td><td>${ppHtml(f.ret.m3)}</td><td>${ppHtml(f.ret.ytd)}</td><td><b>${y1}</b></td><td>${spark(f.spark, {w:84, h:24})}</td><td>${ppHtml(f.ret.y3)}</td>
          <td>${f.aum ? c + compact(f.aum) : '–'}</td><td>${f.fee != null ? f.fee.toFixed(2) + '%' : '–'}</td><td>${f.min != null ? c + compact(f.min) : '–'}</td><td>${f.liq || '–'}</td></tr>`; }).join('') +
      (rows.length ? '' : '<tr><td colspan="13" class="mut">No funds match.</td></tr>') + '</tbody></table>';
  };
  bind(app, st, draw);
  app.addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r) location.hash = r.dataset.go; });
  draw();
}
