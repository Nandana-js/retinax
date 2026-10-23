import { GRADES } from './clinical.js';

const cap = s => s[0].toUpperCase() + s.slice(1);
const pct = v => Math.round(v * 100) + '%';
export const fmt = t => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
export const eyeLine = (p, k) => p.eyes[k] ? `${cap(k)} eye: ${GRADES[p.eyes[k].grade]} (confidence ${pct(p.eyes[k].conf)})` : `${cap(k)} eye: not screened`;

export function waText(p, letterUrl) {
  if (!p.doc) return `Hello ${p.name}, your eye screening is complete.\n${eyeLine(p, 'right')}\n${eyeLine(p, 'left')}\nPlease rescreen in ${p.grade ? '6–12' : '12'} months. We will remind you.`;
  return `Hello ${p.name}, your eye screening result:\n${eyeLine(p, 'right')}\n${eyeLine(p, 'left')}\nAppointment: ${p.doc.name}, ${p.doc.hosp}, ${fmt(p.t)}.\nReferral letter: ${letterUrl}`;
}

/** Returns {status:'sent'|'failed', error?}. Simulated (logged, marked sent) when WA_TOKEN is not configured. */
export async function sendWhatsApp(p, letterUrl) {
  if (!p.consent) return { status: 'failed', error: 'no consent' };
  const to = (p.phone || '').replace(/[\s-]/g, '');
  if (!/^\+\d{10,14}$/.test(to)) return { status: 'failed', error: 'invalid number (use +91…)' };
  const { WA_PHONE_ID, WA_TOKEN, WA_TEMPLATE, WA_LANG } = process.env;
  const text = waText(p, letterUrl);
  if (!WA_PHONE_ID || !WA_TOKEN) { console.log(`[whatsapp:simulated] -> ${to}\n${text}\n`); return { status: 'sent' }; }
  // Business-initiated messages need an approved template; free text only works inside a 24h patient-initiated window.
  const body = WA_TEMPLATE
    ? { messaging_product: 'whatsapp', to: to.slice(1), type: 'template',
        template: { name: WA_TEMPLATE, language: { code: WA_LANG || 'en' },
          components: [{ type: 'body', parameters: [p.name, text.split('\n').slice(1, -1).join(' | '), letterUrl].map(t => ({ type: 'text', text: t })) }] } }
    : { messaging_product: 'whatsapp', to: to.slice(1), type: 'text', text: { body: text } };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return { status: 'failed', error: `WhatsApp API ${r.status}` };
    return { status: 'sent' };
  } catch (e) { return { status: 'failed', error: e.message }; }
}

export async function emailDoctor(p, letterUrl) {
  if (!p.doc?.email) return { ok: false, error: 'No doctor email on file' };
  if (!process.env.SMTP_HOST) return { ok: false, error: 'Email is not configured on the server (set SMTP_* in .env)' };
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; } catch { return { ok: false, error: 'Run: npm i nodemailer' }; }
  const tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  const text = `Dear ${p.doc.name},\n\nReferral from RetinaX screening (Ref #${p.id}, ${new Date(p.date).toLocaleDateString('en-IN')}).\n\n` +
    `Patient: ${p.name}, age ${p.age || '-'}, ${p.dist || '-'}\nDiabetes duration: ${p.dur ?? '-'} years\nContact: ${p.phone || '-'}\n\n` +
    `${eyeLine(p, 'right')}\n${eyeLine(p, 'left')}\nRecommended action: ${p.actText}\nAppointment: ${fmt(p.t)}\n\n` +
    `Full referral letter with heatmaps: ${letterUrl}\n\nAI-assisted screening result, not a diagnosis.\n\nRegards,\nRetinaX`;
  try {
    await tx.sendMail({ from: process.env.MAIL_FROM, to: p.doc.email, subject: `Referral: ${p.name} (${GRADES[p.grade]} DR)`, text });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
