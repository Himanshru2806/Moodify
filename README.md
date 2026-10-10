# Moodify

Moodify is a web application for expression-aware, user-guided music recommendations.

This repository contains the working first version:

- FastAPI backend with versioned routes.
- React/Vite frontend with a recommendation UI.
- Camera capture and upload flow for expression prediction and automatic playlist recommendations.
- Separate listening goal and visible-expression estimate; user corrections immediately rerank recommendations.
- Metadata-based recommendation baseline with YouTube Music search links for each recommendation.

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
The backend uses OpenCV's frontal-face detector and the model's published image processor. The backend does not retain
prediction images. The browser keeps the current photo in memory only until the page is closed or another image is
selected, unless the user separately opts into local storage for that photo.

The classifier estimates visible facial-expression labels only; it does not infer a person's internal emotional
state. The confidence cutoff defaults to 0.4 and is a configurable prototype heuristic, not a calibrated threshold.
For a custom model directory or cutoff, set `MOODIFY_MODEL_DIR` or `MOODIFY_MODEL_MIN_CONFIDENCE` in the backend
environment. If the download is skipped, prediction returns HTTP 503 with setup guidance. A photo with no detectable
frontal face returns HTTP 422.

Backend URL: `http://localhost:8000`

The listening goal is the primary recommendation input. A corrected expression can contribute a small, explicit
catalogue-context bonus, but those demo associations are subjective heuristics, not evidence of internal mood or music
preference. Recommended titles currently come from a small demo catalogue; the YouTube Music button opens a search for
that title and artist rather than asserting an exact, verified recording or embedding playback. By default, images are
not retained. After correcting/selecting an expression, users may separately opt to save that photo and label to this
browser profile's IndexedDB personal set. It is not uploaded for training, not shared with other profiles, and not yet
used to train a personal model. Browser storage is not encrypted and is not account-isolated; do not use this option in
a shared browser profile. Individual/all saved photos can be deleted in the UI. Live camera analysis is not yet
implemented.

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

Face images are not retained by the backend. Browser-side retention is off by default and requires separate consent for
each image; users can delete local entries individually or all at once. The local dataset is not encrypted or
account-isolated and is not used for training yet. Any future account/server storage or personal-model training needs
separate security, consent, deletion, and evaluation work; user contributions must never enter shared-model training.
