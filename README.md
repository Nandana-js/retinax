# RetinaX — AI-Powered Diabetic Retinopathy Screening

RetinaX is an AI-assisted diabetic retinopathy screening prototype that combines a web application with a deep learning model based on **ResNet-18** and **Grad-CAM** visualization.

The project aims to demonstrate how retinal fundus images can be analyzed by a trained deep learning model, with visual explanations to help users explore which image regions influenced a prediction.

> **Disclaimer:** RetinaX is an educational and research prototype. It is not a clinically validated medical device and must not be used to diagnose disease or make treatment decisions.

## Features

- **AI-based image classification:** Uses a trained ResNet-18 model to classify retinal images into five diabetic retinopathy severity categories.
- **Grad-CAM visualization:** Generates a heatmap highlighting image regions that contribute to the model's prediction.
- **Web interface:** Provides a browser-based interface for interacting with the application.
- **Patient tracking:** Includes patient-management functionality in the RetinaX web application.
- **Appointment management:** Includes appointment-related features.
- **API integration:** Connects the web application to a Python-based FastAPI inference service.

Feature availability depends on the current application configuration. Patient and appointment information should be treated as demonstration data unless secure, production-ready storage and access controls have been implemented.

## How It Works

1. A user uploads a retinal fundus image through the web interface.
2. The RetinaX application sends the image to the Python inference API.
3. The API preprocesses the image and passes it to the trained ResNet-18 model.
4. The model predicts one of five diabetic retinopathy severity classes.
5. Grad-CAM generates a heatmap showing regions associated with the model's output.
6. The application receives the prediction and visualization data and displays the available results.

### Model classes

The five output classes follow the standard APTOS diabetic retinopathy grading scheme:

| Class | Meaning |
|---|---|
| 0 | No Diabetic Retinopathy |
| 1 | Mild Diabetic Retinopathy |
| 2 | Moderate Diabetic Retinopathy |
| 3 | Severe Diabetic Retinopathy |
| 4 | Proliferative Diabetic Retinopathy |

The model's predictions depend on its training data, preprocessing, and learned parameters. These labels do not guarantee a medically correct assessment.

## Technology Stack

| Component | Technology |
|---|---|
| Deep learning | PyTorch |
| Model architecture | ResNet-18 |
| Model visualization | Grad-CAM |
| Inference API | Python, FastAPI |
| API server | Uvicorn |
| Web application | Node.js |
| Frontend | HTML, CSS, JavaScript |
| Dataset | APTOS 2019, if used for the current training run |

## Project Structure

```text
retinax/
├── .gitignore
├── README.md
├── README_INTEGRATION.md
│
├── ai_model/
│   ├── api.py
│   ├── requirements.txt
│   └── models/
│       └── resnet18_dr.pth
│
└── retinax/
    ├── package.json
    ├── package-lock.json
    ├── .env.example
    ├── README.md
    ├── public/
    │   ├── index.html
    │   ├── app.js
    │   └── style.css
    └── src/
        ├── server.js
        ├── model.js
        ├── clinical.js
        ├── db.js
        └── notify.js
```

**Note:** The trained checkpoint is not included in this repository. The model file shown above is expected to be supplied separately.

## Prerequisites

Install the following software before running the project:

- Python 3.10 or a compatible version supported by the installed dependencies
- Node.js 22.9 or newer
- npm
- Git

You will also need the compatible trained ResNet-18 checkpoint named `resnet18_dr.pth`.

## Installation and Setup

### 1. Clone the repository

```bash
git clone https://github.com/Nandana-js/retinax.git
cd retinax
```

### 2. Configure the AI model

Place your trained model checkpoint at:

```text
ai_model/models/resnet18_dr.pth
```

The checkpoint must match the architecture and output layer expected by `ai_model/api.py`.

Open a terminal in the repository root and run:

```bash
cd ai_model
python -m venv .venv
```

Activate the virtual environment on Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install the Python dependencies:

```bash
python -m pip install -r requirements.txt
```

Start the inference API:

```bash
uvicorn api:app --host 127.0.0.1 --port 8000
```

The API should now be available at:

- Health check: `http://127.0.0.1:8000/health`
- Interactive API documentation: `http://127.0.0.1:8000/docs`

Keep this terminal running.

### 3. Configure the RetinaX web application

Open a second terminal and navigate to the web application directory:

```bash
cd retinax
```

Create a local environment file from the example.

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Ensure the local `.env` file contains the following configuration, adjusting it if the application expects a different variable name:

```dotenv
MODEL_MODE=http
MODEL_URL=http://127.0.0.1:8000/api/predict
```

Install the Node.js dependencies:

```bash
npm install
```

Start the web application:

```bash
npm start
```

Open the local URL printed by the application in your terminal. The default web address is expected to be:

`http://localhost:3000`

Both the Python API and Node.js application must be running for end-to-end inference.

## API Overview

The FastAPI service provides the following endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Checks the API service |
| POST | `/api/predict` | Accepts an image and returns model inference results, including Grad-CAM data where supported |

For request formats and response schemas, start the API and inspect its interactive documentation at `http://127.0.0.1:8000/docs`.

## Grad-CAM Explainability

Grad-CAM, short for Gradient-weighted Class Activation Mapping, uses gradients flowing into a convolutional layer to estimate which spatial regions are important for a selected model output.

In RetinaX, the resulting activation map is converted into a heatmap that can be displayed alongside the input image.

A heatmap is an explanation of model behavior—not proof that the prediction is correct. It can highlight irrelevant image artifacts or misleading patterns, and it should not be interpreted as a medical diagnosis.

## Model and Dataset

The project uses a ResNet-18 convolutional neural network configured for five output classes.

If the APTOS 2019 dataset was used for the training run, it provides retinal fundus images with diabetic retinopathy severity labels. Follow the dataset's applicable terms and conditions when downloading, using, or redistributing it.

Model performance depends on dataset quality, class balance, preprocessing, training methodology, and evaluation. Report validation and test metrics only when they have been measured on the corresponding datasets. Performance on one dataset does not establish clinical reliability on other populations or imaging devices.

## Troubleshooting

**The model checkpoint cannot be loaded**

- Confirm that `resnet18_dr.pth` exists in `ai_model/models/`.
- Verify that the checkpoint matches the model architecture and output dimensions.
- Check the checkpoint-loading logic in `ai_model/api.py`.

**The website cannot connect to the model API**

- Confirm that the FastAPI service is running on port 8000.
- Check `MODEL_MODE` and `MODEL_URL` in `retinax/.env`.
- Open `http://127.0.0.1:8000/health` to check API availability.

**The Grad-CAM heatmap does not appear**

- Check the API response and browser developer console.
- Confirm that the API returns the expected visualization field and that `retinax/src/model.js` maps it to the field expected by the frontend.
- Verify that the selected Grad-CAM layer exists in the loaded model.

**Node.js or npm is not recognized**

Install Node.js, restart your terminal, and check:

```bash
node --version
npm --version
```

## Safety, Privacy, and Limitations

- This project is intended for education, experimentation, and research.
- Model predictions and heatmaps are not a substitute for assessment by a qualified eye-care professional.
- Do not upload real patient information, credentials, API secrets, or private database files to a public repository.
- Before deployment, implement appropriate authentication, authorization, secure storage, input validation, logging controls, and privacy protections.
- Validate the model independently before considering any real-world medical application.

## Contributors

Developed collaboratively as an AI and web application project.

Contributors can use the repository's Git history to identify individual code contributions.

## License

A license has not yet been specified. Before redistributing the project, choose an appropriate license and verify the licensing terms of all datasets, dependencies, and third-party components.
