'use strict';
const STORE = 'liuk_v1';
const PASS_MARK = 18;
const TOTAL_TESTS = 17;
const OPTIONS = ['A', 'B', 'C', 'D', 'TRUE', 'FALSE'];
const EXAM_SECONDS = 45 * 60;

// ---------- storage ----------
// state: { key: {"1":["A",...]}, attempts:[{id,test,date,answers:[..],score,total,passed}],
//          draft:{"3":["A",null,..]}, studied:{"3-7":true} }
function load() {
  try { return Object.assign({ key: {}, attempts: [], draft: {}, studied: {} }, JSON.parse(localStorage.getItem(STORE))); }
  catch (e) { return { key: {}, attempts: [], draft: {}, studied: {} }; }
}
let S = load();
const save = () => localStorage.setItem(STORE, JSON.stringify(S));
if (!Object.keys(S.key).length && typeof DEFAULT_KEY !== 'undefined') { S.key = DEFAULT_KEY; save(); }

// ---------- answer key parsing ----------
function normAnswer(a) {
  a = a.toUpperCase();
  if (a === 'T') return 'TRUE';
  if (a === 'F') return 'FALSE';
  return a;
}
function parseKey(text) {
  const key = {}, warnings = [];
  let cur = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    let m = line.match(/^[-\s]*(?:test|t)\s*(\d+)\b/i);
    if (m) { cur = +m[1]; key[cur] = key[cur] || {}; return; }
    m = line.match(/^(\d+)\s*[-.:)]?\s*(true|false|t|f|a|b|c|d)$/i);
    if (m && cur) { key[cur][+m[1]] = normAnswer(m[2]); return; }
    warnings.push(`Line ${i + 1} not understood: "${line}"`);
  });
  const out = {};
  Object.keys(key).forEach(t => {
    const qs = key[t], n = Object.keys(qs).length;
    const arr = [];
    for (let q = 1; q <= n; q++) {
      if (!qs[q]) { warnings.push(`Test ${t}: question ${q} is missing`); break; }
      arr.push(qs[q]);
    }
    if (n !== 24) warnings.push(`Test ${t} has ${n} answers (expected 24)`);
    out[t] = arr;
  });
  return { key: out, warnings };
}

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const attemptsOf = t => S.attempts.filter(a => a.test === +t);
const hasKey = () => Object.keys(S.key).length > 0;

// latest attempt per test -> wrong questions that are still unresolved
function studyItems() {
  const items = [];
  Object.keys(S.key).map(Number).sort((a, b) => a - b).forEach(t => {
    const att = attemptsOf(t);
    if (!att.length) return;
    const last = att[att.length - 1];
    last.answers.forEach((ans, i) => {
      if (ans !== S.key[t][i]) items.push({ test: t, q: i + 1, mine: ans, right: S.key[t][i], done: !!S.studied[`${t}-${i + 1}`] });
    });
  });
  return items;
}

// ---------- views ----------
let view = 'dashboard', timer = null;

function render(next, arg) {
  if (next) view = next;
  clearInterval(timer);
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  const open = studyItems().filter(i => !i.done).length;
  $('#studyCount').textContent = open || '';
  const app = $('#app');
  ({ dashboard, test: testView, result: resultView, study: studyView, data: dataView }[view])(app, arg);
}

function dashboard(app) {
  if (!hasKey()) {
    app.innerHTML = `<div class="card"><h2>Welcome</h2><p>First, load your answer key.</p>
      <button class="primary" data-go="data">Load answers</button></div>`;
    return bind(app);
  }
  const tests = Object.keys(S.key).map(Number).sort((a, b) => a - b);
  const done = tests.filter(t => attemptsOf(t).length), passed = tests.filter(t => attemptsOf(t).some(a => a.passed));
  const best = tests.map(t => Math.max(0, ...attemptsOf(t).map(a => a.score)));
  app.innerHTML = `
    <div class="stats">
      <div><b>${done.length}/${tests.length}</b><span class="mute">tests attempted</span></div>
      <div><b>${passed.length}</b><span class="mute">passed (≥${PASS_MARK})</span></div>
      <div><b>${S.attempts.length}</b><span class="mute">attempts total</span></div>
    </div>
    <div class="grid">${tests.map(t => {
      const att = attemptsOf(t), last = att[att.length - 1], draft = S.draft[t];
      const cls = draft ? 'prog' : last ? (last.passed ? 'pass' : 'fail') : '';
      const tag = draft ? 'In progress' : last ? (last.passed ? 'Pass' : 'Fail') : 'Not started';
      const hist = att.map(a => a.score).join(' → ');
      return `<button class="tile ${cls}" data-test="${t}"><span class="tag">${tag}</span><b>Test ${t}</b><span class="hist">${hist || '&nbsp;'}</span></button>`;
    }).join('')}</div>`;
  app.querySelectorAll('[data-test]').forEach(b => b.onclick = () => openTest(+b.dataset.test));
}

