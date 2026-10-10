# API Notes

Base path: `/api/v1`

## Health

`GET /health`

Returns service status.

## Expression Prediction

`POST /expressions/predict`

Multipart form field: `image`

Supported image types: JPEG, PNG, WebP. The file is decoded, the largest detected frontal face is cropped, and a local
pretrained classifier returns probabilities for the seven supported expression labels. The API does not persist the
uploaded image. The browser may separately retain a photo in local IndexedDB only after explicit user consent; this
client-side personal dataset is not sent to the API.

Statuses are `prediction_available` and `uncertain`. The expression is `null` when the configured confidence cutoff is
not met. Invalid images and photos with no detected face return HTTP 422; oversized uploads return HTTP 413; a missing
local checkpoint returns HTTP 503. Install the pinned checkpoint from the backend directory with
`python -m app.services.model_download` (about 343 MB) before starting the API. The model version identifies the
upstream checkpoint revision.

The frontend automatically requests recommendations after a photo prediction, using the predicted expression when
available and the currently selected listening goal, languages, and genres. For an uncertain prediction it uses the
goal and preferences without inventing an expression. The displayed model estimate remains separate from the user's
corrected expression; changing that correction immediately requests a new ranking. The model estimates visible
expression cues, not a person's internal emotional state.

## Opt-in personal photo dataset

After a successful photo prediction, the user may separately consent to save that photo and the currently selected
visible-expression label in IndexedDB in the current browser profile. The prediction upload still goes to the backend
for inference, but the opt-in creates no additional upload; the API does not persist its inference request. This
contribution is not sent to any shared dataset or training process. It remains optional; the user can delete individual
or all stored photos in the UI. Browser-profile storage is not encrypted and is not account-isolated, so it should not
be enabled in a shared browser profile. Browser storage may also be cleared by the browser. Personal model training,
account-based storage, and shared model updates are not implemented.

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

The first implementation ranks a small demo catalogue using listening-goal tag matches, language, genre, and track
energy. Optional, explicitly curated track-to-expression context metadata adds at most 0.5 score, while each matching
listening-goal tag adds 2.0; expression is therefore secondary to the user's goal. These catalogue associations are a
prototype ranking heuristic, not evidence that a facial expression predicts a preferred song or internal mood. With a
null expression, ranking uses the goal and preferences only.

The current catalogue contains demo entries rather than provider-resolved songs. The current frontend playlist flow
does not call this ranking endpoint: it shows mood-based playlist styles and opens a playlist-filtered YouTube search
when a style is selected. These searches are discovery links, not verified or curated playlist destinations, provider
API integration, or embedded playback. Search results may vary. Replacing the demo catalogue with verified platform
track IDs/URLs requires a separately configured and documented catalogue source.
