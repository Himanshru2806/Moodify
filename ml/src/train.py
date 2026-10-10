from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import random

import torch
from torch.utils.data import DataLoader, WeightedRandomSampler
from transformers import AutoImageProcessor

from ml.src.dataset import ExpressionImageDataset, ManifestRecord, load_manifest
from ml.src.labels import LABELS
from ml.src.metrics import classification_metrics
from ml.src.models import load_aligned_model


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _evaluate(model: torch.nn.Module, loader: DataLoader, device: torch.device) -> tuple[float, dict[str, object]]:
    model.eval()
    total_loss = 0.0
    targets: list[int] = []
    predictions: list[int] = []
    with torch.inference_mode():
        for pixel_values, target_distributions in loader:
            pixel_values = pixel_values.to(device)
            target_distributions = target_distributions.to(device)
            logits = model(pixel_values=pixel_values).logits
            loss = -(target_distributions * torch.log_softmax(logits, dim=-1)).sum(dim=-1).mean()
            total_loss += float(loss) * pixel_values.shape[0]
            targets.extend(target_distributions.argmax(dim=-1).cpu().tolist())
            predictions.extend(logits.argmax(dim=-1).cpu().tolist())
    metrics = classification_metrics(targets, predictions)
    return total_loss / len(loader.dataset), metrics


def train_model(
    manifest_path: Path,
    data_root: Path,
    base_model: Path,
    output_dir: Path,
    epochs: int = 3,
    batch_size: int = 16,
    learning_rate: float = 2e-5,
    seed: int = 17,
    base_model_revision: str = "unspecified-local-checkpoint",
) -> dict[str, object]:
    if epochs < 1 or batch_size < 1 or learning_rate <= 0:
        raise ValueError("epochs and batch size must be positive, and learning rate must be positive")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(f"Refusing to overwrite a non-empty model directory: {output_dir}")

    records = load_manifest(manifest_path, data_root)
    train_records = [record for record in records if record.split == "train"]
    validation_records = [record for record in records if record.split == "validation"]
    test_records = [record for record in records if record.split == "test"]
    if not train_records or not validation_records or not test_records:
        raise ValueError("Training requires non-empty train, validation, and test splits")

    seed_everything(seed)
    processor = AutoImageProcessor.from_pretrained(str(base_model), local_files_only=True, use_fast=False)
    model = load_aligned_model(str(base_model))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    source_counts = Counter(record.dataset for record in train_records)
    sample_weights = [1.0 / source_counts[record.dataset] for record in train_records]
    source_balanced_sampler = WeightedRandomSampler(
        sample_weights, num_samples=len(train_records), replacement=True
    )
    train_loader = DataLoader(
        ExpressionImageDataset(train_records, processor),
        batch_size=batch_size,
        sampler=source_balanced_sampler,
        num_workers=0,
    )
    validation_loader = DataLoader(
        ExpressionImageDataset(validation_records, processor), batch_size=batch_size, shuffle=False, num_workers=0
    )
    test_loader = DataLoader(
        ExpressionImageDataset(test_records, processor), batch_size=batch_size, shuffle=False, num_workers=0
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    best_macro_f1 = -1.0
    best_epoch = 0
    history: list[dict[str, object]] = []

    for epoch in range(1, epochs + 1):
        model.train()
        for pixel_values, target_distributions in train_loader:
            pixel_values = pixel_values.to(device)
            target_distributions = target_distributions.to(device)
            logits = model(pixel_values=pixel_values).logits
            loss = -(target_distributions * torch.log_softmax(logits, dim=-1)).sum(dim=-1).mean()
            loss.backward()
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

        validation_loss, validation_metrics = _evaluate(model, validation_loader, device)
        history.append({"epoch": epoch, "validation_loss": validation_loss, **validation_metrics})
        current_macro_f1 = float(validation_metrics["macro_f1"])
        if current_macro_f1 > best_macro_f1:
            best_macro_f1 = current_macro_f1
            best_epoch = epoch
            output_dir.mkdir(parents=True, exist_ok=True)
            model.save_pretrained(output_dir, safe_serialization=True)
            processor.save_pretrained(output_dir)

    # Test data is only evaluated after validation-based checkpoint selection is complete.
    best_model = load_aligned_model(str(output_dir)).to(device)
    test_loss, test_metrics = _evaluate(best_model, test_loader, device)
    dataset_sources: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for record in records:
        dataset_sources[record.dataset][record.split] += 1
    manifest_sha256 = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    model_sha256 = hashlib.sha256((output_dir / "model.safetensors").read_bytes()).hexdigest()
    metadata = {
        "base_model": base_model.name,
        "base_model_revision": base_model_revision,
        "manifest_sha256": manifest_sha256,
        "model_sha256": model_sha256,
        "label_order": list(LABELS),
        "seed": seed,
        "epochs_requested": epochs,
        "best_epoch": best_epoch,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "device": str(device),
        "dataset_split_counts": {name: dict(counts) for name, counts in sorted(dataset_sources.items())},
        "validation_history": history,
        "held_out_test": {"loss": test_loss, **test_metrics},
        "warning": "Review dataset terms and independent evaluation before any deployment.",
    }
    (output_dir / "moodify_training_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune a local Hugging Face expression checkpoint.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--base-model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--base-model-revision", default="unspecified-local-checkpoint")
    args = parser.parse_args()
    result = train_model(
        args.manifest,
        args.data_root,
        args.base_model,
        args.output_dir,
        args.epochs,
        args.batch_size,
        args.learning_rate,
        args.seed,
        args.base_model_revision,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()