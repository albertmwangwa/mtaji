import {db, fundsPriced, CAT} from '../data.js';
import {compact, pp, ppHtml, fmt, fmt2, dstr, esc} from '../lib/fmt.js';
import {kpi, table, spark, thin} from '../lib/ui.js';

export default function overview(app){
  const funds = fundsPriced(), tz = funds.filter(f => f.cur === 'TZS' && f.aum && !f.proxy);
  const aum = tz.reduce((a, f) => a + f.aum, 0);
  const y1 = f => Number.isFinite(f.ret?.y1) ? f.ret.y1 : -Infinity;
  const ranked = tz.filter(f => Number.isFinite(f.ret?.y1)).sort((a, b) => y1(b) - y1(a));
  const best = ranked[0], mm = ranked.filter(f => f.cat === 'mm')[0], liquid = db.byId['utt.liquid'];
  const T = db.dse.tickers, ts = Object.entries(T);
  const movers = ts.filter(([, s]) => s.date === db.dse.asof && Number.isFinite(s.chg.d1)).sort((a, b) => b[1].chg.d1 - a[1].chg.d1);
  const bills = db.treasury.bills, top = Object.entries(bills).sort((a, b) => +a[0] - +b[0]);
  const byCat = Object.keys(CAT).map(c => [c, tz.filter(f => f.cat === c).reduce((a, f) => a + f.aum, 0)]);

  const mk = db.dse.market || {}, idx = Object.fromEntries((mk.indices || []).map(i => [i.name, i]));
  const tb = (db.treasury.history?.bills || []).slice().reverse(), fx = db.fx;
  const tick = (k, v, chg, ser, href) => `<a class="tick" href="${href}" style="color:inherit;text-decoration:none"><div class="k"><span>${k}</span>${chg}</div><div class="v">${v}</div>${spark(ser, {w:220, h:34})}</a>`;
  const ix = n => idx[n] ? tick(n === 'DSEI' ? 'All Share Index' : 'Tanzania Share Index', fmt2(idx[n].close, 2), ppHtml(idx[n].pct), thin(idx[n].series.map(p => p[1]), 60), '#/shares') : '';
  const topBond = Object.entries(db.treasury.bonds).filter(([, b]) => !b.stale).sort((a, b) => b[1].y - a[1].y)[0];
  app.innerHTML = `
  <div class="page-head"><div><h1>Tanzania's investment market today</h1>
    <p>Unit trusts, DSE shares and government securities in one place, refreshed from UTT AMIS, NAVView TZ, the DSE and the Bank of Tanzania. Pick anything to plan with it.</p></div></div>
  <div class="strip">
    ${ix('DSEI')}${ix('TSI')}
    ${mk.cap ? tick('DSE market value', 'TZS ' + compact(mk.cap), `<span class="mut">${mk.listed || ''} listed</span>`, idx.DSEI ? thin(idx.DSEI.series.map(p => p[1]), 60) : [], '#/shares') : ''}
    ${fx ? tick('USD / TZS', fmt2(fx.rates.USD.mean, 2), `<span class="mut">${dstr(fx.date)}</span>`, (fx.usd || []).map(p => p[1]), '#/treasury') : ''}
    ${tb.length ? tick('364-day T-bill', fmt2(bills['364'].y, 2) + '%', `<span class="mut">${tb.length} auctions</span>`, tb.map(a => a.y['364']), '#/treasury') : ''}
  </div>
  <div class="grid g4" style="margin-bottom:16px">
    ${kpi('Assets in unit trusts', 'TZS ' + compact(aum), `${tz.length} TZS funds · UTT Liquid ${(liquid.aum/aum*100).toFixed(0)}%`, true)}
    ${kpi('Best 12 months', pp(best.ret.y1), esc(best.name) + ' · ' + esc(best.mgrShort))}
    ${kpi('Top money market fund', pp(mm.ret.y1), esc(mm.name) + ' · UTT Liquid ' + pp(liquid.ret.y1))}
    ${kpi('Highest bond yield', fmt2(topBond[1].y, 2) + '%', topBond[0] + '-year Treasury bond · ' + dstr(topBond[1].date))}
  </div>
  <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);margin-bottom:16px" id="ov-top">
    <div class="card">
      <div class="card-head"><div><h2>Top funds by 12-month return</h2><p>TZS funds with a full year of prices. Bond Fund includes its monthly payouts.</p></div><a class="btn sm" href="#/funds">All funds →</a></div>
      <div class="tbl">${table(['Fund', 'Type', '1M', '3M', '12M', 'Last year', 'Size'], ranked.slice(0, 8).map(f =>
        `<tr class="link" data-go="#/funds/${f.id}"><td><b>${esc(f.name)}</b><span class="sub">${esc(f.mgr)}</span></td><td><span class="chip cat">${CAT[f.cat]}</span></td><td>${ppHtml(f.ret.m1)}</td><td>${ppHtml(f.ret.m3)}</td><td><b>${ppHtml(f.ret.y1)}</b></td><td>${spark(f.spark, {w:80, h:24})}</td><td>${compact(f.aum)}</td></tr>`))}</div>
    </div>
    <div class="card">
      <div class="card-head"><div><h2>Where the money is</h2><p>Unit trust assets by fund type</p></div></div>
      <div class="flow">${byCat.map(([c, v], i) => `<div><div class="flow-top"><span>${CAT[c]}</span><b>TZS ${compact(v)}</b></div>
        <div class="flow-bar"><span style="width:${(v/aum*100).toFixed(1)}%;background:var(--c${i + 1})"></span></div></div>`).join('')}</div>
      <div class="section-t" style="margin:18px 0 10px">Treasury bills</div>
      <div class="stats soft">${top.map(([d, b]) => `<div class="stat"><small>${d} days</small><b>${fmt2(b.y, 2)}%</b></div>`).join('')}</div>
      <p class="hint" style="margin-top:10px"><a href="#/treasury">Bills and bonds calculator →</a></p>
    </div>
  </div>
  <div class="grid g2">
    <div class="card">
      <div class="card-head"><div><h2>DSE on ${dstr(db.dse.asof)}</h2><p>${db.dse.market.up} up · ${db.dse.market.down} down · turnover TZS ${compact(db.dse.market.turnover)}</p></div><a class="btn sm" href="#/shares">All shares →</a></div>
      <div class="tbl">${table(['Share', 'Close', 'Day', '12M', 'Last year'], movers.slice(0, 4).concat(movers.slice(-4)).map(([t, s]) =>
        `<tr class="link" data-go="#/shares/${t}"><td><b>${t}</b><span class="sub">${esc(s.name)}</span></td><td>${fmt(s.close)}</td><td>${ppHtml(s.chg.d1)}</td><td>${ppHtml(s.chg.y1, 1)}</td><td>${spark(thin(s.daily.slice(-250).map(r => r[1]), 50), {w:80, h:24})}</td></tr>`))}</div>
    </div>
    <div class="card">
      <div class="card-head"><div><h2>Start planning</h2><p>Every tool uses the latest prices above.</p></div></div>
      <div class="stack">
        ${[['#/plan', 'Grow money in a unit trust', 'Lump sum, top-ups, withdrawals and a salary loan, month by month.'],
           ['#/portfolio', 'Build a DSE portfolio', 'Mix shares and see what each one adds to the total.'],
           ['#/treasury', 'Buy T-bills or bonds', 'What you pay, the interest after tax, and rolling over.'],
           ['#/goals', 'Reach a savings goal', 'How much to put away each month to hit a target.']].map(([h, t, s]) =>
          `<a class="card fund-card" href="${h}" style="padding:14px 16px;box-shadow:none"><span class="t">${t} →</span><span class="m">${s}</span></a>`).join('')}
      </div>
    </div>
  </div>
  <p class="foot">Sources: UTT AMIS official daily NAVs (uttamis.co.tz), NAVView TZ for the other managers (navviewtz.com), Dar es Salaam Stock Exchange trading history and dividend records (dse.co.tz), Bank of Tanzania auction results and exchange rates (bot.go.tz). Past returns do not promise future returns.</p>`;
  app.addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r) location.hash = r.dataset.go; });
  const q = matchMedia('(max-width:1000px)'); const fit = () => { app.querySelector('#ov-top').style.gridTemplateColumns = q.matches ? 'minmax(0,1fr)' : 'minmax(0,1.6fr) minmax(0,1fr)'; }; fit(); q.addEventListener('change', fit);
}
