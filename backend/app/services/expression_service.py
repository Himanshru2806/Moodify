from fastapi import HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.schemas.expressions import ExpressionLabel, ExpressionPrediction
from app.services.expression_model import ModelNotConfiguredError, NoFaceDetectedError, get_expression_model


SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
LABELS: tuple[ExpressionLabel, ...] = ("angry", "disgust", "fear", "happy", "sad", "surprise", "neutral")


async def predict_expression(image: UploadFile) -> ExpressionPrediction:
    if image.content_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, and WebP images are supported.",
        )

    contents = await image.read(settings.max_image_bytes + 1)
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image file is empty.")

    if len(contents) > settings.max_image_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image file exceeds the configured size limit.",
        )

    try:
        classifier = get_expression_model()
    except ModelNotConfiguredError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error

    try:
        probabilities = await run_in_threadpool(classifier.predict_image, contents)
    except NoFaceDetectedError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Expression inference failed. Check the model setup and backend logs.",
        ) from error

    confidence = max(probabilities.values())
    expression = max(probabilities, key=probabilities.__getitem__)
    is_confident = confidence >= settings.model_min_confidence

    return ExpressionPrediction(
        expression=expression if is_confident else None,
        confidence=round(confidence, 4),
        probabilities={label: round(probabilities[label], 6) for label in LABELS},
        status="prediction_available" if is_confident else "uncertain",
        model_version=classifier.version,
    )
