/* RetinaX frontend. All data and decisions now come from the backend API (see README). */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cap = s => s[0].toUpperCase() + s.slice(1);
const fmt = t => new Date(t).toLocaleString('en-IN', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
const pct = v => Math.round(v * 100) + '%';
const GR = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];

let patients = [], DOCS = [], cur = null;

async function api(path, method = 'GET', body) {
  let res;
  try {
    res = await fetch('/api' + path, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  } catch { throw new Error('Cannot reach the server. Check your connection.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Request failed');
  return j;
}
const toDataURL = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });

/* Illustrative heatmap, used only when the model does not return a real Grad-CAM image. */
function drawHeat(canvas, img, grade, seed) {
  const c = canvas.getContext('2d'), W = canvas.width, s = Math.min(img.naturalWidth, img.naturalHeight);
  c.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, W, W);
  let x = seed || 7; const r = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < [0, 2, 3, 5, 7][grade]; i++) {
    const px = W * (.2 + r() * .6), py = W * (.2 + r() * .6), rad = W * (.08 + r() * .1);
    const g = c.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(255,0,0,.75)'); g.addColorStop(.5, 'rgba(255,200,0,.45)'); g.addColorStop(1, 'rgba(0,200,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, W);
  }
}
const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

/* ---------- tabs ---------- */
function tab(t) {
  for (const k of ['screen', 'dash', 'docs']) {
    $('v-' + k).classList.toggle('hide', k !== t);
    $('t-' + k).classList.toggle('on', k === t);
  }
  if (t === 'dash') loadDash();
  if (t === 'docs') loadDocs();
}
$('t-screen').onclick = () => tab('screen');
$('t-dash').onclick = () => tab('dash');
$('t-docs').onclick = () => tab('docs');

async function refreshDocs() {
  DOCS = await api('/doctors');
  $('dl').innerHTML = [...new Set(DOCS.map(d => d.dist))].map(d => `<option value="${esc(d)}">`).join('');
}

/* ---------- screening ---------- */
const ready = () => { $('run').disabled = !(($('right').files[0] || $('left').files[0]) && $('name').value.trim()); };
['right', 'left', 'name'].forEach(i => $(i).addEventListener('input', ready));

function eyeHTML(k, e, url) {
  return `<div class="eye"><h3>${cap(k)} eye</h3>
    <div class="imgs"><figure><img src="${url}" alt="${k} eye"><figcaption>Original</figcaption></figure>
    <figure><canvas id="h-${k}" width="400" height="400"></canvas><figcaption>Regions influencing the result</figcaption></figure></div>
    <p style="margin:10px 0 0"><b>${GR[e.grade]}</b>${e.grade ? ' diabetic retinopathy' : ''}</p>
    <div class="mut">Confidence: ${pct(e.conf)}</div><div class="bar"><i style="width:${e.conf * 100}%"></i></div></div>`;
}

$('run').onclick = async () => {
  $('run').disabled = true; $('run').textContent = 'Analysing…';
  try {
    const body = {}, urls = {};
    for (const k of ['right', 'left']) {
      const f = $(k).files[0]; if (!f) continue;
      urls[k] = await toDataURL(f); body[k] = {name: f.name, data: urls[k]};
    }
    const out = await api('/screen', 'POST', body);
    $('eyes').innerHTML = ['right', 'left'].map(k => out.eyes[k] ? eyeHTML(k, {grade: out.eyes[k].grade, conf: out.eyes[k].conf}, urls[k])
      : `<div class="eye"><h3>${cap(k)} eye</h3><p class="mut">Not uploaded</p></div>`).join('');
    const eyes = {};
    for (const k in out.eyes) {
      const e = out.eyes[k], cv = $('h-' + k);
      if (e.heatmap) { cv.getContext('2d').drawImage(await loadImg(e.heatmap), 0, 0, cv.width, cv.height); }
      else drawHeat(cv, await loadImg(urls[k]), e.grade, e.seed);
      eyes[k] = {grade: e.grade, conf: e.conf, heat: cv.toDataURL('image/jpeg', .7)};
    }
    cur = {eyes, grade: out.grade, action: out.action, actText: out.actText, low: out.low};
    $('overall').textContent = 'Overall: ' + GR[out.grade] + (out.grade ? ' diabetic retinopathy (worse eye)' : '');
    $('act').textContent = out.action.toUpperCase(); $('act').className = 'badge b-' + out.action;
    $('actText').textContent = out.actText;
    $('low').classList.toggle('hide', !out.low);
    $('res').classList.remove('hide'); await renderBook(); $('book').classList.remove('hide');
    $('res').scrollIntoView({behavior: 'smooth'});
  } catch (e) { alert(e.message); }
  $('run').textContent = 'Run screening'; ready();
};

