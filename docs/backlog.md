# Moodify Backlog

## Foundation

- [x] Create backend API skeleton.
- [x] Create frontend application shell.
- [x] Add first recommendation baseline.
- [ ] Add database models and migrations.
- [ ] Add structured logging without image content.
- [x] Add database-backed user/admin/super-user roles and protected admin operations.
- [x] Add owner bootstrap, audit records, account moderation, aggregate metrics, catalogue management and allowlisted scoring settings.

## Expression Recognition

- [ ] Build FER-2013 dataset audit script.
- [ ] Implement preprocessing shared by training and inference.
- [ ] Train custom CNN baseline.
- [ ] Fine-tune compact pretrained model.
- [ ] Add face detection and crop pipeline.
- [x] Integrate pinned pretrained checkpoint with FastAPI inference.
- [ ] Add uncertainty policy selected on validation data.

## Recommendations

- [ ] Replace demo tracks with documented catalogue data.
- [ ] Add configurable goal-tag scoring weights.
- [ ] Add genre and language preference persistence.
- [ ] Add feedback endpoints for likes, skips, and ratings.
- [ ] Compare rule-based and content-based ranking.

## Frontend

- [ ] Implement browser camera permission flow.
- [x] Implement captured-photo prediction and automatic playlist generation.
- [x] Implement upload-to-prediction flow and automatic playlist generation.
- [x] Add manual correction for predicted expression and immediate playlist reranking.
- [ ] Add browser-local sampled face tracking and a separate smile cue.
- [ ] Add live-estimate smoothing and stable/explicit recommendation triggers.
- [ ] Add feedback controls on recommended tracks.
- [x] Add explicit per-photo opt-in to a browser-local personal photo/label set with deletion controls.
- [ ] Implement isolated per-user model training only after account identity, secure storage, deletion and evaluation design.
- [x] Add artist-based YouTube video matching, user review, Google account linking, and private mood playlist creation.

## Evaluation

- [ ] Add backend API tests for validation failures.
- [ ] Add frontend component tests.
- [ ] Add end-to-end happy path test.
- [ ] Measure inference latency on stated hardware.
- [ ] Write model card and limitations section.
- [ ] Audit access terms and prepare grouped multi-dataset manifests for fine-tuning.
- [x] Add local FER-2013 and FER+ CSV-to-manifest conversion with split/vote validation.
- [ ] Add access-reviewed AffectNet and FERV39k adapters when their exact local layouts and permitted uses are established.
- [ ] Compare pinned baseline and candidate model on untouched per-source held-out test sets.
