from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

from ml.src.dataset import load_manifest
from ml.src.labels import LABELS
from ml.src.preprocessing import FaceCropError, extract_largest_frontal_face
from PIL import Image


def audit_manifest(manifest_path: Path, data_root: Path, check_faces: bool = False) -> dict[str, object]:
    records = load_manifest(manifest_path, data_root, verify_images=True)
    split_counts = Counter(record.split for record in records)
    dataset_counts: dict[str, Counter[str]] = defaultdict(Counter)
    label_mass: dict[str, Counter[str]] = defaultdict(Counter)
    face_failures: Counter[str] = Counter()
    for record in records:
        dataset_counts[record.dataset][record.split] += 1
        for label, probability in zip(LABELS, record.target, strict=True):
            if probability:
                label_mass[record.dataset][label] += probability
        if check_faces:
            try:
                with Image.open(record.image_path) as image:
                    extract_largest_frontal_face(image)
            except FaceCropError as error:
                face_failures[record.dataset] += 1

    return {
        "total_records": len(records),
        "split_counts": dict(sorted(split_counts.items())),
        "dataset_split_counts": {name: dict(sorted(counts.items())) for name, counts in sorted(dataset_counts.items())},
        "dataset_label_mass": {
            name: dict(sorted(counts.items())) for name, counts in sorted(label_mass.items())
        },
        "face_crop_failures_by_dataset": dict(sorted(face_failures.items())) if check_faces else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and summarize a local Moodify dataset manifest.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--check-faces", action="store_true", help="Run the backend-compatible face crop on every image")
    args = parser.parse_args()
    print(json.dumps(audit_manifest(args.manifest, args.data_root, args.check_faces), indent=2))


if __name__ == "__main__":
    main()