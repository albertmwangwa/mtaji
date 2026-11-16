// Government securities: bill and bond calculators (latest BoT auction rates), auction history and yield curve,
// and the bonds listed on the DSE (government and corporate).
import {db, loadBonds} from '../data.js';
import {fmt, fmt2, compact, money as tzs, pct, dstr, iso, addDays, addMonths, clamp, esc, date} from '../lib/fmt.js';
import {$, bind, load, persist, money, number, seg, select, stat, kpi, table} from '../lib/ui.js';
import {draw, bar, line, colors} from '../lib/charts.js';
import {bill, bondPrice, irr} from '../engine/treasury.js';

const TEN = ['35', '91', '182', '364'];

export default function treasury(app){
  const TB = db.treasury, tax = TB.tax || {}, H = TB.history || {bills:[], bonds:[]};
  const st = load('treasury', {kind:'bills', mode:'cash', amt:10e6, ten:'364', yld:TB.bills['364'].y, wht:tax.bill_wht ?? 10, roll:0, date:iso(new Date()),
    bten:'10', face:10e6, cpn:TB.bonds['10'].c, ytm:TB.bonds['10'].y, bwht:0, use:'cash', rr:10, asof:TB.asof, lb:'gov', q:''});
  if (st.asof !== TB.asof){ st.yld = TB.bills[st.ten].y; st.cpn = TB.bonds[st.bten].c; st.ytm = TB.bonds[st.bten].y; st.asof = TB.asof; }
  const lastBill = H.bills[0];
  app.innerHTML = `
  <div class="page-head"><div><h1>Bills & bonds</h1><p>Bank of Tanzania Treasury bills and bonds, with rates from the latest auctions (most recent ${dstr(TB.asof)}), the auction record, and every bond listed on the DSE.</p></div></div>
  <div style="margin-bottom:16px">${seg('kind', [['bills', 'Treasury bills'], ['bonds', 'Treasury bonds'], ['auctions', 'Auctions & yields'], ['listed', 'Listed bonds']], {label:'Section'})}</div>

  <div class="planner" id="s-bills">
    <form class="card inputs" onsubmit="return false">
      <div class="field"><span class="lbl">I want to enter</span>${seg('mode', [['cash', 'Cash to invest'], ['face', 'Face value']], {label:'Amount type'})}</div>
      ${money('amt', 'Amount')}
      <div class="field"><span class="lbl">Tenor</span>${seg('ten', TEN.map(d => [d, d + 'd']), {label:'Tenor'})}</div>
      ${number('yld', 'Auction yield', '% / yr', {min:0, max:30, step:0.0001, slider:[0, 20, 0.01], aside:' '})}
      <div class="two">${number('wht', 'Withholding tax', '%', {min:0, max:30, step:0.5})}${number('roll', 'Roll over', 'times', {min:0, max:20})}</div>
      <div class="field"><label for="b-date">Settlement date</label><div class="box"><input type="date" id="b-date" name="date"></div></div>
    </form>
    <div class="stack"><div class="grid g4" id="bk"></div>
      <div class="card" id="roll-c"><div class="card-head"><h2>Rolling over</h2></div><div class="tbl" id="rt"></div></div>
      <div class="card"><div class="card-head"><div><h2>Compare tenors for this amount</h2><p>Auction no. ${lastBill?.no || '–'}, ${lastBill ? dstr(lastBill.date) : ''}</p></div></div><div class="tbl" id="bt"></div></div></div>
  </div>

  <div class="planner" id="s-bonds">
    <form class="card inputs" onsubmit="return false">
      ${select('bten', 'Tenor', Object.keys(TB.bonds).map(k => [k, k + ' years' + (TB.bonds[k].stale ? ' (estimate)' : '')]))}
      ${money('face', 'Face value')}
      <div class="two">${number('cpn', 'Coupon', '% / yr', {min:0, max:30, step:0.01})}${number('ytm', 'Auction yield', '% / yr', {min:0, max:30, step:0.0001})}</div>
      <p class="hint" id="bsrc"></p>
      ${number('bwht', 'Withholding tax on coupons', '%', {min:0, max:30, step:0.5, hint:'Bonds of 3 years or more are tax-free; under 3 years, 10%.'})}
      <div class="field"><span class="lbl">Coupons</span>${seg('use', [['cash', 'Take as cash'], ['reinvest', 'Reinvest']], {label:'Coupons'})}</div>
      <div id="rr-f">${number('rr', 'Reinvest at', '% / yr', {min:0, max:30, step:0.5})}</div>
    </form>
    <div class="stack"><div class="grid g4" id="tk"></div>
      <div class="card"><div class="card-head"><h2>Income by year</h2></div><div class="legend" id="tl"></div><div class="chart"><canvas id="tc"></canvas></div></div>
      <details class="card"><summary>Coupon schedule</summary><div class="tbl scroll" id="tt"></div></details></div>
  </div>

  <div class="stack" id="s-auctions">
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)" id="au-top">
      <div class="card"><div class="card-head"><div><h2>Yield curve</h2><p>Latest auction yield for each tenor.</p></div></div><div class="chart"><canvas id="yc"></canvas></div></div>
      <div class="card"><div class="card-head"><div><h2>T-bill yields over the last year</h2><p>Weighted average yield at each auction.</p></div></div><div class="legend" id="byl"></div><div class="chart"><canvas id="by"></canvas></div></div>
    </div>
    <div class="card"><div class="card-head"><div><h2>Treasury bill auctions</h2><p>"Cover" is the amount bid divided by the amount offered: above 1 the auction was oversubscribed.</p></div></div><div class="tbl scroll" id="bat"></div></div>
    <div class="card"><div class="card-head"><div><h2>Treasury bond auctions</h2><p>Yield to maturity and price of the successful bids. Bonds are often re-opened, so the coupon can differ from today's rates.</p></div></div><div class="tbl scroll" id="tat"></div></div>
  </div>

  <div class="stack" id="s-listed">
    <div class="toolbar">${seg('lb', [['gov', 'Government bonds'], ['corp', 'Corporate bonds']], {label:'Bond type'})}
      <div class="box search"><span>⌕</span><input name="q" placeholder="Search name, issuer or ISIN" autocomplete="off"></div></div>
    <div class="grid g4" id="lk"></div>
    <div class="tbl scroll" id="lt" style="max-height:640px"><p class="loading">Loading listed bonds…</p></div>
    <p class="foot">From the DSE's bond listings. Listed bonds trade on the DSE secondary market through any licensed broker; the price you pay depends on the market, so your yield will differ from the coupon.</p>
  </div>`;
  const q = matchMedia('(max-width:1000px)'), fit = () => { $('#au-top', app).style.gridTemplateColumns = q.matches ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1.3fr)'; }; fit(); q.addEventListener('change', fit);
  let bonds = null;
  const b = bind(app, st, k => {
    if (k === 'ten') st.yld = TB.bills[st.ten].y;
    if (k === 'bten'){ st.cpn = TB.bonds[st.bten].c; st.ytm = TB.bonds[st.bten].y; st.bwht = +st.bten < 3 ? (tax.bond_wht_under3y ?? 10) : (tax.bond_wht_3y_plus ?? 0); }
    if (k === 'ten' || k === 'bten') b.write();
    persist('treasury', st); update();
  });

  function update(){
    ['bills', 'bonds', 'auctions', 'listed'].forEach(s => { $('#s-' + s, app).hidden = st.kind !== s; });
    if (st.kind === 'bills') billsView();
    else if (st.kind === 'bonds') bondsView();
    else if (st.kind === 'auctions') auctionsView();
    else listedView();
  }
  function billsView(){
    const d = +st.ten, src = TB.bills[st.ten], sd = st.date || iso(new Date()), w = st.wht/100;
    $('#aside-yld', app).innerHTML = Math.abs(st.yld - src.y) < 1e-9 ? `<span class="chip ok">BoT ${dstr(src.date)}</span>` : '<span class="chip est">your rate</span>';
    const x = bill(st.amt, st.mode, st.yld/100, d, w);
    $('#bk', app).innerHTML = kpi('You pay', tzs(x.cost), 'price ' + fmt2(x.p, 4) + ' per 100', true) + kpi('Interest after tax', tzs(x.netInt), compact(x.tax) + ' tax on ' + compact(x.disc) + ' discount') +
      kpi('You receive', tzs(x.rec), 'on ' + dstr(addDays(sd, d))) + kpi('Net yield', pct(x.ny), 'a year, after tax');
    const rolls = clamp(Math.round(st.roll) || 0, 0, 20); $('#roll-c', app).hidden = !rolls;
    if (rolls){ let cash = x.cost, dt = sd; const rows = [];
      for (let i = 0; i <= rolls; i++){ const y = bill(cash, 'cash', st.yld/100, d, w), e = addDays(dt, d); rows.push(`<tr${i === rolls ? ' class="hl"' : ''}><td>${i + 1}</td><td>${dstr(dt)}</td><td>${fmt(y.cost)}</td><td>${fmt(y.netInt)}</td><td>${fmt(y.rec)}</td><td>${dstr(e)}</td></tr>`); cash = y.rec; dt = e; }
      const days = d*(rolls + 1);
      $('#rt', app).innerHTML = table(['Cycle', 'Start', 'Invested', 'Net interest', 'Proceeds', 'Matures'], rows, `<tr><td colspan="4">Net gain after ${days} days: TZS ${fmt(cash - x.cost)}</td><td colspan="2">${pct(Math.pow(cash/x.cost, 365/days) - 1)} a year compounded</td></tr>`); }
    $('#bt', app).innerHTML = table(['Tenor', 'Yield', 'Cover', 'You pay', 'Net interest', 'Net / yr'], TEN.map(k => { const yy = k === st.ten ? st.yld : TB.bills[k].y, y = bill(st.amt, st.mode, yy/100, +k, w);
      return `<tr${k === st.ten ? ' class="me"' : ''}><td>${k} days</td><td>${fmt2(yy, 4)}%</td><td>${lastBill?.cover?.[k] != null ? lastBill.cover[k].toFixed(2) + '×' : '–'}</td><td>${fmt(y.cost)}</td><td>${fmt(y.netInt)}</td><td>${pct(y.ny)}</td></tr>`; }));
  }
  function bondsView(){
    const c = colors(), n = +st.bten, bs = TB.bonds[st.bten], cp = st.cpn/100, y = st.ytm/100, bw = st.bwht/100, rr = st.rr/100, sd = st.date || iso(new Date());
    $('#rr-f', app).hidden = st.use !== 'reinvest';
    $('#bsrc', app).innerHTML = bs.src && !bs.stale ? `<span class="chip ok">BoT</span> ${esc(bs.src)}${bs.isin ? ' · ISIN ' + bs.isin : ''}${bs.redemption ? ' · matures ' + dstr(bs.redemption) : ''}` : '<span class="chip est">estimate</span> No recent auction for this tenor; enter the coupon and yield from the latest notice.';
    const p = bondPrice(cp*100, y, n), cost = st.face*p/100, gross = st.face*cp/2, net = gross*(1 - bw), N = n*2;
    let pot = 0; const yearly = [], potY = [], rows = [];
    for (let k = 1; k <= N; k++){ pot = pot*(1 + rr/2) + net; const yi = Math.ceil(k/2) - 1; yearly[yi] = (yearly[yi] || 0) + net; if (k % 2 === 0) potY.push(pot);
      rows.push(`<tr${k === N ? ' class="hl"' : ''}><td>${k}</td><td>${dstr(addMonths(sd, 6*k))}</td><td>${fmt(gross)}</td><td>${fmt(gross - net)}</td><td>${fmt(net + (k === N ? st.face : 0))}</td></tr>`); }
    let annual, endV;
    if (st.use === 'reinvest'){ endV = pot + st.face; annual = Math.pow(endV/cost, 1/n) - 1; }
    else { const flows = [-cost]; for (let k = 1; k <= N; k++) flows.push(net + (k === N ? st.face : 0)); annual = Math.pow(1 + irr(flows), 2) - 1; endV = net*N + st.face; }
    $('#tk', app).innerHTML = kpi('You pay', tzs(cost), 'price ' + fmt2(p, 4) + ' · ' + (p >= 100 ? 'premium ' : 'discount ') + compact(Math.abs(st.face - cost)), true) +
      kpi('Each coupon', tzs(net), 'every 6 months · about ' + compact(net/6) + ' a month') +
      kpi(st.use === 'reinvest' ? 'Value at maturity' : 'Total coupons', tzs(st.use === 'reinvest' ? endV : net*N), st.use === 'reinvest' ? 'coupons grow to ' + compact(pot) + ' + face' : 'over ' + n + ' years · gain ' + compact(endV - cost)) +
      kpi('Return a year', pct(annual), st.use === 'reinvest' ? 'coupons reinvested at ' + st.rr + '%' : 'yield after tax');
    const labels = Array.from({length:n}, (_, i) => 'Y' + (i + 1));
    $('#tl', app).innerHTML = `<span><i style="background:${c.series[0]}"></i>Coupons after tax</span><span><i style="background:${c.series[2]}"></i>Face value repaid</span>${st.use === 'reinvest' ? `<span><i style="background:${c.series[1]}"></i>Reinvested pot</span>` : ''}`;
    const ds = [bar('Coupons after tax', yearly, c.series[0]), bar('Face value repaid', labels.map((_, i) => i === n - 1 ? st.face : 0), c.series[2])];
    if (st.use === 'reinvest') ds.push(bar('Reinvested pot', potY, c.series[1], {stack:'p'}));
    draw($('#tc', app), {labels, datasets:ds, stacked:true});
    $('#tt', app).innerHTML = table(['#', 'Date (est.)', 'Gross coupon', 'Tax', 'You receive'], rows);
  }
  function auctionsView(){
    const c = colors();
    const curve = TEN.map(k => ({x:+k/365, y:TB.bills[k].y, l:k + ' days'})).concat(Object.entries(TB.bonds).filter(([, v]) => !v.stale).map(([k, v]) => ({x:+k, y:v.y, l:k + ' years'})));
    draw($('#yc', app), {type:'line', datasets:[line('Yield', curve, c.series[0], {pointRadius:4, tension:.3})], xType:'logarithmic', money:false,
      xTick:v => [0.1, 0.25, 0.5, 1, 2, 5, 10, 20].includes(+v.toFixed(2)) ? (v < 1 ? Math.round(v*12) + 'm' : v + 'y') : '',
      tooltip:{title:it => curve[it[0].dataIndex].l, label:ctx => ' ' + ctx.parsed.y.toFixed(2) + '%'}});
    const A = H.bills.slice().reverse();
    $('#byl', app).innerHTML = TEN.map((k, i) => `<span><i style="background:${c.series[i]}"></i>${k} days <b>${fmt2(TB.bills[k].y, 2)}%</b></span>`).join('');
    draw($('#by', app), {type:'line', labels:A.map(a => dstr(a.date).replace(/ \d{4}$/, '')), datasets:TEN.map((k, i) => line(k + ' days', A.map(a => a.y[k] ?? null), c.series[i], {pointRadius:2, spanGaps:true})), money:false,
      tooltip:{title:it => 'Auction ' + A[it[0].dataIndex].no + ' · ' + dstr(A[it[0].dataIndex].date), label:ctx => ' ' + ctx.dataset.label + ': ' + fmt2(ctx.parsed.y, 4) + '%'}});
    const cov = v => v == null ? '–' : `<span class="${v >= 1 ? 'up' : 'down'}">${v.toFixed(2)}×</span>`;
    $('#bat', app).innerHTML = table(['Auction', 'Date', ...TEN.map(k => k + 'd yield'), 'Offered', 'Bid', 'Cover', 'Accepted'], H.bills.map(a => { const cv = a.offered ? a.tendered/a.offered : null;
      return `<tr><td>${a.no}</td><td>${dstr(a.date)}</td>${TEN.map(k => `<td>${a.y[k] != null ? fmt2(a.y[k], 2) + '%' : '–'}<span class="sub">${a.cover?.[k] != null ? a.cover[k].toFixed(2) + '×' : ''}</span></td>`).join('')}<td>${compact(a.offered*1e6)}</td><td>${compact(a.tendered*1e6)}</td><td>${cov(cv)}</td><td>${compact(a.accepted*1e6)}</td></tr>`; }));
    $('#tat', app).innerHTML = table(['Auction', 'Date', 'Bond', 'Coupon', 'Yield', 'Price', 'Offered', 'Bid', 'Cover', 'Bids', 'Matures'], H.bonds.map(a => { const cv = a.offered ? a.tendered/a.offered : null;
      return `<tr><td>${a.no}<span class="sub">issue ${a.issue}</span></td><td>${dstr(a.date)}</td><td>${a.tenor}-year<span class="sub">${a.isin || ''}</span></td><td>${fmt2(a.c, 2)}%</td><td><b>${fmt2(a.ytm, 2)}%</b></td><td>${fmt2(a.price, 2)}</td><td>${compact(a.offered*1e6)}</td><td>${compact(a.tendered*1e6)}</td><td>${cov(cv)}</td><td>${fmt(a.bids)}</td><td>${a.redemption ? dstr(a.redemption) : '–'}</td></tr>`; }));
  }
  function listedView(){
    if (!bonds){ loadBonds().then(x => { bonds = x; listedView(); }).catch(e => { $('#lt', app).innerHTML = `<p class="hint">Could not load the bond list: ${esc(e.message)}</p>`; }); return; }
    const q = st.q.trim().toLowerCase(), today = new Date();
    const yrs = m => m ? Math.max(0, (date(m) - today)/864e5/365.25) : null;
    const G = bonds.government, C = bonds.corporate;
    $('#lk', app).innerHTML = kpi('Government bonds listed', fmt(G.length), 'TZS ' + compact(bonds.summary.gov_amount) + ' issued', true) +
      kpi('Corporate bonds listed', fmt(C.length), C.filter(x => x.green).length + ' green or sukuk') +
      kpi('Highest corporate coupon', fmt2(Math.max(...C.map(x => x.c || 0)), 2) + '%', esc((C.slice().sort((a, b2) => (b2.c || 0) - (a.c || 0))[0] || {}).issuer || '')) +
      kpi('Longest government bond', G.length ? dstr(G.at(-1).maturity) : '–', G.length ? fmt2(G.at(-1).c, 2) + '% coupon' : '');
    if (st.lb === 'gov'){
      const rows = G.filter(x => !q || (x.name + ' ' + x.isin + ' ' + x.code).toLowerCase().includes(q));
      $('#lt', app).innerHTML = table(['Bond', 'ISIN', 'Coupon', 'Issued', 'Matures', 'Years left', 'Amount issued'], rows.map(x =>
        `<tr><td><b>${esc(x.name)}</b>${x.special ? ' <span class="chip">special</span>' : ''}<span class="sub">${esc(x.code)}</span></td><td>${esc(x.isin)}</td><td>${fmt2(x.c, 2)}%</td><td>${esc(x.issue)}</td><td>${dstr(x.maturity)}</td><td>${fmt2(yrs(x.maturity), 1)}</td><td>${compact(x.amount)}</td></tr>`));
    } else {
      const rows = C.filter(x => !q || (x.name + ' ' + x.issuer + ' ' + x.code).toLowerCase().includes(q));
      $('#lt', app).innerHTML = table(['Bond', 'Issuer', 'Coupon', 'Term', 'Matures', 'Years left'], rows.map(x =>
        `<tr><td><b>${esc(x.name)}</b>${x.green ? ' <span class="chip ok">green / sukuk</span>' : ''}<span class="sub">${esc(x.code)} · ${esc(x.cur)}</span></td><td style="white-space:normal">${esc(x.issuer)}</td><td>${x.c != null ? fmt2(x.c, 2) + '%' : '–'}</td><td>${esc(x.term || '–')}</td><td>${x.maturity ? dstr(x.maturity) : '–'}</td><td>${x.maturity ? fmt2(yrs(x.maturity), 1) : '–'}</td></tr>`));
    }
  }
  update();
  return {refresh:update};
}
