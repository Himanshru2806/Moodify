from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, cast

from app.core.config import settings
from app.schemas.expressions import ExpressionLabel

if TYPE_CHECKING:
    from PIL import Image


MODEL_REPOSITORY = "trpakov/vit-face-expression"
MODEL_REVISION = "ef0bc6fc34241b6587e7e009e7711357be28c024"
MODEL_VERSION = "trpakov-vit-face-expression@ef0bc6fc3424"
LABELS: tuple[ExpressionLabel, ...] = ("angry", "disgust", "fear", "happy", "sad", "surprise", "neutral")


class ModelNotConfiguredError(RuntimeError):
    """Raised when the pinned classifier artifact has not been set up locally."""


class NoFaceDetectedError(ValueError):
    """Raised when the uploaded photo does not contain a detectable frontal face."""


class ExpressionModel:
    def __init__(self, model_dir: Path) -> None:
        from transformers import AutoImageProcessor, AutoModelForImageClassification

        self.version = MODEL_VERSION
        self.processor = AutoImageProcessor.from_pretrained(
            str(model_dir),
            local_files_only=True,
            use_fast=False,
        )
        self.model = AutoModelForImageClassification.from_pretrained(str(model_dir), local_files_only=True)
        id2label = self.model.config.id2label
        self.labels = {int(index): str(label).strip().lower() for index, label in id2label.items()}
        if set(self.labels.values()) != set(LABELS):
            raise RuntimeError("The configured model does not expose the expected seven expression labels.")

        import torch

        self.torch = torch
        torch.set_num_threads(settings.model_num_threads)
        self.model.to("cpu")
        self.model.eval()
        self._inference_lock = Lock()

    def predict_image(self, contents: bytes) -> dict[ExpressionLabel, float]:
        face = self._extract_face(contents)
        inputs = self.processor(images=face, return_tensors="pt")

        with self._inference_lock, self.torch.inference_mode():
            logits = self.model(**inputs).logits[0]
            scores = self.torch.softmax(logits, dim=-1).tolist()

        return {
            cast(ExpressionLabel, self.labels[index]): float(scores[index])
            for index in range(len(scores))
        }

    @staticmethod
    def _extract_face(contents: bytes) -> Image.Image:
        import cv2
        import numpy as np
        from PIL import Image, ImageOps, UnidentifiedImageError

        cv2.ocl.setUseOpenCL(False)
        try:
            with Image.open(BytesIO(contents)) as source:
                if source.width * source.height > settings.max_image_pixels:
                    raise ValueError("Image dimensions exceed the configured pixel limit.")
                image = ImageOps.exif_transpose(source).convert("RGB")
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise ValueError("The uploaded file is not a valid supported image.") from error

        image_array = np.asarray(image)
        grayscale = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)
        cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        detector = cv2.CascadeClassifier(str(cascade_path))
        if detector.empty():
            raise RuntimeError("The OpenCV frontal-face detector could not be loaded.")

        faces = detector.detectMultiScale(grayscale, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
        if len(faces) == 0:
            raise NoFaceDetectedError("No face was detected. Try a clear, front-facing photo with good lighting.")

        x, y, width, height = max(faces, key=lambda face_box: int(face_box[2]) * int(face_box[3]))
        side = int(max(width, height) * 1.25)
        center_x, center_y = x + width // 2, y + height // 2
        left = max(0, center_x - side // 2)
        top = max(0, center_y - side // 2)
        right = min(image.width, left + side)
        bottom = min(image.height, top + side)
        left = max(0, right - side)
        top = max(0, bottom - side)
        return image.crop((left, top, right, bottom))


@lru_cache(maxsize=1)
def get_expression_model() -> ExpressionModel:
    model_dir = settings.model_dir
    required_files = (model_dir / "config.json", model_dir / "preprocessor_config.json", model_dir / "model.safetensors")
    if not all(path.is_file() for path in required_files):
        raise ModelNotConfiguredError(
            "The expression model is not installed. From the backend directory, run "
            "`python -m app.services.model_download` and restart the API."
        )

    try:
        return ExpressionModel(model_dir)
    except Exception as error:
        raise ModelNotConfiguredError(f"Could not load the local expression model: {error}") from error