from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.schemas.expressions import ExpressionLabel, ExpressionPrediction


SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
LABELS: tuple[ExpressionLabel, ...] = ("angry", "disgust", "fear", "happy", "sad", "surprise", "neutral")


async def predict_expression(image: UploadFile) -> ExpressionPrediction:
    if image.content_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, and WebP images are supported.",
        )

    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image file is empty.")

    if len(contents) > settings.max_image_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image file exceeds the configured size limit.",
        )

    probability = round(1 / len(LABELS), 4)
    return ExpressionPrediction(
        expression=None,
        confidence=probability,
        probabilities={label: probability for label in LABELS},
        status="model_not_configured",
        model_version="not-configured",
    )
