// App entry: navigation, routing, quick search, theme, data freshness.
import {loadCore, db, fundsPriced} from './data.js';
import {dstr, esc} from './lib/fmt.js';
import {$, ago} from './lib/ui.js';
import {whenChartReady} from './lib/charts.js';
import {initRefresh, openRefresh, running} from './lib/refresh.js';

const ICON = {
  home:'<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  funds:'<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>',
  plan:'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  cmp:'<path d="M8 3v18M16 3v18M3 8h5M16 16h5M3 16h5M16 8h5"/>',
  shares:'<path d="M3 3v18h18M7 15l3-4 3 2 5-7"/>',
  pf:'<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  gov:'<path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3z"/>',
  goal:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  auto:'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  ext:'<path d="M14 4h6v6m0-6-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const NAV = [
  ['', 'Overview', 'home', 'Home'], ['funds', 'Unit trusts', 'funds', 'Funds'], ['plan', 'Fund planner', 'plan', 'Plan'], ['compare', 'Compare funds', 'cmp', null],
  ['shares', 'DSE shares', 'shares', 'Shares'], ['portfolio', 'Portfolio', 'pf', null], ['treasury', 'Bills & bonds', 'gov', 'Bonds'], ['goals', 'Goals', 'goal', null]
];
const ROUTES = {
  '':        () => import('./views/overview.js'),
  funds:     () => import('./views/funds.js'),
  fund:      () => import('./views/fund.js'),
  plan:      () => import('./views/plan.js'),
  compare:   () => import('./views/compare.js'),
  shares:    () => import('./views/shares.js'),
  share:     () => import('./views/share.js'),
  portfolio: () => import('./views/portfolio.js'),
  treasury:  () => import('./views/treasury.js'),
  goals:     () => import('./views/goals.js')
};

const navHtml = (active, mobile) => NAV.filter(n => !mobile || n[3]).map(([r, t, i, m]) =>
  `<a href="#/${r}" class="${active === r ? 'on' : ''}"${active === r ? ' aria-current="page"' : ''}>${svg(i)}<span>${mobile ? m : t}</span></a>`).join('') +
  (mobile ? '' : `<a href="legacy/" class="nav-ext" target="_blank" rel="noopener">${svg('ext')}<span>Classic calculator</span></a>`);
