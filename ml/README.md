# Moodify ML Workspace

The backend currently runs a pinned pretrained facial-expression checkpoint. This directory remains the place for a
future reproducible Moodify training and evaluation pipeline; do not assume the upstream checkpoint was trained or
evaluated by this project.

Planned modules:

- `configs/` for experiment settings.
- `src/dataset.py` for dataset loading and split handling.
- `src/preprocessing.py` for transformations shared with inference.
- `src/models.py` for the custom CNN and pretrained model wrappers.
- `src/train.py` for training.
- `src/evaluate.py` for held-out evaluation.
- `src/predict.py` for checkpoint inference.

Do not commit raw datasets or trained checkpoints. Document dataset access and keep generated artifacts local unless they are small reports intended for review.
