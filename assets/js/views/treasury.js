import {db} from '../data.js';
import {fmt, fmt2, compact, money as tzs, pct, dstr, iso, addDays, addMonths, clamp} from '../lib/fmt.js';
import {$, bind, load, persist, money, number, seg, select, stat, kpi, table} from '../lib/ui.js';
import {draw, bar, colors} from '../lib/charts.js';
import {bill, bondPrice, irr} from '../engine/treasury.js';

export default function treasury(app){
  const TB = db.treasury, tax = TB.tax || {};
  const st = load('treasury', {kind:'bills', mode:'cash', amt:10e6, ten:'364', yld:TB.bills['364'].y, wht:tax.bill_wht ?? 10, roll:0, date:iso(new Date()),
    bten:'10', face:10e6, cpn:TB.bonds['10'].c, ytm:TB.bonds['10'].y, bwht:0, use:'cash', rr:10, asof:TB.asof});
  if (st.asof !== TB.asof){ st.yld = TB.bills[st.ten].y; st.cpn = TB.bonds[st.bten].c; st.ytm = TB.bonds[st.bten].y; st.asof = TB.asof; }
  app.innerHTML = `
  <div class="page-head"><div><h1>Bills & bonds</h1><p>Bank of Tanzania Treasury bills and bonds. Rates from the latest auctions (${dstr(TB.asof)}); type your own if a newer auction has closed.</p></div>
    ${seg('kind', [['bills', 'Treasury bills'], ['bonds', 'Treasury bonds']], {label:'Security'})}</div>
  <div class="planner" id="bills">
    <form class="card inputs" onsubmit="return false">
      <div class="field"><span class="lbl">I want to enter</span>${seg('mode', [['cash', 'Cash to invest'], ['face', 'Face value']], {label:'Amount type'})}</div>
      ${money('amt', 'Amount')}
      <div class="field"><span class="lbl">Tenor</span>${seg('ten', [['35', '35d'], ['91', '91d'], ['182', '182d'], ['364', '364d']], {label:'Tenor'})}</div>
      ${number('yld', 'Auction yield', '% / yr', {min:0, max:30, step:0.0001, slider:[0, 20, 0.01], aside:' '})}
      <div class="two">${number('wht', 'Withholding tax', '%', {min:0, max:30, step:0.5})}${number('roll', 'Roll over', 'times', {min:0, max:20})}</div>
      <div class="field"><label for="b-date">Settlement date</label><div class="box"><input type="date" id="b-date" name="date"></div></div>
    </form>
    <div class="stack"><div class="grid g4" id="bk"></div>
      <div class="card" id="roll-c"><div class="card-head"><h2>Rolling over</h2></div><div class="tbl" id="rt"></div></div>
      <div class="card"><div class="card-head"><h2>Compare tenors for this amount</h2></div><div class="tbl" id="bt"></div></div></div>
  </div>
  <div class="planner" id="bonds">
    <form class="card inputs" onsubmit="return false">
      ${select('bten', 'Tenor', Object.keys(TB.bonds).map(k => [k, k + ' years']))}
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
  </div>`;
  const b = bind(app, st, k => {
    if (k === 'ten') st.yld = TB.bills[st.ten].y;
    if (k === 'bten'){ st.cpn = TB.bonds[st.bten].c; st.ytm = TB.bonds[st.bten].y; st.bwht = +st.bten < 3 ? (tax.bond_wht_under3y ?? 10) : (tax.bond_wht_3y_plus ?? 0); }
    if (k === 'ten' || k === 'bten') b.write();
    persist('treasury', st); update();
  });
  function update(){
    const c = colors();
    $('#bills', app).hidden = st.kind !== 'bills'; $('#bonds', app).hidden = st.kind !== 'bonds'; $('#rr-f', app).hidden = st.use !== 'reinvest';
    /* bills */
    const d = +st.ten, src = TB.bills[st.ten].src, sd = st.date || iso(new Date()), w = st.wht/100;
    $('#aside-yld', app).innerHTML = src && Math.abs(st.yld - TB.bills[st.ten].y) < 1e-9 ? '<span class="chip ok">BoT</span>' : '<span class="chip est">your rate</span>';
    const x = bill(st.amt, st.mode, st.yld/100, d, w);
    $('#bk', app).innerHTML = kpi('You pay', tzs(x.cost), 'price ' + fmt2(x.p, 4) + ' per 100', true) + kpi('Interest after tax', tzs(x.netInt), compact(x.tax) + ' tax on ' + compact(x.disc) + ' discount') +
      kpi('You receive', tzs(x.rec), 'on ' + dstr(addDays(sd, d))) + kpi('Net yield', pct(x.ny), 'a year, after tax');
    const rolls = clamp(Math.round(st.roll) || 0, 0, 20); $('#roll-c', app).hidden = !rolls;
    if (rolls){ let cash = x.cost, dt = sd; const rows = [];
      for (let i = 0; i <= rolls; i++){ const y = bill(cash, 'cash', st.yld/100, d, w), e = addDays(dt, d); rows.push(`<tr${i === rolls ? ' class="hl"' : ''}><td>${i + 1}</td><td>${dstr(dt)}</td><td>${fmt(y.cost)}</td><td>${fmt(y.netInt)}</td><td>${fmt(y.rec)}</td><td>${dstr(e)}</td></tr>`); cash = y.rec; dt = e; }
      const days = d*(rolls + 1);
      $('#rt', app).innerHTML = table(['Cycle', 'Start', 'Invested', 'Net interest', 'Proceeds', 'Matures'], rows, `<tr><td colspan="4">Net gain after ${days} days: TZS ${fmt(cash - x.cost)}</td><td colspan="2">${pct(Math.pow(cash/x.cost, 365/days) - 1)} a year compounded</td></tr>`); }
    $('#bt', app).innerHTML = table(['Tenor', 'Yield', 'You pay', 'Net interest', 'Net / yr'], ['35', '91', '182', '364'].map(k => { const y = bill(st.amt, st.mode, (k === st.ten ? st.yld : TB.bills[k].y)/100, +k, w);
      return `<tr${k === st.ten ? ' class="me"' : ''}><td>${k} days</td><td>${fmt2(k === st.ten ? st.yld : TB.bills[k].y, 4)}%</td><td>${fmt(y.cost)}</td><td>${fmt(y.netInt)}</td><td>${pct(y.ny)}</td></tr>`; }));
    /* bonds */
    const n = +st.bten, bs = TB.bonds[st.bten], cp = st.cpn/100, y = st.ytm/100, bw = st.bwht/100, rr = st.rr/100;
    $('#bsrc', app).innerHTML = bs.src ? '<span class="chip ok">BoT</span> ' + bs.src : '<span class="chip est">estimate</span> Enter the coupon and yield from the latest auction notice.';
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
  update();
  return {refresh:update};
}
