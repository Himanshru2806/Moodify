from __future__ import annotations

import csv
from pathlib import Path

from PIL import Image
import pytest

from ml.src.dataset import ManifestError, load_manifest
from ml.src.audit_data import audit_manifest
from ml.src.converters.fer2013 import ConversionError, convert_fer2013
from ml.src.labels import LABELS, LabelMappingError, distribution_from_row, normalize_label
from ml.src.metrics import classification_metrics
from ml.src.models import align_classifier_labels
from ml.src.preprocessing import FaceCropError, extract_largest_frontal_face
import torch


def _write_image(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (12, 12), color="white").save(path)


def _write_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    columns = ["image_path", "split", "dataset", "group_id", "label"]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def test_label_alias_and_distribution_are_normalized() -> None:
    assert normalize_label("Happiness") == "happy"
    distribution = distribution_from_row({"angry": "2", "happy": "6"})
    assert len(distribution) == len(LABELS)
    assert sum(distribution) == pytest.approx(1.0)
    assert distribution[LABELS.index("happy")] == pytest.approx(0.75)


def test_unmapped_source_label_is_not_guessed() -> None:
    with pytest.raises(LabelMappingError, match="Unsupported expression label"):
        normalize_label("contempt")


def test_manifest_loads_multiple_sources_and_keeps_soft_targets(tmp_path: Path) -> None:
    rows = []
    for split in ("train", "validation", "test"):
        relative_path = f"images/{split}.png"
        _write_image(tmp_path / relative_path)
        rows.append({
            "image_path": relative_path,
            "split": split,
            "dataset": "source_a" if split != "test" else "source_b",
            "group_id": f"person_{split}",
            "label": "happy",
        })
    _write_manifest(tmp_path / "manifest.csv", rows)

    records = load_manifest(tmp_path / "manifest.csv", tmp_path)

    assert [record.split for record in records] == ["train", "validation", "test"]
    assert records[0].dataset == "source_a"
    assert records[0].target[LABELS.index("happy")] == 1.0


def test_manifest_rejects_group_leakage_between_splits(tmp_path: Path) -> None:
    rows = []
    for split in ("train", "validation", "test"):
        relative_path = f"images/{split}.png"
        _write_image(tmp_path / relative_path)
        rows.append({
            "image_path": relative_path,
            "split": split,
            "dataset": "source_a",
            "group_id": "same_person" if split != "test" else "test_person",
            "label": "happy",
        })
    _write_manifest(tmp_path / "manifest.csv", rows)

    with pytest.raises(ManifestError, match="occurs in both"):
        load_manifest(tmp_path / "manifest.csv", tmp_path)


def test_manifest_rejects_an_image_reused_across_splits(tmp_path: Path) -> None:
    image_path = tmp_path / "images" / "duplicate.png"
    _write_image(image_path)
    rows = [
        {"image_path": "images/duplicate.png", "split": "train", "dataset": "source_a", "group_id": "", "label": "sad"},
        {"image_path": "images/duplicate.png", "split": "validation", "dataset": "source_a", "group_id": "", "label": "sad"},
        {"image_path": "images/test.png", "split": "test", "dataset": "source_a", "group_id": "", "label": "sad"},
    ]
    _write_image(tmp_path / "images" / "test.png")
    _write_manifest(tmp_path / "manifest.csv", rows)

    with pytest.raises(ManifestError, match="multiple splits"):
        load_manifest(tmp_path / "manifest.csv", tmp_path)


def test_classification_metrics_include_per_class_and_confusion_matrix() -> None:
    result = classification_metrics([0, 0, 3], [0, 3, 3])

    assert result["accuracy"] == pytest.approx(2 / 3)
    assert result["confusion_matrix"][0][0] == 1
    assert result["confusion_matrix"][0][3] == 1
    assert result["per_class"]["happy"]["support"] == 1


def test_pretrained_classifier_rows_are_reordered_to_canonical_labels() -> None:
    class FakeConfig:
        id2label = {index: label for index, label in enumerate(reversed(LABELS))}
        label2id = {}

    class FakeModel:
        def __init__(self) -> None:
            self.config = FakeConfig()
            self.classifier = torch.nn.Linear(1, len(LABELS), bias=True)
            with torch.no_grad():
                self.classifier.weight.copy_(torch.arange(len(LABELS), dtype=torch.float32).reshape(-1, 1))
                self.classifier.bias.copy_(torch.arange(len(LABELS), dtype=torch.float32))

    model = align_classifier_labels(FakeModel())

    assert model.config.id2label == {index: label for index, label in enumerate(LABELS)}
    assert model.classifier.weight[:, 0].tolist() == list(reversed(range(len(LABELS))))
    assert model.classifier.bias.tolist() == list(reversed(range(len(LABELS))))


def test_training_crop_rejects_image_without_a_detectable_face() -> None:
    with pytest.raises(FaceCropError, match="No detectable frontal face"):
        extract_largest_frontal_face(Image.new("RGB", (96, 96), color="white"))


