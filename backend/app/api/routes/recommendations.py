from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import ProductSetting
from app.schemas.recommendations import RecommendationRequest, RecommendationResponse
from app.services.catalogue import load_tracks
from app.services.recommendation_service import recommend_tracks


router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.post("", response_model=RecommendationResponse)
def create_recommendations(request: RecommendationRequest, database: Session = Depends(get_db)) -> RecommendationResponse:
    record = database.get(ProductSetting, "recommendation_weights")
    return recommend_tracks(request, load_tracks(database), record.value if record else None)
