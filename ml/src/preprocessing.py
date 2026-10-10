from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps


MAX_IMAGE_PIXELS = 20_000_000


class FaceCropError(ValueError):
    """Raised when an input cannot be converted to the backend's face crop."""


def extract_largest_frontal_face(image: Image.Image) -> Image.Image:
    """Mirror the backend Haar crop so training/evaluation inputs match inference."""
    image = ImageOps.exif_transpose(image).convert("RGB")
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise FaceCropError("Image dimensions exceed the configured pixel limit")

    cv2.ocl.setUseOpenCL(False)
    grayscale = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    detector = cv2.CascadeClassifier(str(cascade_path))
    if detector.empty():
        raise RuntimeError("The OpenCV frontal-face detector could not be loaded")

    faces = detector.detectMultiScale(grayscale, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
    if len(faces) == 0:
        raise FaceCropError("No detectable frontal face in dataset image")

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