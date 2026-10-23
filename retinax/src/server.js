import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Doctors, Slots, Patients } from './db.js';
import { predict } from './model.js';
import { decide, GRADES } from './clinical.js';
import { sendWhatsApp, emailDoctor, eyeLine, fmt } from './notify.js';

const PORT = +(process.env.PORT || 3000);
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const BASE = () => process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg, code = 400) => { throw new HttpError(code, msg); };

async function readJson(req, limit = 30e6) {
  let n = 0; const chunks = [];
  for await (const c of req) { if ((n += c.length) > limit) bad('Payload too large', 413); chunks.push(c); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; } catch { return bad('Invalid JSON'); }
}
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const letterUrl = id => `${BASE()}/letter/${id}?k=${Patients.token(id)}`;
const intOrNull = v => (v === '' || v == null || isNaN(+v)) ? null : Math.trunc(+v);

/* ---------- routes ---------- */
const routes = [];
const route = (method, path, fn) => routes.push({ method, re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

route('GET', '/api/health', async () => ({ ok: true, model: process.env.MODEL_MODE || 'mock' }));

/* Doctors */
route('GET', '/api/doctors', async () => Doctors.all());
route('POST', '/api/doctors', async ({ body }) => {
  const d = Object.fromEntries(['name', 'spec', 'hosp', 'dist', 'email', 'phone'].map(k => [k, String(body[k] ?? '').trim()]));
  if (!d.name || !d.hosp || !d.dist) bad('Name, hospital and district are required.');
  if (!['Retina Specialist', 'Ophthalmologist'].includes(d.spec)) bad('Invalid specialty.');
  if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) bad('Enter a valid email address.');
  return Doctors.add(d);
});
route('DELETE', '/api/doctors/:id', async ({ params }) => ({ deleted: Doctors.remove(+params.id) }));

/* Slot suggestions (falls back to other districts if none locally) */
route('GET', '/api/matches', async ({ query }) => {
  const { action, district } = query;
  if (!['urgent', 'refer'].includes(action)) return { slots: [], fallback: false };
  let slots = Slots.match(action, district, false), fallback = false;
  if (!slots.length) { slots = Slots.match(action, district, true); fallback = slots.length > 0; }
  return { slots, fallback };
});

/* Screening: images in -> model -> clinical decision out. Nothing is stored yet. */
route('POST', '/api/screen', async ({ body }) => {
  const eyes = {};
  for (const k of ['right', 'left']) {
    const im = body[k]; if (!im?.data) continue;
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(im.data);
    if (!m) bad(`${k} eye: unsupported image (use JPG, PNG or WebP)`);
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 12e6) bad(`${k} eye: image larger than 12 MB`, 413);
    try {
      const r = await predict(buf, String(im.name || `${k}.jpg`));
      eyes[k] = { grade: r.grade, conf: r.confidence, heatmap: r.heatmap || null, seed: r.seed ?? buf.length };
    } catch (e) { console.error('[model]', e.message); bad(`Model unavailable for ${k} eye: ${e.message}`, 502); }
  }
  if (!Object.keys(eyes).length) bad('Upload at least one eye image.');
  return { eyes, ...decide(eyes) };
});

/* Confirm: store record, book slot (atomic), notify patient. Decision is recomputed from the stored grades, never trusted from the client. */
route('POST', '/api/patients', async ({ body }) => {
  const name = String(body.name ?? '').trim();
  if (!name) bad('Patient name is required.');
  const eyes = {};
  for (const k of ['right', 'left']) {
    const e = body.eyes?.[k]; if (!e) continue;
    if (!Number.isInteger(e.grade) || e.grade < 0 || e.grade > 4 || !(e.conf >= 0 && e.conf <= 1)) bad(`Invalid ${k} eye result.`);
    eyes[k] = { grade: e.grade, conf: e.conf, heat: typeof e.heat === 'string' && e.heat.startsWith('data:image/') ? e.heat.slice(0, 2e6) : null };
  }
  if (!Object.keys(eyes).length) bad('No screening results supplied.');
  const d = decide(eyes);

  let slot = null;
  if (body.slot_id != null) {
    if (d.action === 'rescreen') bad('No appointment needed for this result.');
    slot = Slots.get(+body.slot_id) || bad('Slot not found.', 404);
    if (!Slots.claim(slot.id)) bad('That slot was just taken. Please choose another.', 409);
  }
  const p = Patients.add({
    name, age: intOrNull(body.age), phone: String(body.phone ?? '').trim(), dist: String(body.dist ?? '').trim(),
    dur: intOrNull(body.dur), consent: !!body.consent, eyes, ...d,
    doctor_id: slot?.doctor_id ?? null, slot_id: slot?.id ?? null,
    status: d.action === 'rescreen' ? 'completed' : (slot ? 'referred' : 'pending'),
    token: randomBytes(16).toString('hex')
  });
  const r = await sendWhatsApp(p, letterUrl(p.id));
  Patients.setMsg(p.id, r.status, r.error);
  return { ...Patients.get(p.id), msg_error: r.error || '' };
});

