from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader
from transformers import AutoImageProcessor

from ml.src.dataset import ExpressionImageDataset, ManifestRecord, load_manifest
from ml.src.labels import LABELS
from ml.src.metrics import classification_metrics
from ml.src.models import load_aligned_model


def evaluate_model(
    model_path: Path,
    manifest_path: Path,
    data_root: Path,
    split: str = "test",
    batch_size: int = 16,
) -> dict[str, object]:
    if split not in {"train", "validation", "test"}:
        raise ValueError("split must be train, validation, or test")
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    records = [record for record in load_manifest(manifest_path, data_root) if record.split == split]
    if not records:
        raise ValueError(f"Manifest has no records for the {split!r} split")

    processor = AutoImageProcessor.from_pretrained(str(model_path), local_files_only=True, use_fast=False)
    model = load_aligned_model(str(model_path)).to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))
    model.eval()
    device = next(model.parameters()).device
    groups: dict[str, list[ManifestRecord]] = defaultdict(list)
    for record in records:
        groups[record.dataset].append(record)

    results: dict[str, object] = {}
    for dataset_name, dataset_records in sorted(groups.items()):
        loader = DataLoader(
            ExpressionImageDataset(dataset_records, processor),
            batch_size=batch_size,
            shuffle=False,
            num_workers=0,
        )
        targets: list[int] = []
        predictions: list[int] = []
        loss_total = 0.0
        with torch.inference_mode():
            for pixel_values, target_distributions in loader:
                pixel_values = pixel_values.to(device)
                target_distributions = target_distributions.to(device)
                logits = model(pixel_values=pixel_values).logits
                loss = -(target_distributions * torch.log_softmax(logits, dim=-1)).sum(dim=-1)
                loss_total += float(loss.sum())
                targets.extend(target_distributions.argmax(dim=-1).cpu().tolist())
                predictions.extend(logits.argmax(dim=-1).cpu().tolist())
        results[dataset_name] = {
            "loss": loss_total / len(dataset_records),
            **classification_metrics(targets, predictions),
        }

    return {
        "model_path": str(model_path),
        "split": split,
        "labels": list(LABELS),
        "datasets": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a local model separately for each manifest dataset source.")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--split", choices=("train", "validation", "test"), default="test")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = evaluate_model(args.model, args.manifest, args.data_root, args.split, args.batch_size)
    serialized = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    print(serialized)


if __name__ == "__main__":
    main()