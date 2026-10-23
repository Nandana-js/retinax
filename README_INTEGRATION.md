# RetinaX + ResNet-18 + Grad-CAM integration

This bundle keeps the RetinaX Node/SQLite website and connects its screening flow to the existing FastAPI ResNet-18 model service.

## Folder layout

- `retinax/` — UI, patient tracker, doctors/slots and Node API
- `ai_model/` — FastAPI endpoint for the ResNet-18 checkpoint
- The trained checkpoint is intentionally NOT included. Copy your own `resnet18_dr.pth` to `ai_model/models/resnet18_dr.pth`.

## Requirements

- Python and your working PyTorch/torchvision installation
- Node.js 22.9 or newer (as required by the original RetinaX README)

## 1. Put the checkpoint in place

Copy `resnet18_dr.pth` into:

`ai_model/models/resnet18_dr.pth`

It must be the trained five-class ResNet-18 checkpoint, not only pretrained ImageNet weights.

## 2. Start the model API

Open a terminal in `ai_model/` and run:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn api:app --host 127.0.0.1 --port 8000
```

Check `http://127.0.0.1:8000/health`. It reports whether the model file exists. A successful health response alone does not prove the checkpoint can load; test a prediction too.

## 3. Configure and start RetinaX

Copy `retinax/.env.example` to `retinax/.env`. The example is set to call the local model API:

```dotenv
MODEL_MODE=http
MODEL_URL=http://127.0.0.1:8000/api/predict
```

In a second terminal, enter `retinax/` and run:

```powershell
npm install
npm start
```

Open `http://localhost:3000`.

The Node app sends uploaded image bytes to FastAPI. `src/model.js` maps the FastAPI response's `grade`, `confidence`, and `gradcam` fields into RetinaX's `grade`, `confidence`, and `heatmap` contract.

## Important limitations and safety

- This is a research/demo prototype, not a clinically validated diagnostic system.
- RetinaX's original README says authentication is not implemented. Do not expose it publicly or enter real patient data until access controls, privacy, security, consent, and data retention have been reviewed.
- Appointment slots are demo data unless replaced with real authorized schedules.
- WhatsApp/email integrations may be simulated or require provider credentials and approved templates.
- The model checkpoint is excluded from this ZIP. Do not commit it to a public GitHub repository without reviewing file size and redistribution terms.
- Confirm the model's training label order and evaluate with a held-out dataset before demo claims.
