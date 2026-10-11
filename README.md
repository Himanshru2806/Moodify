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

Start the local PostgreSQL database and Mailpit email catcher in a separate terminal:

```bash
docker compose up -d db mailpit
```

Mailpit captures local account verification and password recovery messages at `http://localhost:8025`.

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
python -m app.services.model_download
uvicorn app.main:app --reload
```

The local defaults configure PostgreSQL at `localhost:5432`, Mailpit SMTP at `localhost:1025`, and the frontend at
`http://localhost:5173`. Configure `MOODIFY_DATABASE_URL`, `MOODIFY_ENVIRONMENT`, `MOODIFY_JWT_SECRET`, `MOODIFY_CORS_ORIGINS`, `MOODIFY_FRONTEND_URL`,
`MOODIFY_COOKIE_SECURE`, `MOODIFY_SMTP_HOST`, `MOODIFY_SMTP_PORT`, `MOODIFY_SMTP_USERNAME`,
`MOODIFY_SMTP_PASSWORD`, `MOODIFY_SMTP_FROM_EMAIL`, and `MOODIFY_SMTP_STARTTLS` for other environments. Replace
the development JWT secret, use HTTPS with secure cookies, protect database and SMTP credentials, and provide a
production SMTP service before deployment. Set `MOODIFY_ENVIRONMENT=production` with a unique `MOODIFY_JWT_SECRET`;
the API refuses to start in production with the development fallback secret or non-secure cookies. Set CORS origins to
the exact deployed frontend origin. Public deployments should apply rate limits to account and email endpoints.

### Product-owner and admin access

Moodify has `user`, `admin`, and `super_user` roles. Register and verify the intended owner account through the normal
account flow first. Then set `MOODIFY_INITIAL_SUPERUSER_EMAIL` to that verified email in the backend environment and
restart the API. Startup promotes that existing account to `super_user`; it does not create an account or set a
password. Remove the setting after confirming access—the role remains stored in PostgreSQL. Startup fails clearly if
the configured account is missing or unverified. There are no default admin credentials.

Sign in with that account and use the **Admin** navigation link. Admins can search accounts, suspend/restore ordinary
users, permanently delete ordinary accounts and view aggregate metrics. Super users can additionally assign roles,
manage the recommendation catalogue, review audit events and change bounded recommendation scoring weights. Deletion
also removes that account's personal songs and authentication sessions. The status panel reports only API/database
health, environment and version; database, SMTP and signing secrets remain deployment-managed and are never exposed
or editable in the admin UI. Configure HTTPS, protect the owner account and secrets, and apply deployment-level rate
limits before public production use.

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

Personal mood playlists require a verified Moodify email/password account and are stored per user in PostgreSQL so
they can sync across devices. Use **Create playlist** to save title+artist entries by mood, review YouTube search
matches, and create a private YouTube playlist containing the confirmed videos. Link a Google account from Create
Playlist when prompted. The user-managed song list and the external YouTube playlist are separate records; each explicit
creation makes a new playlist, and created playlist links remain visible in Moodify. Existing title-only songs need an
artist and a newly confirmed video match before playlist creation. YouTube OAuth refresh tokens are encrypted in the
backend database and never sent to the frontend.

To enable the YouTube integration, configure backend-only `MOODIFY_YOUTUBE_CLIENT_ID`,
`MOODIFY_YOUTUBE_CLIENT_SECRET`, `MOODIFY_YOUTUBE_REDIRECT_URI`, `MOODIFY_YOUTUBE_API_KEY`, and
`MOODIFY_YOUTUBE_TOKEN_ENCRYPTION_KEY` values in the backend environment. Enable YouTube Data API v3 in Google Cloud,
configure the OAuth consent screen and exact redirect URI (for local development, the example callback is
`http://localhost:8000/api/v1/youtube/oauth/callback`), and add test accounts while the consent screen is in testing.
Generate the encryption key using the command in `.env.example`; protect it like a database credential and retain it
across restarts. Search and playlist writes consume Google API quota, and public rollout may require OAuth app
verification. The match is user-confirmed because YouTube search can return covers, live versions, or incorrect tracks.
See [docs/api.md](docs/api.md) for API details and security behavior.

Account verification links expire after 24 hours, password-reset links after 30 minutes, and passwords require at least
12 characters. Local links can be inspected through Mailpit; production requires a real SMTP configuration. Account
deletion and self-service email changes are not yet available; contact the service operator for account/data removal.

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
- `POST /api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/verify`, `/forgot-password`, `/reset-password`
- `GET|POST /api/v1/personal-playlists/songs` (Bearer access token; optional `?mood=` filter)
- `PUT /api/v1/personal-playlists/songs/{song_id}` (Bearer access token)
- `DELETE /api/v1/personal-playlists/songs/{song_id}` (Bearer access token)
- `POST /api/v1/youtube/oauth/start`, `GET /api/v1/youtube/oauth/callback`, `GET|DELETE /api/v1/youtube/connection`
- `GET /api/v1/youtube/songs/{song_id}/matches`, `PUT /api/v1/youtube/songs/{song_id}/match`
- `GET|POST /api/v1/youtube/playlists`, `POST /api/v1/youtube/playlists/{playlist_id}/retry` (Bearer access token)

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