/* ---------- booking ---------- */
function docRow(s, best) {
  return `<div class="doc ${best ? 'best' : ''}"><div><b>${esc(s.name)}</b> · ${esc(s.spec)}<br>
    <span class="mut">${esc(s.hosp)}, ${esc(s.dist)} · ${fmt(s.t)}</span></div>
    <button class="btn ${best ? '' : 'sec'} sm" data-slot="${s.id}">${best ? 'Confirm this appointment' : 'Choose'}</button></div>`;
}
async function renderBook() {
  const b = $('bookBody');
  if (cur.action === 'rescreen') {
    b.innerHTML = `<p>No referral needed. Save the record and send a reminder to rescreen in 6–12 months.</p><button class="btn" id="saveOnly">Save record &amp; send reminder</button>`;
    $('saveOnly').onclick = () => finish(null); return;
  }
  const dist = $('district').value.trim();
  const {slots: list, fallback} = await api(`/matches?action=${cur.action}&district=${encodeURIComponent(dist)}`);
  const note = fallback ? `<div class="note">No free slot in ${esc(dist || 'this district')} within the window. Showing options in other districts.</div>` : '';
  if (!list.length) {
    b.innerHTML = `<div class="note">No slots available. Add a doctor in the Doctors tab or contact a hospital manually.</div><div class="row"><button class="btn" id="saveOnly">Save as pending referral</button></div>`;
    $('saveOnly').onclick = () => finish(null); return;
  }
  b.innerHTML = `<p class="mut">Suggested ${cur.action === 'urgent' ? 'retina specialist, earliest slot' : 'ophthalmologist within 2 weeks'}. The health worker confirms before booking.</p>${note}${docRow(list[0], true)}
    <details style="margin-top:8px"><summary style="cursor:pointer;color:var(--pri);font-weight:600">Choose another doctor or time</summary>${list.slice(1, 7).map(s => docRow(s, false)).join('')}</details>`;
  b.querySelectorAll('[data-slot]').forEach(x => x.onclick = () => finish(+x.dataset.slot));
}

const eyeLine = (r, k) => r.eyes[k] ? `${cap(k)} eye: ${GR[r.eyes[k].grade]} (confidence ${pct(r.eyes[k].conf)})` : `${cap(k)} eye: not screened`;
function waText(r) {
  if (!r.doc) return `Hello ${r.name}, your eye screening is complete.\n${eyeLine(r, 'right')}\n${eyeLine(r, 'left')}\nPlease rescreen in ${r.grade ? '6–12' : '12'} months. We will remind you.`;
  return `Hello ${r.name}, your eye screening result:\n${eyeLine(r, 'right')}\n${eyeLine(r, 'left')}\nAppointment: ${r.doc.name}, ${r.doc.hosp}, ${fmt(r.t)}.\nYour referral letter link is included.`;
}

async function emailDoctor(r) {
  try { await api(`/patients/${r.id}/email-doctor`, 'POST', {}); alert('Report emailed to ' + r.doc.email); }
  catch (e) { alert(e.message); }
}

