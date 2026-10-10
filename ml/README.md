# Moodify ML Workspace

This directory will contain the reproducible facial-expression recognition pipeline.

Planned modules:

- `configs/` for experiment settings.
- `src/dataset.py` for dataset loading and split handling.
- `src/preprocessing.py` for transformations shared with inference.
- `src/models.py` for the custom CNN and pretrained model wrappers.
- `src/train.py` for training.
- `src/evaluate.py` for held-out evaluation.
- `src/predict.py` for checkpoint inference.

Do not commit raw datasets or trained checkpoints. Document dataset access and keep generated artifacts local unless they are small reports intended for submission.
