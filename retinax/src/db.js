import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync(process.env.DB_FILE || './retinax.db');
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS doctors(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, spec TEXT NOT NULL, hosp TEXT NOT NULL,
  dist TEXT NOT NULL, email TEXT DEFAULT '', phone TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS slots(
  id INTEGER PRIMARY KEY, doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  t INTEGER NOT NULL, booked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS slots_t ON slots(t, booked);
CREATE TABLE IF NOT EXISTS patients(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, phone TEXT DEFAULT '', dist TEXT DEFAULT '',
  dur INTEGER, consent INTEGER NOT NULL DEFAULT 0,
  eyes TEXT NOT NULL, grade INTEGER NOT NULL, action TEXT NOT NULL, act_text TEXT NOT NULL,
  date INTEGER NOT NULL, doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL, slot_id INTEGER,
  status TEXT NOT NULL, msg TEXT NOT NULL DEFAULT 'failed', msg_error TEXT DEFAULT '',
  letter_token TEXT NOT NULL);
`);

const rows = (sql, ...a) => db.prepare(sql).all(...a);
const row = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

export const Doctors = {
  all: () => rows(`SELECT d.*, (SELECT COUNT(*) FROM slots s WHERE s.doctor_id=d.id AND s.booked=0 AND s.t>?) AS free
                   FROM doctors d ORDER BY d.dist, d.name`, Date.now()),
  get: id => row('SELECT * FROM doctors WHERE id=?', id),
  add(d) {
    const { lastInsertRowid: id } = run('INSERT INTO doctors(name,spec,hosp,dist,email,phone) VALUES(?,?,?,?,?,?)',
      d.name, d.spec, d.hosp, d.dist, d.email || '', d.phone || '');
    genSlots(+id); return Doctors.get(+id);
  },
  remove: id => run('DELETE FROM doctors WHERE id=?', id).changes
};

/* Demo slot generator. In production, replace with each hospital's real calendar. */
function genSlots(doctorId) {
  const ins = db.prepare('INSERT INTO slots(doctor_id,t,booked) VALUES(?,?,0)');
  for (let day = 0; day < 14; day++)
    for (const h of [10, 11, 15, 16]) {
      const t = new Date(); t.setDate(t.getDate() + day); t.setHours(h, 0, 0, 0);
      if (+t > Date.now() + 2 * 3600e3) ins.run(doctorId, +t);
    }
}

export const WINDOW = { urgent: 48 * 3600e3, refer: 14 * 864e5 };

export const Slots = {
  /** Open slots inside the clinical window, earliest first. */
  match(action, district, anyDistrict) {
    if (!WINDOW[action]) return [];
    const now = Date.now();
    return rows(`SELECT s.id, s.t, d.id AS doctor_id, d.name, d.spec, d.hosp, d.dist, d.email
      FROM slots s JOIN doctors d ON d.id=s.doctor_id
      WHERE s.booked=0 AND s.t>? AND s.t<?
        AND (?=1 OR LOWER(d.dist)=LOWER(?))
        AND (?<>'urgent' OR d.spec='Retina Specialist')
      ORDER BY s.t LIMIT 50`, now, now + WINDOW[action], anyDistrict ? 1 : 0, (district || '').trim(), action);
  },
  /** Atomic: true only for the first caller, so a slot is never double-booked. */
  claim: id => run('UPDATE slots SET booked=1 WHERE id=? AND booked=0', id).changes === 1,
  get: id => row('SELECT * FROM slots WHERE id=?', id)
};

const hydrate = p => p && ({
  ...p, consent: !!p.consent, eyes: JSON.parse(p.eyes), actText: p.act_text, letter_token: undefined,
  doc: p.doctor_id ? Doctors.get(p.doctor_id) : null,
  t: p.slot_id ? Slots.get(p.slot_id)?.t ?? null : null
});

export const Patients = {
  all: () => rows('SELECT * FROM patients ORDER BY id DESC').map(hydrate),
  get: id => hydrate(row('SELECT * FROM patients WHERE id=?', id)),
  token: id => row('SELECT letter_token FROM patients WHERE id=?', id)?.letter_token,
  add(p) {
    const { lastInsertRowid: id } = run(`INSERT INTO patients(name,age,phone,dist,dur,consent,eyes,grade,action,act_text,date,doctor_id,slot_id,status,letter_token)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, p.name, p.age, p.phone, p.dist, p.dur, p.consent ? 1 : 0, JSON.stringify(p.eyes),
      p.grade, p.action, p.actText, Date.now(), p.doctor_id, p.slot_id, p.status, p.token);
    return Patients.get(+id);
  },
  setStatus: (id, s) => run('UPDATE patients SET status=? WHERE id=?', s, id).changes,
  setMsg: (id, msg, err = '') => run('UPDATE patients SET msg=?, msg_error=? WHERE id=?', msg, err, id)
};

if (!row('SELECT 1 FROM doctors LIMIT 1')) {
  [
    ['Dr. Anitha Rao', 'Retina Specialist', 'Sankara Eye Hospital', 'Chennai', 'anitha.rao@example.com', '+91 90000 00001'],
    ['Dr. Karthik Menon', 'Ophthalmologist', 'Greenfield Eye Care', 'Chennai', 'karthik.menon@example.com', ''],
    ['Dr. Meera Nair', 'Retina Specialist', 'Amrita Eye Clinic', 'Ernakulam', 'meera.nair@example.com', ''],
    ['Dr. Suresh Pillai', 'Ophthalmologist', 'Kochi Eye Centre', 'Ernakulam', 'suresh.pillai@example.com', ''],
    ['Dr. Divya Krishnan', 'Retina Specialist', 'Madurai Eye Hospital', 'Madurai', 'divya.k@example.com', ''],
    ['Dr. Faisal Ahmed', 'Ophthalmologist', 'District Hospital', 'Kollam', 'faisal.ahmed@example.com', ''],
    ['Dr. Lakshmi Iyer', 'Retina Specialist', 'Medical College Hospital', 'Thiruvananthapuram', 'lakshmi.iyer@example.com', ''],
    ['Dr. Rahul Verma', 'Ophthalmologist', 'City Eye Clinic', 'Thiruvananthapuram', 'rahul.verma@example.com', '']
  ].forEach(([name, spec, hosp, dist, email, phone]) => Doctors.add({ name, spec, hosp, dist, email, phone }));
}
