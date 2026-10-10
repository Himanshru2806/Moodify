# Moodify

Moodify is a web application for expression-aware, user-guided music recommendations.

This repository contains the working first version:

- FastAPI backend with versioned routes.
- React/Vite frontend with a recommendation UI.
- Camera capture and upload flow for expression prediction and automatic playlist recommendations.
- Metadata-based recommendation baseline using a playable demo catalogue.

## Project Structure

```text
backend/   FastAPI API, schemas, services, and tests
frontend/  React + TypeScript + Vite application
docs/      Project notes and planning documents
ml/        Future ML training and evaluation code
data/      Future catalogue data and local-only datasets
```

## Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m app.services.model_download
uvicorn app.main:app --reload
```

The first model download is about 343 MB and is cached under `backend/models/` (ignored by Git). It fetches revision
`ef0bc6fc34241b6587e7e009e7711357be28c024` of the [trpakov/vit-face-expression checkpoint](https://huggingface.co/trpakov/vit-face-expression);
its model card declares the Apache-2.0 license and reports 71.16% test accuracy on FER-2013. That is the publisher's
benchmark result, not a Moodify evaluation or a guarantee on webcam photos. The model runs locally on CPU after setup.
The backend uses OpenCV's frontal-face detector and the model's published image processor; photos are discarded after
each request.

The classifier estimates visible facial-expression labels only; it does not infer a person's internal emotional
state. The confidence cutoff defaults to 0.4 and is a configurable prototype heuristic, not a calibrated threshold.
For a custom model directory or cutoff, set `MOODIFY_MODEL_DIR` or `MOODIFY_MODEL_MIN_CONFIDENCE` in the backend
environment. If the download is skipped, prediction returns HTTP 503 with setup guidance. A photo with no detectable
frontal face returns HTTP 422.

Backend URL: `http://localhost:8000`

API docs: `http://localhost:8000/docs`

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend URL: `http://localhost:5173`

## Current API

- `GET /api/v1/health`
- `POST /api/v1/expressions/predict`
- `POST /api/v1/recommendations`
- `GET /api/v1/tracks`

## Next Milestones

1. Replace the demo catalogue with a documented, licensed catalogue source.
2. Evaluate and calibrate the expression confidence policy on held-out data.
3. Add persistence for preferences, feedback, and optional history.
4. Improve ranking using interaction feedback and catalogue metadata.

## Privacy Rule

Original face images must not be stored by default. Any future history feature should require explicit user control and deletion support.
