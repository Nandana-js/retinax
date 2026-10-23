from pathlib import Path
from io import BytesIO
import base64
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models, transforms
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

BASE = Path(__file__).resolve().parent
MODEL_PATH = BASE / 'models' / 'resnet18_dr.pth'
CLASSES = ['No DR (Grade 0)', 'Mild DR (Grade 1)', 'Moderate DR (Grade 2)', 'Severe DR (Grade 3)', 'Proliferative DR (Grade 4)']
PREPROCESS = transforms.Compose([
    transforms.Resize((224, 224)), transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])
app = FastAPI(title='RetinaCare ResNet-18 API')
_model = None

def load_model():
    global _model
    if _model is not None:
        return _model
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f'Model not found: {MODEL_PATH}. Copy your trained resnet18_dr.pth into the models folder.')
    model = models.resnet18(weights=None)
    model.fc = nn.Linear(model.fc.in_features, 5)
    try:
        state = torch.load(MODEL_PATH, map_location='cpu', weights_only=True)
    except TypeError:
        state = torch.load(MODEL_PATH, map_location='cpu')
    if isinstance(state, dict) and 'state_dict' in state:
        state = state['state_dict']
    if isinstance(state, dict) and state and all(k.startswith('module.') for k in state):
        state = {k.replace('module.', '', 1): v for k, v in state.items()}
    model.load_state_dict(state)
    model.eval()
    _model = model
    return _model

def gradcam_overlay(model, tensor, original, class_idx):
    activations, gradients = [], []
    layer = model.layer4[-1].conv2
    h1 = layer.register_forward_hook(lambda _m, _i, out: activations.append(out))
    h2 = layer.register_full_backward_hook(lambda _m, _gi, go: gradients.append(go[0]))
    try:
        model.zero_grad(set_to_none=True)
        logits = model(tensor)
        logits[0, class_idx].backward()
        acts, grads = activations[0], gradients[0]
        weights = grads.mean(dim=(2, 3), keepdim=True)
        cam = torch.relu((weights * acts).sum(dim=1, keepdim=True))
        cam = F.interpolate(cam, size=(224, 224), mode='bilinear', align_corners=False)[0, 0]
        cam = cam - cam.min()
        cam = cam / cam.max().clamp(min=1e-8)
        heat = cam.detach().cpu().numpy()
        base = np.asarray(original.resize((224, 224)).convert('RGB')).astype(np.float32) / 255.0
        red = np.clip(1.5 - np.abs(4 * heat - 3), 0, 1)
        green = np.clip(1.5 - np.abs(4 * heat - 2), 0, 1)
        blue = np.clip(1.5 - np.abs(4 * heat - 1), 0, 1)
        color = np.stack([red, green, blue], axis=-1)
        alpha = heat[..., None] * 0.48
        overlay = np.clip(base * (1 - alpha) + color * alpha, 0, 1)
        buf = BytesIO()
        Image.fromarray((overlay * 255).astype(np.uint8)).save(buf, format='PNG')
        return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
    finally:
        h1.remove(); h2.remove()

@app.get('/')
def home():
    return FileResponse(BASE / 'static' / 'index.html')

@app.get('/health')
def health():
    return {'status': 'ok', 'model_file_present': MODEL_PATH.exists()}

@app.post('/api/predict')
async def predict(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='Please upload an image file.')
    try:
        raw = await file.read()
        image = Image.open(BytesIO(raw)).convert('RGB')
    except Exception:
        raise HTTPException(status_code=400, detail='Could not read this image. Try JPG or PNG.')
    try:
        model = load_model()
        tensor = PREPROCESS(image).unsqueeze(0)
        with torch.no_grad():
            logits = model(tensor)
            probs = torch.softmax(logits, dim=1)[0]
            grade = int(torch.argmax(probs).item())
            confidence = float(probs[grade].item())
        overlay = gradcam_overlay(model, tensor, image, grade)
        return {
            'grade': grade, 'class_name': CLASSES[grade], 'confidence': round(confidence, 4),
            'probabilities': [{'grade': i, 'label': CLASSES[i], 'probability': round(float(p), 6)} for i, p in enumerate(probs.tolist())],
            'gradcam': overlay, 'model': 'ResNet-18'
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Prediction failed: {type(e).__name__}: {e}')
