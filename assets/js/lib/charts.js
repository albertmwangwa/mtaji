// Chart.js wrappers that pick up the theme tokens, so charts match light and dark mode.
import {compact, fmt} from './fmt.js';

const live = new Map();
export function colors(){
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  return {ink:g('--ink'), muted:g('--muted'), line:g('--line'), surface:g('--surface'), accent:g('--accent'), interest:g('--interest'), good:g('--good'), bad:g('--bad'),
    series:['--c1','--c2','--c3','--c4','--c5','--c6','--c7','--c8','--c9','--c10'].map(g), neutral:g('--faint')};
}
export const seriesColor = i => colors().series[i % 10];

function base(c, {stacked = false, money = true, y1 = false, logY = false, xType = 'category', xTick = null} = {}){
  const tick = {color:c.muted, font:{size:11}};
  const scales = {
    x:{type:xType, stacked, grid:{display:false}, border:{color:c.line}, ticks:Object.assign({maxRotation:0, autoSkip:true, autoSkipPadding:10}, tick, xTick ? {callback:xTick} : {})},
    y:{type:logY ? 'logarithmic' : 'linear', stacked, position:'left', beginAtZero:!logY, grid:{color:c.line, drawTicks:false}, border:{display:false}, ticks:Object.assign({padding:6, maxTicksLimit:7, callback:v => money ? compact(v) : v}, tick)}
  };
  if (y1) scales.y1 = {position:'right', beginAtZero:true, grid:{display:false}, border:{display:false}, ticks:Object.assign({maxTicksLimit:7, callback:v => compact(v)}, tick)};
  return {responsive:true, maintainAspectRatio:false, animation:{duration:250}, interaction:{mode:'index', intersect:false},
    plugins:{legend:{display:false}, tooltip:{backgroundColor:c.surface, titleColor:c.ink, bodyColor:c.muted, borderColor:c.line, borderWidth:1, cornerRadius:10, padding:12,
      boxPadding:4, usePointStyle:true, titleFont:{weight:'600', size:12.5}, bodyFont:{size:12}, callbacks:{label:ctx => ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y)}}},
    scales};
}

/** Draw (or redraw) a chart on a canvas. opts: stacked, y1, logY, xType, xTick, tooltip (callbacks), money */
export function draw(canvas, {type = 'bar', labels, datasets, ...opts}){
  if (!window.Chart || !canvas) return null;
  const c = colors(), o = base(c, opts);
  if (opts.tooltip) Object.assign(o.plugins.tooltip.callbacks, opts.tooltip);
  if (opts.displayColors === false) o.plugins.tooltip.displayColors = false;
  if (opts.interaction) o.interaction = opts.interaction;
  const prev = live.get(canvas); if (prev) prev.destroy();
  const ch = new window.Chart(canvas, {type, data:{labels, datasets}, options:o});
  live.set(canvas, ch);
  return ch;
}
export const bar = (label, data, color, extra = {}) => Object.assign({type:'bar', label, data, backgroundColor:color, borderRadius:3, stack:'s', maxBarThickness:42}, extra);
export const line = (label, data, color, extra = {}) => Object.assign({type:'line', label, data, borderColor:color, backgroundColor:color, borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:.2}, extra);
export function whenChartReady(fn){
  if (window.Chart) return fn();
  const t = setInterval(() => { if (window.Chart){ clearInterval(t); fn(); } }, 60);
  setTimeout(() => clearInterval(t), 8000);
}
/** Same colour with transparency; works for hsl() tokens and hex. */
export const alpha = (col, a) => col.startsWith('hsl(') ? col.replace(/\)$/, ` / ${a})`) : col + Math.round(a*255).toString(16).padStart(2, '0');
