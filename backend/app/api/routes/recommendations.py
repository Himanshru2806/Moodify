from fastapi import APIRouter

from app.schemas.recommendations import RecommendationRequest, RecommendationResponse
from app.services.recommendation_service import recommend_tracks


router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.post("", response_model=RecommendationResponse)
def create_recommendations(request: RecommendationRequest) -> RecommendationResponse:
    return recommend_tracks(request)
