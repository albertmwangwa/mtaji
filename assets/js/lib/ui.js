// Small DOM helpers and a form binder: inputs with name="key" read/write a plain state object
// that is saved per page in localStorage.
import {fmt, parseMoney, esc} from './fmt.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function load(key, defaults){
  try { return Object.assign(structuredClone(defaults), JSON.parse(localStorage.getItem('mtaji:' + key) || '{}')); }
  catch(e){ return structuredClone(defaults); }
}
export function persist(key, state){ try { localStorage.setItem('mtaji:' + key, JSON.stringify(state)); } catch(e){} }

/* ---- field builders (return HTML strings) ---- */
export const money = (name, label, {max = 500e6, hint = '', cur = 'TZS'} = {}) => `
  <div class="field">
    <label for="f-${name}">${label}</label>
    <div class="box"><span>${cur}</span><input id="f-${name}" name="${name}" data-money inputmode="decimal" autocomplete="off"></div>
    <input type="range" min="0" max="1000" step="1" data-range-for="${name}" data-max="${max}" aria-label="${esc(label)} slider">
    ${hint ? `<p class="hint">${hint}</p>` : ''}
  </div>`;
export const number = (name, label, unit, {min = 0, max = 100, step = 1, slider = null, hint = '', aside = ''} = {}) => `
  <div class="field">
    <div class="lbl-row"><label for="f-${name}">${label}</label>${aside ? `<small id="aside-${name}">${aside}</small>` : ''}</div>
    <div class="box"><input id="f-${name}" name="${name}" type="number" min="${min}" max="${max}" step="${step}" data-num>${unit ? `<span>${unit}</span>` : ''}</div>
    ${slider ? `<input type="range" min="${slider[0]}" max="${slider[1]}" step="${slider[2] || step}" data-pair-for="${name}" aria-label="${esc(label)} slider">` : ''}
    ${hint ? `<p class="hint">${hint}</p>` : ''}
  </div>`;
export const select = (name, label, options, {hint = ''} = {}) => `
  <div class="field">
    ${label ? `<label for="f-${name}">${label}</label>` : ''}
    <div class="box"><select id="f-${name}" name="${name}">${options.map(o => Array.isArray(o)
      ? `<option value="${esc(o[0])}">${esc(o[1])}</option>`
      : `<optgroup label="${esc(o.group)}">${o.items.map(i => `<option value="${esc(i[0])}">${esc(i[1])}</option>`).join('')}</optgroup>`).join('')}</select></div>
    ${hint ? `<p class="hint" id="hint-${name}">${hint}</p>` : ''}
  </div>`;
let segN = 0;
export const seg = (name, options, {cls = '', label = ''} = {}) => {
  const id = 's' + (++segN);
  return `<div class="seg ${cls}" role="radiogroup" aria-label="${esc(label || name)}">${options.map(([v, t]) =>
    `<input type="radio" name="${name}" id="${id}-${v}" value="${v}"><label for="${id}-${v}">${t}</label>`).join('')}</div>`;
};
export const check = (name, label) => `<label class="check"><input type="checkbox" name="${name}"><span>${label}</span></label>`;

/* ---- log-scale money slider ---- */
const LO = 10000;
const toPos = (v, max) => v <= 0 ? 0 : v <= LO ? 1 : Math.min(1000, Math.round(1 + 999*Math.log(v/LO)/Math.log(max/LO)));
const nice = v => { if (v <= 0) return 0; const e = Math.pow(10, Math.max(3, Math.floor(Math.log10(v)) - 1)); return Math.round(v/e)*e; };
const toVal = (t, max) => t <= 0 ? 0 : Math.min(max, nice(LO*Math.pow(max/LO, (t - 1)/999)));

/** Bind every named input inside root to state; calls onChange(key) after each edit. */
export function bind(root, state, onChange){
  const write = () => {
    $$('[name]', root).forEach(el => {
      const k = el.name; if (!(k in state)) return;
      if (el.type === 'radio') el.checked = String(state[k]) === el.value;
      else if (el.type === 'checkbox') el.checked = !!state[k];
      else if (el.dataset.money !== undefined) el.value = fmt(state[k]);
      else el.value = state[k];
    });
    $$('[data-range-for]', root).forEach(r => { r.value = toPos(state[r.dataset.rangeFor], +r.dataset.max); });
    $$('[data-pair-for]', root).forEach(r => { r.value = state[r.dataset.pairFor]; });
  };
  const read = el => {
    const k = el.name;
    if (el.type === 'radio'){ if (el.checked) state[k] = el.value; }
    else if (el.type === 'checkbox') state[k] = el.checked;
    else if (el.dataset.money !== undefined) state[k] = parseMoney(el.value);
    else if (el.dataset.num !== undefined) state[k] = el.value === '' ? 0 : +el.value;
    else state[k] = el.value;
  };
  root.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.rangeFor){ const k = el.dataset.rangeFor; state[k] = toVal(+el.value, +el.dataset.max); const t = $(`[name="${k}"]`, root); if (t) t.value = fmt(state[k]); onChange(k); return; }
    if (el.dataset.pairFor){ const k = el.dataset.pairFor; state[k] = +el.value; const t = $(`[name="${k}"]`, root); if (t) t.value = el.value; onChange(k); return; }
    if (!el.name || el.closest('[data-list]')) return;
    read(el);
    if (el.dataset.money !== undefined){ const r = $(`[data-range-for="${el.name}"]`, root); if (r) r.value = toPos(state[el.name], +r.dataset.max); }
    const pr = $(`[data-pair-for="${el.name}"]`, root); if (pr) pr.value = el.value;
    onChange(el.name);
  });
  root.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.money !== undefined && !el.closest('[data-list]')) el.value = fmt(state[el.name]);
    if (el.type === 'radio' || el.tagName === 'SELECT' || el.type === 'checkbox'){ if (!el.closest('[data-list]')){ read(el); onChange(el.name); } }
  });
  write();
  return {write};
}

/** A list of editable rows (special amounts, holdings...). Row fields use data-f="key". */
export function list(container, arr, renderRow, onChange){
  container.dataset.list = '1';
  const draw = () => { container.innerHTML = arr.map((r, i) => renderRow(r, i)).join(''); };
  container.addEventListener('input', e => {
    const el = e.target, row = el.closest('[data-i]'); if (!row || !el.dataset.f) return;
    const r = arr[+row.dataset.i], f = el.dataset.f;
    r[f] = el.dataset.money !== undefined ? parseMoney(el.value) : el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value;
    onChange(f, r, row);
  });
  container.addEventListener('change', e => {
    const el = e.target; if (el.dataset.money !== undefined) el.value = fmt(parseMoney(el.value));
    if (el.tagName === 'SELECT' && el.dataset.f){ const row = el.closest('[data-i]'); if (row){ draw(); onChange(el.dataset.f, arr[+row.dataset.i]); } }
  });
  container.addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    arr.splice(+b.closest('[data-i]').dataset.i, 1); draw(); onChange('del');
  });
  draw();
  return {draw, add(r){ arr.push(r); draw(); onChange('add'); const ins = container.querySelectorAll('[data-money]'); if (ins.length) ins[ins.length - 1].focus(); }};
}

export const opt = (v, t, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(t)}</option>`;
export const table = (head, rows, foot = '') => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table>`;
export const stat = (label, value, sub = '') => `<div class="stat"><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
export const kpi = (label, value, sub = '', lead = false) => `<div class="kpi${lead ? ' lead' : ''}"><div class="k">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
