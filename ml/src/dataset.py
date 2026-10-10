from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image
from torch.utils.data import Dataset

from ml.src.labels import LABELS, distribution_from_row
from ml.src.preprocessing import extract_largest_frontal_face


SPLITS = {"train", "validation", "test"}
REQUIRED_COLUMNS = {"image_path", "split", "dataset"}


class ManifestError(ValueError):
    """Raised when a dataset manifest is invalid or leaks records across splits."""


@dataclass(frozen=True)
class ManifestRecord:
    image_path: Path
    split: str
    dataset: str
    group_id: str
    target: tuple[float, ...]


def load_manifest(manifest_path: Path, data_root: Path, verify_images: bool = True) -> list[ManifestRecord]:
    """Load a CSV manifest without downloading, moving, or copying dataset files."""
    try:
        stream = manifest_path.open("r", encoding="utf-8-sig", newline="")
    except OSError as error:
        raise ManifestError(f"Could not read manifest {manifest_path}: {error}") from error

    with stream:
        reader = csv.DictReader(stream)
        columns = set(reader.fieldnames or ())
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise ManifestError(f"Manifest is missing required columns: {', '.join(sorted(missing))}")

        records: list[ManifestRecord] = []
        seen_paths: dict[Path, tuple[str, int]] = {}
        group_splits: dict[tuple[str, str], str] = {}
        for line_number, row in enumerate(reader, start=2):
            split = (row.get("split") or "").strip().lower()
            dataset = (row.get("dataset") or "").strip()
            raw_path = (row.get("image_path") or "").strip()
            if split not in SPLITS:
                raise ManifestError(f"Line {line_number}: split must be one of {sorted(SPLITS)}")
            if not dataset:
                raise ManifestError(f"Line {line_number}: dataset cannot be empty")
            if not raw_path:
                raise ManifestError(f"Line {line_number}: image_path cannot be empty")

            image_path = Path(raw_path)
            if not image_path.is_absolute():
                image_path = data_root / image_path
            image_path = image_path.resolve()
            if verify_images:
                if not image_path.is_file():
                    raise ManifestError(f"Line {line_number}: image does not exist: {image_path}")
                try:
                    with Image.open(image_path) as image:
                        image.verify()
                except (OSError, Image.DecompressionBombError) as error:
                    raise ManifestError(f"Line {line_number}: image cannot be decoded: {image_path}") from error

            prior = seen_paths.get(image_path)
            if prior is not None and prior[0] != split:
                raise ManifestError(
                    f"Image appears in multiple splits ({prior[0]} on line {prior[1]}, {split} on line {line_number})"
                )
            seen_paths[image_path] = (split, line_number)

            group_id = (row.get("group_id") or "").strip()
            if group_id:
                group_key = (dataset, group_id)
                prior_split = group_splits.get(group_key)
                if prior_split is not None and prior_split != split:
                    raise ManifestError(
                        f"Group {group_id!r} from dataset {dataset!r} occurs in both {prior_split!r} and {split!r}"
                    )
                group_splits[group_key] = split

            try:
                target = distribution_from_row(row)
            except ValueError as error:
                raise ManifestError(f"Line {line_number}: {error}") from error
            records.append(ManifestRecord(image_path, split, dataset, group_id, target))

    if not records:
        raise ManifestError("Manifest contains no records")
    available_splits = {record.split for record in records}
    missing_splits = SPLITS - available_splits
    if missing_splits:
        raise ManifestError(f"Manifest is missing required splits: {', '.join(sorted(missing_splits))}")
    return records


class ExpressionImageDataset(Dataset[tuple[Any, Any]]):
    def __init__(self, records: list[ManifestRecord], image_processor: Any) -> None:
        import torch

        self.records = records
        self.image_processor = image_processor
        self.torch = torch

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[Any, Any]:
        record = self.records[index]
        try:
            with Image.open(record.image_path) as source:
                image = extract_largest_frontal_face(source)
                inputs = self.image_processor(images=image, return_tensors="pt")
        except (OSError, Image.DecompressionBombError) as error:
            raise ManifestError(f"Could not load image {record.image_path}") from error

        pixel_values = inputs["pixel_values"].squeeze(0)
        target = self.torch.tensor(record.target, dtype=self.torch.float32)
        if target.numel() != len(LABELS):
            raise ManifestError(f"Target must have exactly {len(LABELS)} labels")
        return pixel_values, target