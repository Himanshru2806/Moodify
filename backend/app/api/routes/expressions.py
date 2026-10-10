from fastapi import APIRouter, File, UploadFile

from app.schemas.expressions import ExpressionPrediction
from app.services.expression_service import predict_expression


router = APIRouter(prefix="/expressions", tags=["expressions"])


@router.post("/predict", response_model=ExpressionPrediction)
async def predict_expression_from_image(image: UploadFile = File(...)) -> ExpressionPrediction:
    return await predict_expression(image)
