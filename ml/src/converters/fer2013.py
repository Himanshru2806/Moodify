from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import TextIO

from PIL import Image

from ml.src.labels import LABELS


FER2013_ID_TO_LABEL = {
    0: "angry",
    1: "disgust",
    2: "fear",
    3: "happy",
    4: "sad",
    5: "surprise",
    6: "neutral",
}
FER2013_USAGE_TO_SPLIT = {
    "training": "train",
    "publictest": "validation",
    "privatetest": "test",
}
FERPLUS_LABEL_COLUMNS = {
    "neutral": "neutral",
    "happiness": "happy",
    "surprise": "surprise",
    "sadness": "sad",
    "anger": "angry",
    "disgust": "disgust",
    "fear": "fear",
}
FERPLUS_UNMAPPED_COLUMNS = ("contempt", "unknown", "NF")
MANIFEST_COLUMNS = (
    "image_path",
    "split",
    "dataset",
    "group_id",
    "label",
    *LABELS,
)


class ConversionError(ValueError):
    """Raised for malformed FER source rows or unsafe split/annotation joins."""


def _open_csv(path: Path) -> TextIO:
    try:
        return path.open("r", encoding="utf-8-sig", newline="")
    except OSError as error:
        raise ConversionError(f"Could not read source CSV {path}: {error}") from error


def _parse_fer2013_row(row: dict[str | None, str | None], row_number: int) -> tuple[str, int, bytes]:
    required = {"emotion", "pixels", "Usage"}
    missing = required - {key for key in row if key is not None}
    if missing:
        raise ConversionError(f"FER-2013 row {row_number}: missing columns {sorted(missing)}")
    try:
        emotion_id = int(row["emotion"] or "")
    except (ValueError, TypeError) as error:
        raise ConversionError(f"FER-2013 row {row_number}: emotion must be an integer class id") from error
    if emotion_id not in FER2013_ID_TO_LABEL:
        raise ConversionError(f"FER-2013 row {row_number}: unsupported class id {emotion_id}")

    usage = (row["Usage"] or "").strip()
    try:
        split = FER2013_USAGE_TO_SPLIT[usage.lower()]
    except KeyError as error:
        raise ConversionError(f"FER-2013 row {row_number}: unsupported official Usage value {usage!r}") from error

    try:
        pixels = bytes(int(value) for value in (row["pixels"] or "").split())
    except (ValueError, TypeError) as error:
        raise ConversionError(f"FER-2013 row {row_number}: pixels must be space-separated integers") from error
    if len(pixels) != 48 * 48:
        raise ConversionError(f"FER-2013 row {row_number}: expected 2304 pixels, got {len(pixels)}")
    return split, emotion_id, pixels


def _read_vote_count(value: str | None, row_number: int, column: str) -> int:
    try:
        count = int(value)
    except (ValueError, TypeError) as error:
        raise ConversionError(f"FER+ row {row_number}: {column} must be a non-negative integer") from error
    if count < 0:
        raise ConversionError(f"FER+ row {row_number}: {column} must be a non-negative integer")
    return count


