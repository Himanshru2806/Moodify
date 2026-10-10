# API Notes

Base path: `/api/v1`

## Health

`GET /health`

Returns service status.

## Expression Prediction

`POST /expressions/predict`

Multipart form field: `image`

Supported image types: JPEG, PNG, WebP. The file is decoded, the largest detected frontal face is cropped, and a local
pretrained FER-2013 classifier returns probabilities for the seven supported expression labels. Original images are
not stored.

Statuses are `prediction_available` and `uncertain`. The expression is `null` when the configured confidence cutoff is
not met. Invalid images and photos with no detected face return HTTP 422; oversized uploads return HTTP 413; a missing
local checkpoint returns HTTP 503. Install the pinned checkpoint from the backend directory with
`python -m app.services.model_download` (about 343 MB) before starting the API. The model version identifies the
upstream checkpoint revision.

The frontend automatically requests recommendations after a photo prediction, using the predicted expression when
available and the currently selected listening goal, languages, and genres. For an uncertain prediction it uses the
goal and preferences without inventing an expression. Users can still correct the expression or rerun recommendations.

## Recommendations

`POST /recommendations`

Example request:

```json
{
  "expression": "happy",
  "listening_goal": "help_me_focus",
  "languages": ["English", "Hindi"],
  "genres": ["indie", "lofi"],
  "limit": 5
}
```

The first implementation ranks a small demo catalogue using listening-goal tag matches, language, genre, and track energy.
