from __future__ import annotations

from collections.abc import Mapping


LABELS: tuple[str, ...] = ("angry", "disgust", "fear", "happy", "sad", "surprise", "neutral")
LABEL_TO_ID = {label: index for index, label in enumerate(LABELS)}
ALIASES = {
    "anger": "angry",
    "happiness": "happy",
    "sadness": "sad",
}


class LabelMappingError(ValueError):
    """Raised when a source label cannot be mapped without inventing a class."""


def normalize_label(label: str) -> str:
    normalized = label.strip().lower().replace(" ", "_")
    normalized = ALIASES.get(normalized, normalized)
    if normalized not in LABEL_TO_ID:
        raise LabelMappingError(f"Unsupported expression label: {label!r}")
    return normalized


def parse_label_distribution(values: Mapping[str, object]) -> tuple[float, ...]:
    """Normalize one-hot or soft source annotations into Moodify label order."""
    distribution: list[float] = []
    for label in LABELS:
        raw_value = values.get(label, 0.0)
        try:
            probability = float(raw_value or 0.0)
        except (TypeError, ValueError) as error:
            raise LabelMappingError(f"Invalid probability for {label!r}: {raw_value!r}") from error
        if probability < 0:
            raise LabelMappingError(f"Probability for {label!r} cannot be negative")
        distribution.append(probability)

    total = sum(distribution)
    if total <= 0:
        raise LabelMappingError("A label distribution must have positive total weight")
    return tuple(value / total for value in distribution)


def distribution_from_row(row: Mapping[str, object]) -> tuple[float, ...]:
    """Read a categorical `label` or seven Moodify-named probability columns."""
    if any(str(row.get(label, "")).strip() for label in LABELS):
        return parse_label_distribution({label: row.get(label, 0.0) for label in LABELS})

    raw_label = str(row.get("label", "")).strip()
    if not raw_label:
        raise LabelMappingError("Manifest row must contain `label` or probability columns")
    label = normalize_label(raw_label)
    return tuple(1.0 if candidate == label else 0.0 for candidate in LABELS)