def _write_manifest(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=MANIFEST_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def convert_fer2013(
    fer2013_csv: Path,
    output_dir: Path,
    ferplus_csv: Path | None = None,
    minimum_mapped_vote_fraction: float = 0.5,
) -> dict[str, object]:
    """Convert locally acquired FER-2013 and optional FER+ annotations to manifests.

    FER+ is written to its own manifest so the same underlying FER-2013 pixels are
    not accidentally counted twice when manifests are later combined.
    """
    if not 0 < minimum_mapped_vote_fraction <= 1:
        raise ValueError("minimum_mapped_vote_fraction must be in (0, 1]")
    output_dir = output_dir.resolve()
    fer_images_dir = output_dir / "fer2013_images"
    ferplus_images_dir = output_dir / "ferplus_images"
    for generated_dir in (fer_images_dir, ferplus_images_dir):
        if generated_dir.exists() and any(generated_dir.iterdir()):
            raise FileExistsError(f"Refusing to overwrite non-empty output directory: {generated_dir}")

    fer_rows: list[dict[str, object]] = []
    ferplus_rows: list[dict[str, object]] = []
    fer_images: list[tuple[Path, bytes]] = []
    ferplus_images: list[tuple[Path, bytes]] = []
    mapped_vote_count = 0
    unmapped_vote_count = 0
    skipped_low_coverage = 0
    source_row_count = 0

    fer_stream = _open_csv(fer2013_csv)
    plus_stream = _open_csv(ferplus_csv) if ferplus_csv else None
    try:
        fer_reader = csv.DictReader(fer_stream)
        plus_reader = csv.DictReader(plus_stream) if plus_stream else None
        plus_iter = iter(plus_reader) if plus_reader else None
        for row_number, fer_row in enumerate(fer_reader, start=2):
            split, emotion_id, pixels = _parse_fer2013_row(fer_row, row_number)
            source_row_count += 1
            label = FER2013_ID_TO_LABEL[emotion_id]
            digest = hashlib.sha256(pixels).hexdigest()[:16]
            file_name = f"row_{row_number - 2:08d}_{digest}.png"
            relative_image_path = Path("fer2013_images") / file_name
            fer_images.append((relative_image_path, pixels))
            fer_rows.append({
                "image_path": relative_image_path.as_posix(),
                "split": split,
                "dataset": "FER-2013",
                "group_id": "",
                "label": label,
                **{candidate: 1.0 if candidate == label else 0.0 for candidate in LABELS},
            })

            if plus_iter is None:
                continue
            try:
                plus_row = next(plus_iter)
            except StopIteration as error:
                raise ConversionError("FER+ annotation CSV ended before FER-2013; refusing an unsafe row join") from error
            required_vote_columns = {"Usage", *FERPLUS_LABEL_COLUMNS, *FERPLUS_UNMAPPED_COLUMNS}
            missing_vote_columns = required_vote_columns - set(plus_row)
            if missing_vote_columns:
                raise ConversionError(f"FER+ row {row_number}: missing vote columns {sorted(missing_vote_columns)}")
            plus_usage = (plus_row["Usage"] or "").strip().lower()
            if plus_usage not in FER2013_USAGE_TO_SPLIT or FER2013_USAGE_TO_SPLIT[plus_usage] != split:
                raise ConversionError(
                    f"FER+ row {row_number}: Usage does not match corresponding FER-2013 official split"
                )

            mapped_votes = {
                label_name: _read_vote_count(plus_row[source_column], row_number, source_column)
                for source_column, label_name in FERPLUS_LABEL_COLUMNS.items()
            }
            other_votes = sum(
                _read_vote_count(plus_row[column], row_number, column) for column in FERPLUS_UNMAPPED_COLUMNS
            )
            mapped_total = sum(mapped_votes.values())
            total_votes = mapped_total + other_votes
            mapped_vote_count += mapped_total
            unmapped_vote_count += other_votes
            if total_votes == 0 or mapped_total / total_votes < minimum_mapped_vote_fraction:
                skipped_low_coverage += 1
                continue

            distribution = {label: count / mapped_total for label, count in mapped_votes.items()}
            dominant_label = max(distribution, key=distribution.__getitem__)
            plus_relative_path = Path("ferplus_images") / file_name
            ferplus_images.append((plus_relative_path, pixels))
            ferplus_rows.append({
                "image_path": plus_relative_path.as_posix(),
                "split": split,
                "dataset": "FER+",
                "group_id": "",
                "label": dominant_label,
                **distribution,
            })

        if plus_iter is not None:
            try:
                next(plus_iter)
            except StopIteration:
                pass
            else:
                raise ConversionError("FER+ annotation CSV has extra rows; refusing an unsafe row join")
    finally:
        fer_stream.close()
        if plus_stream:
            plus_stream.close()

    if source_row_count == 0:
        raise ConversionError("FER-2013 CSV contains no data rows")
    if ferplus_csv and not {row["split"] for row in ferplus_rows} >= {"train", "validation", "test"}:
        raise ConversionError("FER+ mapped annotations must retain at least one sample from every official split")

    generated_manifests = [output_dir / "fer2013_manifest.csv"]
    if ferplus_csv:
        generated_manifests.append(output_dir / "ferplus_manifest.csv")
    generated_manifests.append(output_dir / "conversion_report.json")
    if any(path.exists() for path in generated_manifests):
        raise FileExistsError(f"Refusing to overwrite existing generated output under {output_dir}")

    for images_dir, image_records in ((fer_images_dir, fer_images), (ferplus_images_dir, ferplus_images)):
        if image_records:
            images_dir.mkdir(parents=True, exist_ok=True)
            for relative_path, pixels in image_records:
                Image.frombytes("L", (48, 48), pixels).save(output_dir / relative_path, format="PNG")

    fer_manifest_path = output_dir / "fer2013_manifest.csv"
    _write_manifest(fer_manifest_path, fer_rows)
    if ferplus_csv:
        _write_manifest(output_dir / "ferplus_manifest.csv", ferplus_rows)

    report: dict[str, object] = {
        "fer2013_rows": source_row_count,
        "fer2013_manifest": fer_manifest_path.name,
        "fer2013_split_counts": {
            split: sum(row["split"] == split for row in fer_rows)
            for split in ("train", "validation", "test")
        },
    }
    if ferplus_csv:
        report.update({
            "ferplus_manifest": "ferplus_manifest.csv",
            "ferplus_rows_written": len(ferplus_rows),
            "ferplus_split_counts": {
                split: sum(row["split"] == split for row in ferplus_rows)
                for split in ("train", "validation", "test")
            },
            "ferplus_skipped_low_mapped_vote_coverage": skipped_low_coverage,
            "ferplus_mapped_votes": mapped_vote_count,
            "ferplus_ignored_votes": unmapped_vote_count,
            "ferplus_minimum_mapped_vote_fraction": minimum_mapped_vote_fraction,
        })
    (output_dir / "conversion_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert locally acquired FER-2013 and FER+ CSV files.")
    parser.add_argument("--fer2013-csv", type=Path, required=True)
    parser.add_argument("--ferplus-csv", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--minimum-mapped-vote-fraction", type=float, default=0.5)
    parser.add_argument(
        "--confirm-dataset-terms-reviewed",
        action="store_true",
        help="Confirm that official access/use terms were reviewed for this use; converter does not verify permissions.",
    )
    args = parser.parse_args()
    if not args.confirm_dataset_terms_reviewed:
        parser.error("Review the dataset's official terms first, then pass --confirm-dataset-terms-reviewed")
    print(json.dumps(
        convert_fer2013(
            args.fer2013_csv,
            args.output_dir,
            args.ferplus_csv,
            args.minimum_mapped_vote_fraction,
        ),
        indent=2,
    ))


if __name__ == "__main__":
    main()