# Moodify ML Workspace

The backend continues to use the pinned pretrained checkpoint. This workspace now has an initial, manifest-based
fine-tuning and evaluation scaffold; it does not download datasets or change the production model. Nothing here means
the upstream model was trained or evaluated by Moodify.

## Dataset gate and privacy

Before acquiring data, review the dataset's official terms for this project's intended use, local training, deployment,
redistribution, and any required access approval. Do not commit raw datasets, photos, credentials, or trained weights.
The repository ignores `data/datasets/` and `ml/checkpoints/`. User uploads and corrections are not part of this
shared training pipeline. The frontend has an optional, per-photo browser-local contribution list, but it is not
connected to this trainer and must never be copied into shared training. It is not account-isolated or encrypted, so
avoid shared browser profiles. No personal model training is implemented yet.

Possible sources require different treatment:

- AffectNet is a candidate for in-the-wild still-image fine-tuning only if its access terms permit this use.
- FER+ re-annotates FER-2013 images with multiple annotator votes; it is useful for ambiguity/soft-label experiments,
	but is not an independent image source from FER-2013.
- FERV39k is video data; keep it for a separate video-domain evaluation or later temporal-model experiment rather
	than treating correlated frames as independent still images.

None of these datasets is guaranteed to be recent or to improve webcam performance. Facial-expression labels describe
annotated visible categories; they do not establish internal emotional state. Visible teeth must not be used as a
standalone rule for assigning `happy`.

## Manifest format

Create a local CSV based on `ml/data/manifest.template.csv`. Required columns are `image_path`, `split`, and `dataset`.
Use `group_id` for a subject or source-video identifier when available. Labels may use a categorical `label` column or
seven normalized probability columns named `angry`, `disgust`, `fear`, `happy`, `sad`, `surprise`, and `neutral`.
Categorical aliases `anger`, `happiness`, and `sadness` are normalized; unmapped categories such as `contempt` are
rejected instead of guessed. Soft distributions are normalized and used by the training loss. Keep source labels and
any conversion decisions in dataset-specific manifests/notes.

The manifest must include `train`, `validation`, and `test` records. Relative image paths resolve under the supplied
data root. The loader validates image files, exact-path split reuse, and `dataset` + `group_id` leakage between splits.
It cannot detect near-duplicate images or identity overlap across sources; perform those audits separately. Split by
person/video before creating the manifest, and keep official test splits untouched. Training and evaluation apply the
same largest-frontal-face Haar crop parameters as the backend, then use the checkpoint's Hugging Face image processor.
The current detector can miss profiles or low-quality faces; audit/review crop failures rather than silently relabeling
or dropping them.

Dataset downloads are not included. The FER-2013/FER+ adapter is local-only and should be run only after the official
terms have been reviewed. Other dataset sources still require their own reviewed adapters. `--check-faces` on the
audit command optionally reports how many images fail the backend-compatible face crop; it can be slow on large sets.

## FER-2013 / FER+ conversion

The adapter expects locally acquired FER-2013 CSV columns `emotion`, `pixels`, and `Usage`; it maps the published
seven numeric classes and `Training` / `PublicTest` / `PrivateTest` splits. FER+ is optional and expects its
`fer2013new.csv` vote columns plus `Usage`, aligned row-for-row with the FER-2013 CSV. The converter checks row count
and that `Usage` agrees for each paired row. It writes separate `fer2013_manifest.csv` and `ferplus_manifest.csv` files
and separate PNG caches so users do not accidentally treat FER+ re-annotations as additional independent images.

FER+ vote counts for Moodify's seven shared classes are kept as soft labels and renormalized. Votes for `contempt`,
`unknown`, and `NF` are not mapped; a row is excluded when mapped votes account for less than the configured fraction
(default 0.5) of all votes. The conversion report records excluded rows and mapped/unmapped vote totals. FER-2013 does
not provide subject identifiers in this format, so the adapter cannot guarantee identity-independent splits; preserve
the provided official splits and report this limitation. Do not merge the FER-2013 and FER+ manifests into one training
set without a deliberate duplicate/annotation policy.

After reviewing official access/use terms, run from the repository root:

`python -m ml.src.converters.fer2013 --fer2013-csv <local-fer2013.csv> --output-dir data/datasets/converted/fer2013 --confirm-dataset-terms-reviewed`

Add `--ferplus-csv <local-fer2013new.csv>` to also generate the FER+ annotation manifest, or adjust
`--minimum-mapped-vote-fraction` after documenting the choice. The confirmation flag records the operator's assertion;
it does not check a license or grant permission. Generated PNGs/manifests belong in the ignored local dataset area.

## Local workflow

From the repository root, install `ml/requirements-train.txt` into a separate training environment. No training,
download, or dependency installation is run as part of the application startup.

1. Audit a prepared local manifest with `python -m ml.src.audit_data --manifest <manifest.csv> --data-root <dataset-root>`; add `--check-faces` to test crop compatibility.
2. Measure a baseline on the held-out split with `python -m ml.src.evaluate --model <local-checkpoint> --manifest <manifest.csv> --data-root <dataset-root> --split test`.
3. Fine-tune with `python -m ml.src.train --base-model <local-checkpoint> --base-model-revision <revision> --manifest <manifest.csv> --data-root <dataset-root> --output-dir ml/checkpoints/<experiment>`.
4. Compare the candidate with the baseline on the same, untouched test manifest using the evaluation command.

The trainer samples dataset sources with equal expected weight so a much larger source does not dominate solely by row
count. Class imbalance within each source is not currently balanced. Validation macro-F1 selects the saved checkpoint;
the test split is evaluated after checkpoint selection. Checkpoint metadata records label order, manifest/model hashes,
source split counts, configuration, and test metrics. It does not replace the backend model automatically. Review the
terms, metrics, condition-specific failures, inference preprocessing compatibility, and model card before considering
any deployment.

For soft-label sources, the training loss uses the full normalized distribution; accuracy/F1 use its argmax as the
reference class, so review per-source metrics alongside reported loss and annotation disagreement.

Routine synthetic tests can run without downloading any private datasets: `python -m pytest ml/tests`.
