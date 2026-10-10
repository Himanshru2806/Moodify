from __future__ import annotations

from typing import Any

import torch

from ml.src.labels import LABELS, normalize_label


def align_classifier_labels(model: Any) -> Any:
    """Reorder a seven-way linear classifier into Moodify's canonical label order."""
    id2label = model.config.id2label
    source_labels = {int(index): normalize_label(str(label)) for index, label in id2label.items()}
    if len(source_labels) != len(LABELS) or set(source_labels.values()) != set(LABELS):
        raise ValueError(
            "Base checkpoint must contain exactly Moodify's seven mapped labels; "
            "resolve label mappings before fine-tuning."
        )
    classifier = getattr(model, "classifier", None)
    if classifier is None or classifier.out_features != len(LABELS):
        raise ValueError("Expected a seven-class model with a linear `classifier` head")

    source_index = {label: index for index, label in source_labels.items()}
    reorder = torch.tensor([source_index[label] for label in LABELS], dtype=torch.long)
    with torch.no_grad():
        classifier.weight.copy_(classifier.weight.index_select(0, reorder).clone())
        if classifier.bias is not None:
            classifier.bias.copy_(classifier.bias.index_select(0, reorder).clone())

    model.config.id2label = {index: label for index, label in enumerate(LABELS)}
    model.config.label2id = {label: index for index, label in enumerate(LABELS)}
    return model


def load_aligned_model(model_path: str, local_files_only: bool = True) -> Any:
    from transformers import AutoModelForImageClassification

    model = AutoModelForImageClassification.from_pretrained(model_path, local_files_only=local_files_only)
    return align_classifier_labels(model)