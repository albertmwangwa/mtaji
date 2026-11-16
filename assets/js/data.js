// Loads the JSON files the pipeline writes into /data. Everything the pages show comes from here.
const files = {funds:'data/funds.json', history:'data/funds-history.json', dse:'data/dse.json', treasury:'data/treasury.json', meta:'data/meta.json', fx:'data/fx.json', bonds:'data/bonds.json'};
const cache = {};
let ver = '';   // set after an in-app refresh so the CDN serves the new files, not cached ones

async function get(name){
  if (!cache[name]) cache[name] = fetch(files[name] + (ver ? '?v=' + encodeURIComponent(ver) : ''), {cache:'no-cache'}).then(r => {
    if (!r.ok) throw new Error(files[name] + ' ' + r.status);
    return r.json();
  });
  return cache[name];
}

export const CAT = {mm:'Money market', fi:'Fixed income', bal:'Balanced', eq:'Equity / ETF'};
export const db = {funds:[], byId:{}, history:{}, dse:null, treasury:null, meta:null, fx:null, bonds:null};

export async function loadCore(){
  const [f, d, t, m, x] = await Promise.all([get('funds'), get('dse'), get('treasury'), get('meta').catch(() => ({})), get('fx').catch(() => null)]);
  db.funds = f.funds; db.byId = Object.fromEntries(f.funds.map(x => [x.id, x]));
  db.dse = d; db.treasury = t; db.meta = m; db.fx = x;
  return db;
}
/** Drop every loaded file and load the core files again (after a data refresh). */
export async function reloadCore(v){
  ver = v || String(Date.now());
  for (const k of Object.keys(cache)) delete cache[k];
  db.history = {}; db.bonds = null;
  return loadCore();
}
/** The published meta.json, bypassing every cache: used to tell when a refresh has gone live. */
export async function latestMeta(){
  const r = await fetch(files.meta + '?t=' + Date.now(), {cache:'no-store'});
  return r.ok ? r.json() : null;
}
/** Fund NAV history is ~0.7 MB, so it is loaded only when a fund page needs it. */
export async function loadHistory(){
  if (!Object.keys(db.history).length) db.history = await get('history');
  return db.history;
}
export const fundsPriced = () => db.funds.filter(f => f.nav);
export const managers = () => [...new Set(fundsPriced().map(f => f.mgr))];

/** Listed government and corporate bonds (~150 KB), loaded by the bills & bonds page only. */
export async function loadBonds(){ if (!db.bonds) db.bonds = await get('bonds'); return db.bonds; }
/** The DSE session so far (data/live.json, written every 20 minutes during trading hours), bypassing caches. */
export async function loadLive(){
  try { const r = await fetch('data/live.json?t=' + Date.now(), {cache:'no-store'}); return r.ok ? r.json() : null; } catch(e){ return null; }
}
/** Today's quote for share t from live.json, when it is newer than the last close in dse.json. */
export function liveToday(t, L){
  const s = db.dse?.tickers?.[t], q = L?.q?.[t];
  if (!s || !q || !(q[3] > 0) || !(L.day > s.date) || (q[3] === s.vol && q[4] === s.high)) return null;
  return {vol:q[3], high:q[4], low:q[5], prev:q[1], at:L.at, open:L.open, live:true};
}
export const usd = () => db.fx?.rates?.USD?.mean || null;
