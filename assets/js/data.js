// Loads the JSON files the pipeline writes into /data. Everything the pages show comes from here.
const files = {funds:'data/funds.json', history:'data/funds-history.json', dse:'data/dse.json', treasury:'data/treasury.json', meta:'data/meta.json'};
const cache = {};

async function get(name){
  if (!cache[name]) cache[name] = fetch(files[name], {cache:'no-cache'}).then(r => {
    if (!r.ok) throw new Error(files[name] + ' ' + r.status);
    return r.json();
  });
  return cache[name];
}

export const CAT = {mm:'Money market', fi:'Fixed income', bal:'Balanced', eq:'Equity / ETF'};
export const db = {funds:[], byId:{}, history:{}, dse:null, treasury:null, meta:null};

export async function loadCore(){
  const [f, d, t, m] = await Promise.all([get('funds'), get('dse'), get('treasury'), get('meta').catch(() => ({}))]);
  db.funds = f.funds; db.byId = Object.fromEntries(f.funds.map(x => [x.id, x]));
  db.dse = d; db.treasury = t; db.meta = m;
  return db;
}
/** Fund NAV history is ~0.7 MB, so it is loaded only when a fund page needs it. */
export async function loadHistory(){
  if (!Object.keys(db.history).length) db.history = await get('history');
  return db.history;
}
export const fundsPriced = () => db.funds.filter(f => f.nav);
export const managers = () => [...new Set(fundsPriced().map(f => f.mgr))];