async function finish(slotId) {
  document.querySelectorAll('#bookBody button').forEach(b => b.disabled = true);
  let r;
  try {
    r = await api('/patients', 'POST', {
      name: $('name').value.trim(), age: $('age').value, phone: $('phone').value.trim(), dist: $('district').value.trim(),
      dur: $('dur').value, consent: $('consent').checked, eyes: cur.eyes, slot_id: slotId
    });
  } catch (e) { alert(e.message); await renderBook(); return; }
  const slot = !!r.doc;
  const w = r.msg === 'sent' ? `<span class="badge b-sent">WhatsApp sent</span>`
    : `<span class="badge b-failed">WhatsApp not sent: ${esc(r.msg_error || 'unknown error')}</span>`;
  $('bookBody').innerHTML = `<p><b>${slot ? 'Appointment booked' : 'Record saved'}.</b> ${w}</p>
    <div class="wa">${esc(waText(r))}</div>
    <div class="row"><button class="btn" id="b1">View referral letter</button>
    ${slot ? '<button class="btn" id="b2">Email report to doctor</button>' : ''}
    <button class="btn sec" id="b3">Open tracker</button><button class="btn sec" id="b4">New screening</button></div>`;
  $('b1').onclick = () => letter(r);
  if (slot) $('b2').onclick = () => emailDoctor(r);
  $('b3').onclick = () => tab('dash'); $('b4').onclick = () => location.reload();
}

/* ---------- referral letter ---------- */
function letter(r) {
  const eyeBlock = k => r.eyes[k]?.heat ? `<div style="flex:1;min-width:150px"><img src="${r.eyes[k].heat}" alt="${k} heatmap" style="width:100%;border-radius:8px"><div style="font-size:12px;color:#555">${cap(k)} eye: ${GR[r.eyes[k].grade]}</div></div>` : '';
  $('letter').innerHTML = `<h3>Referral Letter</h3>
    <div style="color:#555;font-size:13px;margin-bottom:12px">RetinaX screening · ${new Date(r.date).toLocaleDateString('en-IN')} · Ref #${r.id}</div>
    <table>
      <tr><td>Patient</td><td><b>${esc(r.name)}</b>, age ${esc(r.age ?? '–')}, ${esc(r.dist) || '–'}</td></tr>
      <tr><td>Diabetes duration</td><td>${esc(r.dur ?? '–')} years</td></tr>
      <tr><td>Right eye</td><td>${r.eyes.right ? `<b>${GR[r.eyes.right.grade]}</b> (${pct(r.eyes.right.conf)})` : 'Not screened'}</td></tr>
      <tr><td>Left eye</td><td>${r.eyes.left ? `<b>${GR[r.eyes.left.grade]}</b> (${pct(r.eyes.left.conf)})` : 'Not screened'}</td></tr>
      <tr><td>Recommended action</td><td>${esc(r.actText)}</td></tr>
      ${r.doc ? `<tr><td>Referred to</td><td>${esc(r.doc.name)}, ${esc(r.doc.spec)}, ${esc(r.doc.hosp)}</td></tr><tr><td>Appointment</td><td><b>${fmt(r.t)}</b></td></tr>` : ''}
    </table>
    <div style="display:flex;gap:10px;margin-top:12px">${eyeBlock('right')}${eyeBlock('left')}</div>
    <div style="font-size:12px;color:#555;margin-top:8px">AI-assisted screening result. Not a diagnosis; requires clinical confirmation.</div>
    <div class="noprint row"><button class="btn" onclick="window.print()">Print / Save PDF</button>
    ${r.doc ? '<button class="btn sec" id="mailBtn">Email to doctor</button>' : ''}
    <button class="btn sec" onclick="$('modal').classList.add('hide')">Close</button></div>`;
  if (r.doc) $('mailBtn').onclick = () => emailDoctor(r);
  $('modal').classList.remove('hide');
}
$('modal').onclick = e => { if (e.target.id === 'modal') $('modal').classList.add('hide'); };

