// The user's DSE portfolio, shared by the shares, share and portfolio pages.
const KEY = 'mtaji:portfolio';
const DEFAULT = [{t:'CRDB', a:10e6, g:null}, {t:'NMB', a:10e6, g:null}, {t:'TBL', a:5e6, g:null}, {t:'VODA', a:5e6, g:null}];
export function getHoldings(){
  try { const x = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(x)) return x; } catch(e){}
  return DEFAULT.map(r => ({...r}));
}
export function saveHoldings(h){ try { localStorage.setItem(KEY, JSON.stringify(h)); } catch(e){} }
export function addHolding(t, a = 5e6){ const h = getHoldings(); h.push({t, a, g:null}); saveHoldings(h); return h; }
