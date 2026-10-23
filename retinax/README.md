# RetinaX backend

Zero-dependency Node (>=22.9) + SQLite (built in). Serves the frontend from `public/` and the API under `/api`.

    cp .env.example .env
    npm start            # http://localhost:3000

## Plugging in the AI model (the only change needed)
Edit `src/model.js`:
1. Set `MODEL_MODE=http` and `MODEL_URL=...` in `.env`.
2. In `http()`, map the model team's JSON to `{ grade: 0-4, confidence: 0-1, heatmap?: "data:image/png;base64,..." }`.
   If the model is a Python function instead of a service, wrap it in a small FastAPI `/predict` endpoint.
Everything else (clinical rules, booking, WhatsApp, letters) stays as is.
Ask the model team for: input size/preprocessing, class order (must be No DR→Proliferative), whether confidence is calibrated, and a Grad-CAM output.

## API
| Method | Path | Purpose |
|---|---|---|
| POST | /api/screen | `{right?:{name,data},left?:{...}}` (data-URL images) → grades, action, low-confidence flag |
| GET | /api/matches?action=&district= | Open slots inside the clinical window (falls back to other districts) |
| POST | /api/patients | Save record, book `slot_id` atomically, send WhatsApp |
| GET | /api/patients | Tracker list |
| PATCH | /api/patients/:id/status | pending / referred / completed / missed |
| POST | /api/patients/:id/whatsapp | Resend |
| POST | /api/patients/:id/email-doctor | Email via SMTP (needs `npm i nodemailer`) |
| GET/POST/DELETE | /api/doctors | Manage doctors |
| GET | /letter/:id?k=token | Printable referral letter (link sent in WhatsApp/email) |

## Before real patients
- **Auth**: there is none yet. Add login + roles (health worker / doctor / admin) first. This is patient health data.
- **WhatsApp**: set `WA_*`. Messaging patients first needs a Meta-approved template (`WA_TEMPLATE`). Unset = simulated (logged only).
- **Slots**: generated for demo. Replace with the hospitals' real calendars.
- **Clinical rules** (`src/clinical.js`): get a clinician to sign off the grade→action mapping and the 0.7 confidence threshold.
- **Privacy**: retinal images are not stored, only grades and heatmap thumbnails. Check India's DPDP Act consent/retention requirements, host in India, and use HTTPS.
- **Reminders / missed appointments**: not built yet (needs a scheduled job).