/* ---------- tracker ---------- */
async function loadDash() {
  try { patients = await api('/patients'); } catch (e) { alert(e.message); return; }
  renderDash();
}
function renderDash() {
  const n = f => patients.filter(f).length;
  $('stats').innerHTML = [['Screened', patients.length], ['Urgent', n(p => p.action === 'urgent')], ['Referred', n(p => p.status === 'referred')],
    ['Pending', n(p => p.status === 'pending')], ['Completed', n(p => p.status === 'completed')], ['Missed', n(p => p.status === 'missed')]]
    .map(x => `<div><b>${x[1]}</b><span class="mut">${x[0]}</span></div>`).join('');
  $('empty').classList.toggle('hide', patients.length > 0);
  $('rows').innerHTML = patients.map(p => `<tr>
    <td><b>${esc(p.name)}</b><br><span class="mut">${esc(p.dist)}</span></td>
    <td>${new Date(p.date).toLocaleDateString('en-IN')}</td>
    <td>${['right', 'left'].map(k => p.eyes[k] ? `${k[0].toUpperCase()}: ${GR[p.eyes[k].grade]}` : '').filter(Boolean).join('<br>')}</td>
    <td><span class="badge b-${p.action}">${p.action}</span></td>
    <td>${p.doc ? esc(p.doc.name) + '<br><span class="mut">' + fmt(p.t) + '</span>' : '–'}</td>
    <td><select data-s="${p.id}">${['pending', 'referred', 'completed', 'missed'].map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
    <td><span class="badge b-${p.msg}" title="${esc(p.msg_error)}">${p.msg}</span> <button class="btn sec sm" data-r="${p.id}">Resend</button></td>
    <td><button class="btn sec sm" data-l="${p.id}">Letter</button>${p.doc ? `<button class="btn sec sm" data-m="${p.id}">Email doctor</button>` : ''}</td></tr>`).join('');
  const get = i => patients.find(p => p.id == i);
  document.querySelectorAll('[data-s]').forEach(x => x.onchange = async () => {
    try { await api(`/patients/${x.dataset.s}/status`, 'PATCH', {status: x.value}); } catch (e) { alert(e.message); }
    loadDash();
  });
  document.querySelectorAll('[data-r]').forEach(x => x.onclick = async () => {
    try { await api(`/patients/${x.dataset.r}/whatsapp`, 'POST', {}); } catch (e) { alert(e.message); }
    loadDash();
  });
  document.querySelectorAll('[data-l]').forEach(x => x.onclick = () => letter(get(x.dataset.l)));
  document.querySelectorAll('[data-m]').forEach(x => x.onclick = () => emailDoctor(get(x.dataset.m)));
}

/* ---------- doctors ---------- */
async function loadDocs() {
  try { await refreshDocs(); } catch (e) { alert(e.message); return; }
  $('docRows').innerHTML = DOCS.map(d => `<tr><td><b>${esc(d.name)}</b><br><span class="mut">${esc(d.phone)}</span></td><td>${esc(d.spec)}</td>
    <td>${esc(d.hosp)}</td><td>${esc(d.dist)}</td><td>${esc(d.email)}</td><td>${d.free}</td>
    <td><button class="btn sec sm" data-del="${d.id}">Remove</button></td></tr>`).join('');
  document.querySelectorAll('[data-del]').forEach(x => x.onclick = async () => {
    if (!confirm('Remove this doctor and their slots?')) return;
    try { await api('/doctors/' + x.dataset.del, 'DELETE'); } catch (e) { alert(e.message); }
    loadDocs();
  });
}
$('d-add').onclick = async () => {
  const v = id => $(id).value.trim(), msg = $('d-msg');
  try {
    await api('/doctors', 'POST', {name: v('d-name'), spec: $('d-spec').value, hosp: v('d-hosp'), dist: v('d-dist'), email: v('d-email'), phone: v('d-phone')});
    ['d-name', 'd-hosp', 'd-dist', 'd-email', 'd-phone'].forEach(i => $(i).value = '');
    msg.textContent = 'Doctor added.'; loadDocs();
  } catch (e) { msg.textContent = e.message; }
};

refreshDocs().catch(() => {});
