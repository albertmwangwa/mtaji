// Number, money and date formatting used across the app.
export const fmt = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '–');
export const fmt2 = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d}) : '–');
export const money = (v, cur = 'TZS') => cur + ' ' + fmt(v);
export function compact(v){
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e12) return s + (a/1e12).toFixed(2) + 'T';
  if (a >= 1e9) return s + (a/1e9).toFixed(a >= 1e11 ? 0 : 2) + 'B';
  if (a >= 1e6) return s + (a/1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
  if (a >= 1e3) return s + (a/1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
  return s + Math.round(a);
}
/** decimal -> "12.34%" */
export const pct = (v, d = 2) => (Number.isFinite(v) ? (v*100).toFixed(d) + '%' : '–');
/** percent number -> "+12.34%" */
export const pp = (v, d = 2) => (Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%' : '–');
export const tone = v => (!Number.isFinite(v) || v === 0 ? 'mut' : v > 0 ? 'up' : 'down');
export const ppHtml = (v, d = 2) => `<span class="${tone(v)}">${pp(v, d)}</span>`;
export function parseMoney(s){
  s = String(s ?? '').trim().toLowerCase().replace(/[, _]/g, '').replace(/^tzs/, '');
  let m = 1;
  if (/[kmbt]$/.test(s)){ m = {k:1e3, m:1e6, b:1e9, t:1e12}[s.slice(-1)]; s = s.slice(0, -1); }
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.max(0, v*m) : 0;
}
export const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const date = s => (s instanceof Date ? s : new Date(String(s).slice(0, 10) + 'T00:00:00'));
export const dstr = d => date(d).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
export const mstr = d => date(d).toLocaleDateString('en-GB', {month: 'short', year: 'numeric'});
export const addMonths = (d, n) => { const x = new Date(date(d)); x.setMonth(x.getMonth() + n); return x; };
export const addDays = (d, n) => { const x = new Date(date(d)); x.setDate(x.getDate() + n); return x; };
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