function openTest(t) {
  const att = attemptsOf(t), draft = S.draft[t];
  if (!att.length || draft) return render('test', t);
  // has history: show history with option to retake
  const app = $('#app');
  app.innerHTML = `<h2>Test ${t}</h2><div class="card">${att.map((a, i) =>
    `<div class="row"><b>Attempt ${i + 1}</b><span>${fmtDate(a.date)}</span><span class="pill ${a.passed ? 'ok' : 'bad'}">${a.score}/${a.total} ${a.passed ? 'PASS' : 'FAIL'}</span>
     <button data-view="${a.id}">Review</button></div>`).join('')}
     <div class="actions"><button class="primary" id="retake">Retake test</button><button data-go="dashboard">Back</button></div></div>`;
  $('#retake').onclick = () => render('test', t);
  app.querySelectorAll('[data-view]').forEach(b => b.onclick = () => render('result', S.attempts.find(a => a.id === b.dataset.view)));
  bind(app);
}

function testView(app, t) {
  const total = S.key[t].length;
  const draft = S.draft[t] || (S.draft[t] = Array(total).fill(null));
  let useTimer = false, left = EXAM_SECONDS;
  const answered = () => draft.filter(Boolean).length;
  app.innerHTML = `<h2>Test ${t}</h2><div class="card" id="qs">${draft.map((a, i) => `
    <div class="q"><span class="n">${i + 1}</span><div class="opts" data-q="${i}">
    ${OPTIONS.map(o => `<button data-o="${o}" class="${a === o ? 'sel' : ''}">${o === 'TRUE' ? 'True' : o === 'FALSE' ? 'False' : o}</button>`).join('')}
    </div></div>`).join('')}</div>
    <div class="bar"><span><span id="cnt"></span> <label><input type="checkbox" id="tm"> 45-min timer</label> <b id="clock"></b></span>
    <span><button data-go="dashboard">Save &amp; exit</button> <button class="primary" id="submit">Submit</button></span></div>`;
  const cnt = () => $('#cnt').textContent = `${answered()}/${total} answered`;
  cnt();
  app.querySelectorAll('.opts').forEach(box => box.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const q = +box.dataset.q;
    draft[q] = draft[q] === b.dataset.o ? null : b.dataset.o;   // click again to clear
    box.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x.dataset.o === draft[q]));
    save(); cnt();
  });
  const submit = () => {
    clearInterval(timer);
    const score = draft.filter((a, i) => a === S.key[t][i]).length;
    const att = { id: Date.now().toString(36), test: +t, date: new Date().toISOString(), answers: draft.slice(), score, total, passed: score >= PASS_MARK };
    S.attempts.push(att); delete S.draft[t];
    // fresh attempt: questions of this test start un-studied again
    Object.keys(S.studied).filter(k => k.startsWith(t + '-')).forEach(k => delete S.studied[k]);
    save(); render('result', att);
  };
  $('#submit').onclick = () => {
    const missing = total - answered();
    if (missing && !$('#submit').dataset.sure) {
      $('#submit').dataset.sure = 1; $('#submit').textContent = `${missing} unanswered – click again to submit`; return;
    }
    submit();
  };
  $('#tm').onchange = e => {
    clearInterval(timer); $('#clock').textContent = '';
    if (!e.target.checked) return;
    left = EXAM_SECONDS;
    timer = setInterval(() => {
      left--; const m = Math.floor(left / 60), s = String(left % 60).padStart(2, '0');
      $('#clock').textContent = `${m}:${s}`;
      if (left <= 0) { clearInterval(timer); submit(); }
    }, 1000);
  };
  bind(app);
}

