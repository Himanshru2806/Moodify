# Moodify Backlog

## Foundation

- [x] Create backend API skeleton.
- [x] Create frontend application shell.
- [x] Add first recommendation baseline.
- [ ] Add database models and migrations.
- [ ] Add structured logging without image content.

## Expression Recognition

- [ ] Build FER-2013 dataset audit script.
- [ ] Implement preprocessing shared by training and inference.
- [ ] Train custom CNN baseline.
- [ ] Fine-tune compact pretrained model.
- [ ] Add face detection and crop pipeline.
- [ ] Integrate selected checkpoint with FastAPI.
- [ ] Add uncertainty policy selected on validation data.

## Recommendations

- [ ] Replace demo tracks with documented catalogue data.
- [ ] Add configurable goal-tag scoring weights.
- [ ] Add genre and language preference persistence.
- [ ] Add feedback endpoints for likes, skips, and ratings.
- [ ] Compare rule-based and content-based ranking.

## Frontend

- [ ] Implement browser camera permission flow.
- [ ] Implement captured-photo prediction.
- [ ] Implement upload-to-prediction flow.
- [ ] Add manual correction for predicted expression.
- [ ] Add feedback controls on recommended tracks.

## Evaluation

- [ ] Add backend API tests for validation failures.
- [ ] Add frontend component tests.
- [ ] Add end-to-end happy path test.
- [ ] Measure inference latency on stated hardware.
- [ ] Write model card and limitations section.
