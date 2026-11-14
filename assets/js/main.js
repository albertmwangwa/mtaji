// App entry: navigation, routing, theme, data freshness.
import {loadCore, db} from './data.js';
import {dstr} from './lib/fmt.js';
import {$} from './lib/ui.js';
import {whenChartReady} from './lib/charts.js';

const ICON = {
  home:'<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  funds:'<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>',
  plan:'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  shares:'<path d="M3 3v18h18M7 15l3-4 3 2 5-7"/>',
  pf:'<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  gov:'<path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3z"/>',
  goal:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const NAV = [
  ['', 'Overview', 'home'], ['funds', 'Unit trusts', 'funds'], ['plan', 'Fund planner', 'plan'],
  ['shares', 'DSE shares', 'shares'], ['portfolio', 'Portfolio', 'pf'], ['treasury', 'Bills & bonds', 'gov'], ['goals', 'Goals', 'goal']
];
const ROUTES = {
  '':          () => import('./views/overview.js'),
  funds:       () => import('./views/funds.js'),
  fund:        () => import('./views/fund.js'),
  plan:        () => import('./views/plan.js'),
  shares:      () => import('./views/shares.js'),
  share:       () => import('./views/share.js'),
  portfolio:   () => import('./views/portfolio.js'),
  treasury:    () => import('./views/treasury.js'),
  goals:       () => import('./views/goals.js')
};

function navHtml(active, mobile){
  return NAV.filter(n => !mobile || n[0] !== 'goals').map(([r, t, i]) =>
    `<a href="#/${r}" class="${active === r ? 'on' : ''}">${svg(i)}<span>${mobile ? t.replace('Unit trusts', 'Funds').replace('Fund planner', 'Plan').replace('Bills & bonds', 'Bonds').replace('DSE shares', 'Shares') : t}</span></a>`).join('');
}
function parse(){
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').map(decodeURIComponent);
  let [a, b] = parts;
  if (a === 'funds' && b) return {view:'fund', arg:b, nav:'funds'};
  if (a === 'shares' && b) return {view:'share', arg:b, nav:'shares'};
  if (a === 'plan') return {view:'plan', arg:b, nav:'plan'};
  return {view:ROUTES[a || ''] ? (a || '') : '', arg:null, nav:a || ''};
}
let current = null;
async function route(){
  const r = parse(), app = $('#app');
  $('#nav').innerHTML = navHtml(r.nav, false);
  $('#tabbar').innerHTML = navHtml(r.nav, true);
  try {
    const mod = await ROUTES[r.view]();
    if (current?.destroy) current.destroy();
    app.innerHTML = '';
    current = mod.default(app, r.arg) || null;
    if (!r.keepScroll) window.scrollTo(0, 0);
  } catch(e){
    console.error(e);
    app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="hint">${e.message}</p></div>`;
  }
}

function theme(){
  const btn = $('#theme'), order = ['auto', 'light', 'dark'];
  const get = () => document.documentElement.dataset.theme || 'auto';
  const label = () => { btn.textContent = 'Theme: ' + get(); };
  btn.addEventListener('click', () => {
    const next = order[(order.indexOf(get()) + 1) % 3];
    if (next === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    try { next === 'auto' ? localStorage.removeItem('mtaji:theme') : localStorage.setItem('mtaji:theme', next); } catch(e){}
    label(); current?.refresh?.();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => current?.refresh?.());
  label();
}

function freshness(){
  const s = db.meta?.sources || {}, bad = Object.entries(s).filter(([, v]) => v.ok === false);
  const line = (k, t) => s[k]?.asof ? `<div>${t}: ${dstr(s[k].asof)}</div>` : '';
  $('#freshness').innerHTML = `<div class="status${bad.length ? ' bad' : ''}"><i></i>${bad.length ? 'Some sources failed' : 'Data up to date'}</div>` +
    line('utt', 'UTT AMIS') + line('navview', 'Other funds') + line('dse', 'DSE') + line('treasury', 'BoT rates');
}

(async function boot(){
  theme();
  try { await loadCore(); }
  catch(e){
    $('#app').innerHTML = `<div class="card"><h2>Could not load the data files</h2><p class="hint">${e.message}. If you opened index.html straight from disk, run a local server instead:
      <code>python -m http.server</code> in the project folder, then open http://localhost:8000.</p></div>`;
    return;
  }
  freshness();
  window.addEventListener('hashchange', route);
  await new Promise(res => { whenChartReady(res); setTimeout(res, 4000); });   // charts degrade to tables if the CDN is down
  route();
})();
