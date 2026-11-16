// "Refresh data" from inside the app. Browsers can't read UTT, DSE or BoT directly (their sites don't allow
// cross-site requests), so the button starts the GitHub Actions workflow that runs the pipeline and republishes
// the site, follows it to the end, then loads the new data files into the open page.
// Starting a workflow needs a GitHub token; it is kept only in this browser's localStorage.
import {db, reloadCore, latestMeta} from '../data.js';
import {dstr, esc} from './fmt.js';
import {ago} from './ui.js';

function repo(){
  const host = location.hostname.match(/^([\w-]+)\.github\.io$/), seg = location.pathname.split('/')[1];
  return host && seg ? host[1] + '/' + seg : 'albertmwangwa/mtaji';
}
const REPO = repo(), WF = 'site.yml', API = `https://api.github.com/repos/${REPO}/actions`;
const WF_URL = `https://github.com/${REPO}/actions/workflows/${WF}`;
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const SRC = {utt:'UTT AMIS', navview:'Other fund managers', dse:'DSE', treasury:'BoT auctions', fx:'Exchange rates'};
const STEPS = [['start', 'Starting the workflow on GitHub'], ['fetch', 'Collecting UTT, fund, DSE and BoT data'], ['deploy', 'Publishing the updated site'], ['load', 'Loading the new figures']];

