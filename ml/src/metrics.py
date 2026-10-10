from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from ml.src.labels import LABELS


def classification_metrics(targets: Sequence[int], predictions: Sequence[int]) -> dict[str, object]:
    if len(targets) != len(predictions):
        raise ValueError("Targets and predictions must have the same number of entries")
    if not targets:
        raise ValueError("Metrics require at least one example")
    if any(value < 0 or value >= len(LABELS) for value in (*targets, *predictions)):
        raise ValueError(f"Class indices must be between 0 and {len(LABELS) - 1}")

    confusion = np.zeros((len(LABELS), len(LABELS)), dtype=np.int64)
    for target, prediction in zip(targets, predictions, strict=True):
        confusion[target, prediction] += 1

    per_class: dict[str, dict[str, float]] = {}
    f1_values: list[float] = []
    for index, label in enumerate(LABELS):
        true_positive = int(confusion[index, index])
        predicted_count = int(confusion[:, index].sum())
        actual_count = int(confusion[index, :].sum())
        precision = true_positive / predicted_count if predicted_count else 0.0
        recall = true_positive / actual_count if actual_count else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        f1_values.append(f1)
        per_class[label] = {"precision": precision, "recall": recall, "f1": f1, "support": actual_count}

    correct = int(np.trace(confusion))
    return {
        "accuracy": correct / len(targets),
        "macro_f1": float(np.mean(f1_values)),
        "per_class": per_class,
        "confusion_matrix": confusion.tolist(),
        "labels": list(LABELS),
        "examples": len(targets),
    }