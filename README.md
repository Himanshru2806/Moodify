# Moodify

Moodify is a final-year project web application for facial-expression recognition and user-guided music recommendations.

This repository currently contains the first working foundation:

- FastAPI backend with versioned routes.
- React/Vite frontend with a recommendation UI.
- Placeholder expression endpoint that validates images but clearly reports `model_not_configured`.
- Simple metadata-based recommendation baseline using a demo catalogue.

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
uvicorn app.main:app --reload
```

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

1. Add camera capture and upload-to-prediction flow in the frontend.
2. Add real face detection and preprocessing in the backend.
3. Create the FER-2013 audit and training pipeline under `ml/`.
4. Replace the demo catalogue with a documented, licensed catalogue source.
5. Add persistence for preferences, feedback, and optional history.

## Privacy Rule

Original face images must not be stored by default. Any future history feature should require explicit user control and deletion support.