def test_audit_reports_dataset_composition_without_face_check(tmp_path: Path) -> None:
    rows = []
    for split in ("train", "validation", "test"):
        relative_path = f"images/{split}.png"
        _write_image(tmp_path / relative_path)
        rows.append({
            "image_path": relative_path,
            "split": split,
            "dataset": "source_a",
            "group_id": f"group_{split}",
            "label": "happy",
        })
    manifest_path = tmp_path / "manifest.csv"
    _write_manifest(manifest_path, rows)

    report = audit_manifest(manifest_path, tmp_path)

    assert report["total_records"] == 3
    assert report["dataset_split_counts"]["source_a"] == {"test": 1, "train": 1, "validation": 1}
    assert report["face_crop_failures_by_dataset"] is None


def _write_fer2013_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["emotion", "pixels", "Usage"])
        writer.writeheader()
        writer.writerows(rows)


def _write_ferplus_csv(path: Path, rows: list[dict[str, str]]) -> None:
    columns = ["Usage", "neutral", "happiness", "surprise", "sadness", "anger", "disgust", "fear", "contempt", "unknown", "NF"]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def _fer_row(emotion_id: int, usage: str, pixel_value: int = 128) -> dict[str, str]:
    return {"emotion": str(emotion_id), "pixels": " ".join([str(pixel_value)] * (48 * 48)), "Usage": usage}


def _ferplus_row(usage: str, **votes: int) -> dict[str, str]:
    columns = ("neutral", "happiness", "surprise", "sadness", "anger", "disgust", "fear", "contempt", "unknown", "NF")
    row = {"Usage": usage, **{column: "0" for column in columns}}
    row.update({column: str(value) for column, value in votes.items()})
    return row


def test_fer2013_converter_maps_official_splits_and_labels(tmp_path: Path) -> None:
    source_csv = tmp_path / "fer2013.csv"
    _write_fer2013_csv(source_csv, [
        _fer_row(3, "Training"),
        _fer_row(4, "PublicTest", 129),
        _fer_row(6, "PrivateTest", 130),
    ])

    report = convert_fer2013(source_csv, tmp_path / "converted")

    manifest_path = tmp_path / "converted" / "fer2013_manifest.csv"
    records = load_manifest(manifest_path, tmp_path / "converted")
    assert [record.split for record in records] == ["train", "validation", "test"]
    assert [record.target[LABELS.index(label)] for record, label in zip(records, ("happy", "sad", "neutral"), strict=True)] == [1, 1, 1]
    assert report["fer2013_rows"] == 3


def test_ferplus_converter_writes_separate_soft_label_manifest(tmp_path: Path) -> None:
    source_csv = tmp_path / "fer2013.csv"
    plus_csv = tmp_path / "ferplus.csv"
    usages = ("Training", "PublicTest", "PrivateTest", "PrivateTest")
    _write_fer2013_csv(source_csv, [_fer_row(index, usage, 100 + index) for index, usage in enumerate(usages)])
    _write_ferplus_csv(plus_csv, [
        _ferplus_row("Training", happiness=6, neutral=4),
        _ferplus_row("PublicTest", sadness=8, contempt=2),
        _ferplus_row("PrivateTest", neutral=4, unknown=6),
        _ferplus_row("PrivateTest", happiness=7, neutral=3),
    ])

    report = convert_fer2013(source_csv, tmp_path / "converted", plus_csv, minimum_mapped_vote_fraction=0.5)

    fer_manifest = load_manifest(tmp_path / "converted" / "fer2013_manifest.csv", tmp_path / "converted")
    plus_manifest = load_manifest(tmp_path / "converted" / "ferplus_manifest.csv", tmp_path / "converted")
    assert len(fer_manifest) == 4
    assert len(plus_manifest) == 3
    assert plus_manifest[0].dataset == "FER+"
    assert plus_manifest[0].target[LABELS.index("happy")] == pytest.approx(0.6)
    assert plus_manifest[1].target[LABELS.index("sad")] == pytest.approx(1.0)
    assert report["ferplus_skipped_low_mapped_vote_coverage"] == 1
    assert report["ferplus_ignored_votes"] == 8


def test_ferplus_converter_rejects_row_count_or_split_mismatch(tmp_path: Path) -> None:
    source_csv = tmp_path / "fer2013.csv"
    plus_csv = tmp_path / "ferplus.csv"
    _write_fer2013_csv(source_csv, [
        _fer_row(0, "Training"),
        _fer_row(0, "PublicTest", 129),
        _fer_row(0, "PrivateTest", 130),
    ])
    _write_ferplus_csv(plus_csv, [
        _ferplus_row("PublicTest", anger=10),
        _ferplus_row("PublicTest", anger=10),
        _ferplus_row("PrivateTest", anger=10),
    ])

    with pytest.raises(ConversionError, match="Usage does not match"):
        convert_fer2013(source_csv, tmp_path / "converted", plus_csv)