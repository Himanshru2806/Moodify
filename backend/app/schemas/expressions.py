from typing import Literal

from pydantic import BaseModel, Field


ExpressionLabel = Literal["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]
PredictionStatus = Literal["prediction_available", "uncertain", "model_not_configured"]


class ExpressionPrediction(BaseModel):
    expression: ExpressionLabel | None
    confidence: float = Field(ge=0, le=1)
    probabilities: dict[ExpressionLabel, float]
    status: PredictionStatus
    model_version: str
