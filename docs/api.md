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

## Accounts and personal mood playlists

Account routes are under `/auth`:

- `POST /auth/register` — email, password (minimum 12 characters), display name (1–80 characters), and username (3–30 letters, digits, or underscores); sends a one-time email verification link. Usernames are normalized to lowercase and unique without regard to case.
- `POST /auth/verify` — accepts the verification token once (expires after 24 hours).
- `POST /auth/login` — returns a short-lived Bearer access token and sets an HttpOnly refresh cookie.
- `POST /auth/refresh` — rotates the refresh cookie and returns a new access token.
- `POST /auth/logout` — revokes the current refresh session and clears its cookie.
- `POST /auth/forgot-password` and `POST /auth/reset-password` — reset token is one-time, expires after 30 minutes, and revokes existing refresh sessions.
- `GET /auth/me` — returns the authenticated user's email, display name, and username.
- `PUT /auth/me` — updates the authenticated user's display name and username; email changes are not supported by this endpoint.

The frontend must send `credentials: include` for account requests and `Authorization: Bearer <access_token>` for
personal playlist endpoints. Configure SMTP for verification and recovery email delivery. The local compose setup
includes Mailpit for development only. Production requires HTTPS, a unique `MOODIFY_JWT_SECRET`, secure cookies,
protected database/SMTP secrets, and deployment-level rate limiting for account endpoints.

### Admin API

Accounts have database-backed `user`, `admin`, or `super_user` roles. Provision the initial super user by registering
and verifying the intended account normally, then setting `MOODIFY_INITIAL_SUPERUSER_EMAIL` to its email and starting
the API. Startup promotes only an existing verified account and fails if it is missing or unverified; no default admin
password or account is created. Remove the setting after promotion. The role remains persisted in PostgreSQL.

All admin endpoints require a verified Bearer session. `GET /admin/users` supports `q`, `limit` (up to 100), and
`offset`; `GET /admin/metrics` returns aggregate account and personal-song counts; `GET /admin/status` reports API,
database, environment, and version status without returning secrets. Admins can `PUT /admin/users/{id}/suspension`
with `{ "suspended": true }` (or false) and `DELETE /admin/users/{id}` for ordinary users. Suspension blocks login
and protected requests and revokes refresh sessions. Deletion permanently removes the account, personal songs, and
authentication records. Admins cannot target privileged accounts or themselves.

Super users may `PUT /admin/users/{id}/role` with one of `user`, `admin`, or `super_user`; browse the
`/admin/audit` log; and manage `/admin/catalogue` with GET/POST/PUT/DELETE. At least one catalogue track must remain.
`GET` and `PUT /admin/settings/recommendations` manage only the five allowlisted scoring weights (each 0–5):
`goal_tag_weight`, `language_match_weight`, `genre_match_weight`, `expression_affinity_weight`, and `energy_weight`.
Every admin mutation is audited. Self-targeting and removal/demotion/suspension of the final super user are blocked.
Infrastructure secrets and arbitrary runtime configuration are not exposed or writable through these endpoints.

Metrics are counts of stored accounts and personal songs, not active-user analytics. Account deletion is irreversible;
use suspension for reversible access control.

Personal songs use `GET /personal-playlists/songs` (optional `?mood=happy` filter),
`POST /personal-playlists/songs` with `{ "mood": "happy", "title": "Here Comes the Sun", "artist": "The Beatles" }`,
`PUT /personal-playlists/songs/{song_id}` to update title and artist, and `DELETE /personal-playlists/songs/{song_id}`.
All require a verified user Bearer token. Ownership is derived from that token; client-supplied owner IDs are ignored/not
accepted. Mood must be one of the seven expression labels; title and artist are trimmed and limited to 200 characters.
Artist remains nullable for existing entries, but YouTube matching requires it. Updating a title or artist clears the
previous match.

### YouTube account linking and playlists

Configure the server-only `MOODIFY_YOUTUBE_CLIENT_ID`, `MOODIFY_YOUTUBE_CLIENT_SECRET`,
`MOODIFY_YOUTUBE_REDIRECT_URI`, `MOODIFY_YOUTUBE_API_KEY`, and `MOODIFY_YOUTUBE_TOKEN_ENCRYPTION_KEY` values.
Enable YouTube Data API v3 in Google Cloud and register the exact callback URI. Add local Google accounts as OAuth
test users while the consent screen is in testing. Generate a Fernet key for the token encryption setting; losing or
rotating it without re-encrypting stored records requires users to reconnect. Never expose these values via `VITE_*`
variables or commit real secrets.

- `POST /youtube/oauth/start` — authenticated; accepts `{}` or `{ "mood": "happy" }` and returns an authorization URL
  for the Google account-linking flow, preserving the optional mood through the redirect.
- `GET /youtube/oauth/callback` — receives the one-time OAuth state/code, checks the granted playlist-write scope,
  stores the offline refresh token encrypted, and redirects back to Create Playlist. This links YouTube capabilities
  to the current Moodify account; it is not Google sign-in.
- `GET /youtube/connection` and `DELETE /youtube/connection` — inspect or disconnect/revoke the linked account.
- `GET /youtube/songs/{song_id}/matches` — search by the saved title and artist. `PUT /youtube/songs/{song_id}/match`
  with `{ "video_id": "..." }` confirms one of the current search results; the backend rechecks that selection.
- `POST /youtube/playlists` with `{ "mood": "happy", "title": "Moodify — Happy" }` — creates a new private YouTube
  playlist from every saved song in that mood after each has an artist and confirmed video match. Item insertion is
  ordered by the saved song order. The response includes the YouTube URL and `created` or `partial` status.
- `POST /youtube/playlists/{playlist_id}/retry` — retries only failed item insertions for this user's existing
  playlist; it never creates a duplicate remote playlist.
- `GET /youtube/playlists` (optional `?mood=happy`) — lists this Moodify user's previously created YouTube playlists.

Google OAuth refresh tokens are encrypted at rest and are never returned to the client. The UI asks users to review
candidate results before creation; search is not guaranteed to identify the intended recording. Search and write calls
consume YouTube Data API quota. Playlists are private by default; each creation request creates a new playlist. A
partial response means the remote playlist exists but one or more video insertions failed; `failed_song_ids` identifies
the remaining songs to review. Tests mock Google endpoints and do not require live credentials. Public rollout must
complete any applicable Google OAuth verification and comply with current YouTube API policies and quota limits.
