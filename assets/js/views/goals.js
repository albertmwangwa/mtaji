import {fmt, compact, money as tzs, pct, clamp} from '../lib/fmt.js';
import {$, bind, list, load, persist, money, number, seg, select, kpi, table, opt} from '../lib/ui.js';
import {draw, bar, line, colors} from '../lib/charts.js';
import {simulate, WHEN, toEvents} from '../engine/sim.js';

export default function goals(app){
  const st = load('goals', {mode:'fv', pv:5e6, pmt:300e3, goal:100e6, years:10, rate:12, comp:'12', freq:'1', off:1, step:0, inf:4, sp:[]});
  app.innerHTML = `
  <div class="page-head"><div><h1>Goals</h1><p>What a regular saving grows to, or how much to save to reach a target, in today's shillings too.</p></div>
    ${seg('mode', [['fv', 'What will I have?'], ['goal', 'How much to save?']], {label:'Mode'})}</div>
  <div class="planner">
    <form class="card inputs" onsubmit="return false">
      <div id="goal-f">${money('goal', 'Target amount', {max:5e9})}</div>
      ${money('pv', 'Starting amount')}
      <div id="pmt-f">${money('pmt', 'Regular saving', {max:50e6})}</div>
      <div class="field"><span class="lbl">Every</span>${seg('freq', [['1', 'Month'], ['3', 'Quarter'], ['12', 'Year']], {label:'Frequency'})}</div>
      <div class="two">${number('off', 'First after', 'months', {min:0, max:24})}${number('step', 'Raise yearly by', '%', {min:0, max:50})}</div>
      ${number('years', 'Years', '', {min:1, max:60, slider:[1, 40, 1]})}
      <div class="two">${number('rate', 'Return', '% / yr', {min:-20, max:60, step:0.1})}${select('comp', 'Compounded', [['12', 'Monthly'], ['4', 'Quarterly'], ['2', 'Half-yearly'], ['1', 'Yearly'], ['365', 'Daily']])}</div>
      ${number('inf', 'Inflation', '% / yr', {min:0, max:30, step:0.1, hint:"Used to show the result in today's shillings."})}
      <div class="field"><div class="lbl-row"><span class="lbl">One-off amounts</span><small>bonus, gift, sale</small></div><div class="rows" id="sp"></div><button class="btn ghost sm" type="button" id="sp-add">+ Add amount</button></div>
    </form>
    <div class="stack"><p class="note" id="call" hidden></p><div class="grid g4" id="k"></div>
      <div class="card"><div class="card-head"><h2>Growth by year</h2></div><div class="legend" id="lg"></div><div class="chart lg"><canvas id="ch"></canvas></div></div>
      <details class="card"><summary>Year-by-year table</summary><div class="tbl" id="t"></div></details></div>
  </div>`;
  const L = list($('#sp', app), st.sp, (r, i) => `<div class="row-item" data-i="${i}"><div class="box"><span>Year</span><input type="number" min="1" max="60" data-f="y" value="${r.y}"></div>
    <div class="box"><select data-f="w">${WHEN.map(w => opt(w[0], w[1], r.w)).join('')}</select></div><button type="button" class="icon-btn" data-del aria-label="Remove">×</button>
    <div class="box wide"><span>TZS</span><input data-f="a" data-money inputmode="decimal" value="${fmt(r.a)}"></div></div>`, () => { persist('goals', st); update(); });
  $('#sp-add', app).onclick = () => L.add({y:Math.min(st.years, (st.sp.at(-1)?.y || 0) + 1), w:'12', a:5e6});
  bind(app, st, () => { persist('goals', st); update(); });
  function update(){
    const c = colors(), years = clamp(Math.round(st.years) || 1, 1, 60), k = +st.comp, eff = Math.pow(1 + st.rate/100/k, k) - 1, mRate = Math.pow(1 + eff, 1/12) - 1;
    const every = +st.freq, goal = st.mode === 'goal', inf = st.inf/100, word = {1:'month', 3:'quarter', 12:'year'}[every];
    $('#goal-f', app).hidden = !goal; $('#pmt-f', app).hidden = goal;
    const base = {initial:st.pv, every, offset:st.off, step:st.step/100, mRate, months:years*12, specials:toEvents(st.sp, years)};
    let pmt = st.pmt;
    if (goal){
      const zero = simulate({...base, pmt:0}).bal, unit = simulate({...base, pmt:1}).bal - zero;
      pmt = unit > 0 ? Math.max(0, (st.goal - zero)/unit) : 0;
      $('#call', app).hidden = false;
      $('#call', app).innerHTML = zero >= st.goal ? `Your starting amount alone grows to <b>${tzs(zero)}</b>, which already meets the target.`
        : `To reach <b>${tzs(st.goal)}</b> in ${years} years, put in <b>${tzs(pmt)} every ${word}</b>${st.step ? ', raising it ' + st.step + '% each year' : ''}.`;
    } else $('#call', app).hidden = true;
    const sim = simulate({...base, pmt}), real = sim.bal/Math.pow(1 + inf, years);
    $('#k', app).innerHTML = kpi(goal ? 'Needed every ' + word : 'Value after ' + years + ' years', tzs(goal ? pmt : sim.bal), goal ? 'reaches ' + compact(sim.bal) : pct(eff) + ' effective a year', true) +
      kpi("In today's shillings", tzs(real), 'at ' + st.inf + '% inflation') + kpi('Total put in', tzs(sim.inv), (sim.count ? sim.count + ' payments' : 'starting amount') + (sim.spCount ? ' + ' + sim.spCount + ' one-off' : '')) +
      kpi('Interest earned', tzs(sim.bal - sim.inv), eff > 0 ? 'doubles every ' + (Math.log(2)/Math.log(1 + eff)).toFixed(1) + ' yrs' : '');
    $('#lg', app).innerHTML = `<span><i style="background:${c.series[0]}"></i>Money put in</span><span><i style="background:${c.series[1]}"></i>Interest</span><span><i class="line" style="background:${c.muted}"></i>Value in today's shillings</span>`;
    draw($('#ch', app), {labels:sim.rows.map(x => 'Y' + x.year), datasets:[bar('Money put in', sim.rows.map(x => Math.min(x.bal, x.inv)), c.series[0]), bar('Interest', sim.rows.map(x => Math.max(0, x.bal - x.inv)), c.series[1]),
      line("Today's shillings", sim.rows.map(x => x.bal/Math.pow(1 + inf, x.year)), c.muted, {borderDash:[5, 4], stack:'line'})], stacked:true});
    $('#t', app).innerHTML = table(['Year', 'Added', 'of which one-off', 'Total in', 'Value', "Today's TZS"], sim.rows.map(x => `<tr${x.special ? ' class="hl"' : ''}><td>${x.year}</td><td>${fmt(x.contrib)}</td><td>${x.special ? fmt(x.special) : '–'}</td><td>${fmt(x.inv)}</td><td>${fmt(x.bal)}</td><td>${fmt(x.bal/Math.pow(1 + inf, x.year))}</td></tr>`));
  }
  update();
  return {refresh:update};
}