function parse(){
  const [a, ...rest] = (location.hash.replace(/^#\/?/, '') || '').split('/').map(decodeURIComponent);
  const b = rest.join('/');
  if (a === 'funds' && b) return {view:'fund', arg:b, nav:'funds'};
  if (a === 'shares' && b) return {view:'share', arg:b, nav:'shares'};
  if (a === 'plan' || a === 'compare') return {view:a, arg:b || null, nav:a};
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
    window.scrollTo(0, 0);
    document.title = (app.querySelector('h1')?.textContent || 'Mtaji') + ' · Mtaji';
  } catch(e){
    console.error(e);
    app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="hint">${esc(e.message)}</p></div>`;
  }
}

/* ---------- quick search (Ctrl+K or /) ---------- */
function searchIndex(){
  const items = NAV.map(([r, t]) => ({t, s:'Page', h:'#/' + r, k:t}));
  fundsPriced().forEach(f => items.push({t:f.name, s:f.mgrShort + ' · fund', h:'#/funds/' + f.id, k:f.name + ' ' + f.mgr}));
  Object.entries(db.dse.tickers).forEach(([t, s]) => items.push({t:t + ' · ' + s.name, s:'DSE share', h:'#/shares/' + t, k:t + ' ' + s.name}));
  return items;
}
function openSearch(){
  if ($('.pal-bg')) return;
  const all = searchIndex(), bg = document.createElement('div');
  bg.className = 'pal-bg';
  bg.innerHTML = `<div class="pal" role="dialog" aria-label="Search"><input placeholder="Search funds, shares and pages…" aria-label="Search"><ul></ul></div>`;
  document.body.appendChild(bg);
  const inp = bg.querySelector('input'), ul = bg.querySelector('ul');
  let hits = [], sel = 0;
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    hits = (q ? all.filter(x => x.k.toLowerCase().includes(q)).sort((a, b) => a.k.toLowerCase().indexOf(q) - b.k.toLowerCase().indexOf(q)) : all.filter(x => x.s === 'Page')).slice(0, 12);
    sel = Math.min(sel, Math.max(0, hits.length - 1));
    ul.innerHTML = hits.map((x, i) => `<li><a href="${x.h}" class="${i === sel ? 'on' : ''}">${esc(x.t)}<small>${esc(x.s)}</small></a></li>`).join('') || '<li class="grp">No matches</li>';
  };
  const close = () => bg.remove();
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown'){ sel = Math.min(hits.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp'){ sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && hits[sel]){ location.hash = hits[sel].h; close(); }
    else if (e.key === 'Escape') close();
  });
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('a')) close(); });
  draw(); inp.focus();
}

function theme(){
  const btn = $('#theme'), order = ['auto', 'light', 'dark'];
  const get = () => document.documentElement.dataset.theme || 'auto';
  const NAME = {auto:'Theme follows your system', light:'Light theme', dark:'Dark theme'};
  const label = () => { const t = get(); btn.innerHTML = svg({auto:'auto', light:'sun', dark:'moon'}[t]); btn.title = NAME[t] + ' (click to change)'; btn.setAttribute('aria-label', NAME[t]); };
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
  const s = db.meta?.sources || {}, bad = Object.entries(s).filter(([, v]) => v.ok === false), run = running();
  const NAMES = {utt:'UTT AMIS', navview:'Other funds', dse:'DSE', treasury:'BoT auctions', fx:'Exchange rates'};
  const text = run ? 'Refreshing…' : bad.length ? bad.length + ' source' + (bad.length > 1 ? 's' : '') + ' failed' : 'Data ' + ago(db.meta?.updated);
  const btn = $('#refresh');
  btn.className = 'data-btn' + (run ? ' run' : bad.length ? ' bad' : '');
  btn.innerHTML = `<i class="dot"></i><span>${text}</span>${svg('refresh').replace('<svg', '<svg width="14" height="14"')}`;
  btn.title = (bad.length ? bad.map(([k, v]) => (NAMES[k] || k) + ' failed: ' + (v.error || '')).join('\n') + '\n' : '') +
    Object.entries(NAMES).filter(([k]) => s[k]?.asof).map(([k, n]) => n + ': ' + dstr(s[k].asof)).join('\n') + '\nClick to refresh or see details';
  btn.setAttribute('aria-label', text + '. Refresh data');
  $('#mrefresh')?.classList.toggle('run', run);
}

(async function boot(){
  theme();
  try { await loadCore(); }
  catch(e){
    $('#app').innerHTML = `<div class="card"><h2>Could not load the data files</h2><p class="hint">${esc(e.message)}. If you opened index.html straight from disk, run a local server instead:
      <code>python -m http.server</code> in the project folder, then open http://localhost:8000.</p></div>`;
    return;
  }
  initRefresh({onChange:freshness, onData:() => { freshness(); route(); }});
  freshness();
  $('#refresh').addEventListener('click', openRefresh);
  $('#mrefresh').innerHTML = svg('refresh').replace('<svg', '<svg width="19" height="19"');
  $('#mrefresh').addEventListener('click', openRefresh);
  $('#search').innerHTML = `${svg('search').replace('<svg', '<svg width="15" height="15"')}<span>Search</span><kbd>Ctrl K</kbd>`;
  $('#search').addEventListener('click', openSearch);
  $('#msearch').innerHTML = svg('search').replace('<svg', '<svg width="20" height="20"');
  $('#msearch').addEventListener('click', openSearch);
  document.addEventListener('keydown', e => {
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))){ e.preventDefault(); openSearch(); }
  });
  window.addEventListener('hashchange', route);
  await new Promise(res => { whenChartReady(res); setTimeout(res, 4000); });   // charts degrade to tables if the CDN is down
  route();
})();