function resultView(app, att) {
  const key = S.key[att.test];
  const wrong = att.answers.map((a, i) => ({ q: i + 1, mine: a, right: key[i] })).filter(x => x.mine !== x.right);
  const n = attemptsOf(att.test).findIndex(a => a.id === att.id) + 1;
  app.innerHTML = `<div class="card result">
      <div class="mute">Test ${att.test} · attempt ${n} · ${fmtDate(att.date)}</div>
      <div class="big ${att.passed ? 'ok' : 'bad'}">${att.passed ? 'PASS' : 'FAIL'}</div>
      <div>${att.score} / ${att.total} <span class="mute">(need ${PASS_MARK})</span></div></div>
    <div class="card"><h3>${wrong.length ? `Wrong answers (${wrong.length})` : 'Perfect score!'}</h3>
    ${wrong.map(w => `<div class="row"><b>Q${w.q}</b><span>You: <span class="pill bad">${esc(w.mine || '—')}</span></span><span>Correct: <span class="pill ok">${esc(w.right)}</span></span></div>`).join('')}
    <div class="actions"><button class="primary" data-go="dashboard">Back to tests</button><button data-go="study">Study list</button></div></div>`;
  bind(app);
}

function studyView(app) {
  const items = studyItems();
  if (!items.length) {
    app.innerHTML = `<h2>Study list</h2><div class="card mute">Nothing here yet. Wrong answers from your latest attempt of each test will appear here.</div>`;
    return;
  }
  const byTest = {};
  items.forEach(i => (byTest[i.test] = byTest[i.test] || []).push(i));
  const open = items.filter(i => !i.done).length;
  app.innerHTML = `<h2>Study list</h2>
    <p class="mute">${open} to review, ${items.length - open} marked as studied. A question leaves this list once you answer it correctly in a later attempt of that test.</p>
    ${Object.keys(byTest).map(t => `<div class="card"><h3>Test ${t}</h3>${byTest[t].map(i => `
      <label class="row"><input type="checkbox" data-k="${i.test}-${i.q}" ${i.done ? 'checked' : ''}>
      <b>Q${i.q}</b><span>You: <span class="pill bad">${esc(i.mine || '—')}</span></span><span>Correct: <span class="pill ok">${esc(i.right)}</span></span></label>`).join('')}</div>`).join('')}`;
  app.querySelectorAll('[data-k]').forEach(c => c.onchange = () => {
    if (c.checked) S.studied[c.dataset.k] = true; else delete S.studied[c.dataset.k];
    save(); render('study');
  });
}

function dataView(app) {
  app.innerHTML = `<h2>Data</h2>
    <div class="card"><h3>Answer key</h3>
      <p class="mute">Paste your answers (see <code>answers-template.txt</code> for the format) or pick the .txt file.
      ${hasKey() ? `Currently loaded: <b>${Object.keys(S.key).length}</b> tests. Loading a new key keeps your attempts.` : ''}</p>
      <input type="file" id="keyfile" accept=".txt"><br><br>
      <textarea id="keytext" placeholder="Test 1&#10;1 A&#10;2 TRUE&#10;..."></textarea>
      <div class="actions"><button class="primary" id="loadkey">Load answer key</button></div>
      <div id="keymsg"></div></div>
    <div class="card"><h3>Backup</h3>
      <p class="mute">Progress lives in this browser. Export a backup now and then (and before clearing browser data).</p>
      <div class="actions"><button id="export">Export progress</button>
      <button id="import">Import progress</button><input type="file" id="importfile" accept=".json" hidden></div></div>
    <div class="card"><h3>Reset</h3><div class="actions"><button id="reset">Delete all progress</button></div></div>`;
  $('#keyfile').onchange = async e => { if (e.target.files[0]) $('#keytext').value = await e.target.files[0].text(); };
  $('#loadkey').onclick = () => {
    const { key, warnings } = parseKey($('#keytext').value);
    if (!Object.keys(key).length) { $('#keymsg').innerHTML = `<p class="bad">No tests found. Each test needs a "Test N" header line.</p>`; return; }
    S.key = key; save();
    $('#keymsg').innerHTML = `<p class="ok">Loaded ${Object.keys(key).length} tests.</p>` +
      warnings.slice(0, 15).map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join('');
  };
  $('#export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = `liuk-progress-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $('#import').onclick = () => $('#importfile').click();
  $('#importfile').onchange = async e => {
    try { S = Object.assign({ key: {}, attempts: [], draft: {}, studied: {} }, JSON.parse(await e.target.files[0].text())); save(); render('dashboard'); }
    catch (err) { alert('That file could not be read.'); }
  };
  let sure = false;
  $('#reset').onclick = () => {
    if (!sure) { sure = true; $('#reset').textContent = 'Click again to confirm'; return; }
    S = { key: S.key, attempts: [], draft: {}, studied: {} }; save(); render('dashboard');
  };
}

function bind(root) {
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => render(b.dataset.go));
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => render(b.dataset.nav));
render('dashboard');