route('GET', '/api/patients', async () => Patients.all());
route('PATCH', '/api/patients/:id/status', async ({ params, body }) => {
  if (!['pending', 'referred', 'completed', 'missed'].includes(body.status)) bad('Invalid status.');
  if (!Patients.setStatus(+params.id, body.status)) bad('Not found', 404);
  return { ok: true };
});
route('POST', '/api/patients/:id/whatsapp', async ({ params }) => {
  const p = Patients.get(+params.id) || bad('Not found', 404);
  const r = await sendWhatsApp(p, letterUrl(p.id));
  Patients.setMsg(p.id, r.status, r.error);
  return r;
});
route('POST', '/api/patients/:id/email-doctor', async ({ params }) => {
  const p = Patients.get(+params.id) || bad('Not found', 404);
  const r = await emailDoctor(p, letterUrl(p.id));
  if (!r.ok) bad(r.error, 422);
  return r;
});

/* Referral letter: printable page opened via the unguessable link sent by WhatsApp/email. */
function letterHtml(p) {
  const blk = k => p.eyes[k]?.heat ? `<div style="flex:1;min-width:150px"><img src="${p.eyes[k].heat}" alt="${k} heatmap" style="width:100%;border-radius:8px"><div class="m">${k[0].toUpperCase() + k.slice(1)} eye: ${GRADES[p.eyes[k].grade]}</div></div>` : '';
  const eye = k => p.eyes[k] ? `<b>${GRADES[p.eyes[k].grade]}</b> (${Math.round(p.eyes[k].conf * 100)}%)` : 'Not screened';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Referral #${p.id} – ${esc(p.name)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111}h1{font-size:22px;margin:0 0 4px}
.m{font-size:12px;color:#555}table{width:100%;border-collapse:collapse;margin-top:12px}td{padding:7px 4px;border-bottom:1px solid #ddd;vertical-align:top}td:first-child{color:#555;width:38%}
button{margin-top:16px;padding:10px 16px;border:0;border-radius:8px;background:#0f766e;color:#fff;font:inherit;font-weight:600;cursor:pointer}@media print{button{display:none}}</style>
<h1>Referral Letter</h1><div class="m">RetinaX screening · ${new Date(p.date).toLocaleDateString('en-IN')} · Ref #${p.id}</div>
<table><tr><td>Patient</td><td><b>${esc(p.name)}</b>, age ${esc(p.age ?? '–')}, ${esc(p.dist || '–')}</td></tr>
<tr><td>Diabetes duration</td><td>${esc(p.dur ?? '–')} years</td></tr>
<tr><td>Right eye</td><td>${eye('right')}</td></tr><tr><td>Left eye</td><td>${eye('left')}</td></tr>
<tr><td>Recommended action</td><td>${esc(p.actText)}</td></tr>
${p.doc ? `<tr><td>Referred to</td><td>${esc(p.doc.name)}, ${esc(p.doc.spec)}, ${esc(p.doc.hosp)}</td></tr><tr><td>Appointment</td><td><b>${fmt(p.t)}</b></td></tr>` : ''}</table>
<div style="display:flex;gap:10px;margin-top:14px">${blk('right')}${blk('left')}</div>
<p class="m">AI-assisted screening result. Not a diagnosis; requires clinical confirmation.</p>
<button onclick="print()">Print / Save as PDF</button></html>`;
}
route('GET', '/letter/:id', async ({ params, query }) => {
  const t = Patients.token(+params.id);
  if (!t || query.k !== t) bad('Not found', 404);
  return { __html: letterHtml(Patients.get(+params.id)) };
});

/* ---------- server ---------- */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    for (const r of routes) {
      const m = r.method === req.method && r.re.exec(url.pathname);
      if (!m) continue;
      const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      const out = await r.fn({ params: m.groups || {}, query: Object.fromEntries(url.searchParams), body });
      return out?.__html ? send(res, 200, out.__html, 'text/html; charset=utf-8') : send(res, 200, out);
    }
    if (url.pathname.startsWith('/api/')) bad('Not found', 404);
    // static frontend
    const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) bad('Forbidden', 403);
    try { send(res, 200, await readFile(file), MIME[extname(file)] || 'application/octet-stream'); } catch { bad('Not found', 404); }
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    const code = e.code || 500;
    send(res, code, code === 404 && !url.pathname.startsWith('/api/') ? 'Not found' : { error: code === 500 ? 'Server error' : e.message },
      code === 404 && !url.pathname.startsWith('/api/') ? 'text/plain' : 'application/json');
  }
}).listen(PORT, () => console.log(`RetinaX running on ${BASE()}  (model: ${process.env.MODEL_MODE || 'mock'})`));