const store = {
  get(k){ try { return localStorage.getItem('mtaji:' + k); } catch(e){ return null; } },
  set(k, v){ try { v == null ? localStorage.removeItem('mtaji:' + k) : localStorage.setItem('mtaji:' + k, v); } catch(e){} }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const token = () => store.get('gh-token');

let job = null;            // {run, url, started, before, step, done, ok, error, auth}
let onData = () => {};
const listeners = new Set();
const emit = () => listeners.forEach(f => f());

async function gh(path, opt = {}){
  const r = await fetch(API + path, {...opt, headers:{Accept:'application/vnd.github+json', Authorization:'Bearer ' + token(), 'X-GitHub-Api-Version':'2022-11-28'}});
  const authErr = msg => { const e = new Error(msg); e.auth = true; return e; };
  if (r.status === 401) throw authErr('GitHub did not accept the token. It may have expired or been revoked, so add a new one.');
  if (r.status === 403 || r.status === 404) throw authErr(`This token can't run workflows in ${REPO}. Give it access to the ${REPO.split('/')[1]} repository with the Actions permission set to "Read and write".`);
  if (!r.ok) throw new Error('GitHub answered ' + r.status + '. Try again in a minute.');
  return r.status === 204 ? null : r.json();
}

/** Start a refresh, or join one that is already running (a scheduled run, or one started on another device). */
async function start(){
  if (job && !job.done) return;
  job = {step:'start', started:Date.now(), before:db.meta?.updated || ''};
  emit();
  try {
    const list = await gh(`/workflows/${WF}/runs?per_page=5`);
    let run = list.workflow_runs.find(r => r.status !== 'completed' && r.event !== 'push');
    if (!run){
      const t0 = Date.now();
      await gh(`/workflows/${WF}/dispatches`, {method:'POST', body:JSON.stringify({ref:'main'})});
      for (let i = 0; i < 20 && !run; i++){   // the new run takes a few seconds to appear
        await sleep(3000);
        const l = await gh(`/workflows/${WF}/runs?event=workflow_dispatch&per_page=5`);
        run = l.workflow_runs.find(r => Date.parse(r.created_at) >= t0 - 30e3);
      }
      if (!run) throw new Error('GitHub accepted the request but the run has not appeared yet. Check it on GitHub.');
    }
    job.run = run.id; job.url = run.html_url;
    store.set('refresh-run', JSON.stringify({run:job.run, url:job.url, started:job.started, before:job.before}));
    emit();
    await follow();
  } catch(e){ fail(e); }
}

async function follow(){
  for (;;){
    const run = await gh(`/runs/${job.run}`);
    if (run.status === 'completed'){
      if (run.conclusion !== 'success') throw new Error(`The workflow finished as "${run.conclusion}". Open it on GitHub to see what happened.`);
      break;
    }
    const jobs = (await gh(`/runs/${job.run}/jobs`)).jobs, j = n => jobs.find(x => x.name === n);
    const step = j('refresh')?.status === 'completed' || j('deploy')?.status === 'in_progress' ? 'deploy' : run.status === 'in_progress' ? 'fetch' : 'start';
    if (step !== job.step){ job.step = step; emit(); }
    await sleep(8000);
  }
  job.step = 'load'; emit();
  let m = null;   // GitHub Pages takes a moment to serve the new files: wait until meta.json changes (up to 2 minutes)
  for (let i = 0; i < 24; i++){
    m = await latestMeta().catch(() => null);
    if (m?.updated && m.updated !== job.before) break;
    await sleep(5000);
  }
  await reloadCore(m?.updated);
  Object.assign(job, {done:true, ok:true});
  store.set('refresh-run', null);
  emit(); onData();
}

function fail(e){
  if (e.auth) store.set('gh-token', null);
  job = {...(job || {}), done:true, ok:false, error:e.message, auth:!!e.auth};
  store.set('refresh-run', null);
  emit();
}

/** Load data a refresh published elsewhere (a scheduled run, or another device). Needs no token. */
async function loadLatest(){
  const m = await latestMeta();
  if (!m?.updated || m.updated === db.meta?.updated) return false;
  await reloadCore(m.updated);
  onData();
  return true;
}

export const running = () => !!job && !job.done;
/** Sidebar status line while a refresh is running, else null. */
export function statusHtml(){
  if (!running()) return null;
  const s = STEPS.find(x => x[0] === job.step);
  return `<div class="status run"><i></i>Refreshing: ${esc(s[1].split(' ')[0].toLowerCase())}…</div>`;
}

export function initRefresh(opts){
  onData = opts.onData || onData;
  if (opts.onChange) listeners.add(opts.onChange);
  // resume a refresh started before the page was reloaded
  try {
    const saved = JSON.parse(store.get('refresh-run') || 'null');
    if (saved && token() && Date.now() - saved.started < 40*60e3){
      job = {...saved, step:'start'};
      follow().catch(fail);
    } else store.set('refresh-run', null);
  } catch(e){ store.set('refresh-run', null); }
}

export function openRefresh(){
  if (document.querySelector('.pal-bg')) return;
  const bg = document.createElement('div');
  bg.className = 'pal-bg';
  bg.innerHTML = '<div class="pal rf" role="dialog" aria-modal="true" aria-labelledby="rf-t"></div>';
  document.body.appendChild(bg);
  const box = bg.firstChild;
  let note = '', busy = false;
  const tick = setInterval(() => { const el = box.querySelector('#rf-el'); if (el && running()) el.textContent = elapsed(); }, 1000);
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { listeners.delete(draw); clearInterval(tick); document.removeEventListener('keydown', onKey); bg.remove(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', e => { if (e.target === bg) close(); });

  const elapsed = () => { const s = Math.round((Date.now() - job.started)/1000); return Math.floor(s/60) + ':' + String(s % 60).padStart(2, '0'); };
  const sources = () => {
    const s = db.meta?.sources || {};
    return `<div class="rf-src">${Object.entries(SRC).filter(([k]) => s[k]).map(([k, t]) =>
      `<span>${t}</span><b class="${s[k].ok === false ? 'bad' : ''}">${s[k].ok === false ? 'failed' : s[k].asof ? dstr(s[k].asof) : '–'}</b>`).join('')}
      <span class="mut">Last refresh</span><b class="mut">${db.meta?.updated ? ago(db.meta.updated) : '–'}</b></div>`;
  };
  const tokenForm = () => `
    <p>The figures are collected by a GitHub workflow, because UTT, DSE and the Bank of Tanzania don't let a browser read their data directly. This button starts that workflow. It usually takes 4 to 6 minutes.</p>
    <p>To start it from here, this browser needs a GitHub token that can run workflows in <b>${esc(REPO)}</b>. The token is saved only in this browser.</p>
    <ol class="rf-how">
      <li><a href="${TOKEN_URL}" target="_blank" rel="noopener">Create a fine-grained token ↗</a> and set an expiry.</li>
      <li>Under <b>Repository access</b>, choose <b>Only select repositories</b>, then <b>${esc(REPO.split('/')[1])}</b>.</li>
      <li>Under <b>Permissions</b>, set <b>Actions</b> to <b>Read and write</b>. Nothing else is needed.</li>
      <li>Generate the token and paste it below.</li>
    </ol>
    <div class="box"><input name="tok" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false" aria-label="GitHub token"></div>
    <div class="rf-row"><button class="btn primary" data-act="save" type="button">Save and refresh</button><button class="btn" data-act="latest" type="button">Load latest data</button></div>
    <p class="hint">No token? <a href="${WF_URL}" target="_blank" rel="noopener">Open the workflow on GitHub ↗</a> and click <b>Run workflow</b>. When it finishes, use <b>Load latest data</b>.</p>`;

  function draw(){
    let body;
    if (running()){
      const at = STEPS.findIndex(s => s[0] === job.step);
      body = `<ul class="rf-steps">${STEPS.map(([k, t], i) => `<li class="${i < at ? 'ok' : i === at ? 'on' : ''}"><i>${i < at ? '✓' : ''}</i>${t}</li>`).join('')}</ul>
        <p class="hint">Running for <b id="rf-el">${elapsed()}</b>. You can close this window: the refresh carries on, the sidebar shows its progress, and the page updates when it's done.${job.url ? ` <a href="${job.url}" target="_blank" rel="noopener">Watch it on GitHub ↗</a>` : ''}</p>`;
    } else {
      const res = job?.done && job.ok ? `<div class="rf-ok">Data updated. Every page now shows the new figures.</div>`
        : job?.done && job.error ? `<div class="rf-err">${esc(job.error)}${job.url ? ` <a href="${job.url}" target="_blank" rel="noopener">Open the run ↗</a>` : ''}</div>` : '';
      body = res + sources() + (token()
        ? `<p>Collect fresh figures from every source (UTT AMIS, the other fund managers, DSE and the Bank of Tanzania) and republish the site. It usually takes 4 to 6 minutes.</p>
           <div class="rf-row"><button class="btn primary" data-act="go" type="button">Refresh all data now</button><button class="btn" data-act="latest" type="button">Load latest data</button></div>
           <p class="hint">Started from a saved GitHub token. <a href="#" data-act="forget">Remove it from this browser</a></p>`
        : tokenForm());
    }
    box.innerHTML = `<div class="rf-head"><h2 id="rf-t">Refresh data</h2><button class="rf-x" data-act="close" type="button" aria-label="Close">×</button></div>${body}${note ? `<p class="hint">${esc(note)}</p>` : ''}`;
    box.querySelector('input[name=tok]')?.focus();
  }
  box.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || busy) return;
    e.preventDefault(); note = '';
    if (act === 'close') return close();
    if (act === 'forget'){ store.set('gh-token', null); job = null; return draw(); }
    if (act === 'save'){
      const v = box.querySelector('input[name=tok]').value.trim();
      if (!/^(github_pat_|ghp_)\w{20,}$/.test(v)){ note = 'That does not look like a GitHub token. Fine-grained tokens start with github_pat_.'; return draw(); }
      store.set('gh-token', v);
    }
    if (act === 'save' || act === 'go'){ start(); return draw(); }
    if (act === 'latest'){
      busy = true; note = 'Checking…'; draw();
      try { note = await loadLatest() ? 'Loaded the latest published data.' : `You already have the latest data (refreshed ${ago(db.meta?.updated)}).`; }
      catch(err){ note = 'Could not check for new data: ' + err.message; }
      busy = false; draw();
    }
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.name === 'tok') box.querySelector('[data-act=save]').click(); });
  listeners.add(draw);
  draw();
}
