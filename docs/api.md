# API Notes

Base path: `/api/v1`

## Health

`GET /health`

Returns service status.

## Expression Prediction

`POST /expressions/predict`

Multipart form field: `image`

Supported image types: JPEG, PNG, WebP.

Current status: validates input and returns `model_not_configured` until the ML model is integrated.

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
