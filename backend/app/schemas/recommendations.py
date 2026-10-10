from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.expressions import ExpressionLabel
from app.schemas.tracks import Track


ListeningGoal = Literal[
    "comfort_me",
    "lift_my_mood",
    "match_my_current_vibe",
    "help_me_relax",
    "energize_me",
    "help_me_focus",
]


class RecommendationRequest(BaseModel):
    expression: ExpressionLabel | None = None
    listening_goal: ListeningGoal
    languages: list[str] = Field(default_factory=list)
    genres: list[str] = Field(default_factory=list)
    limit: int = Field(default=10, ge=1, le=50)


class RecommendationItem(BaseModel):
    track: Track
    rank: int
    score: float
    reasons: list[str]


class RecommendationResponse(BaseModel):
    listening_goal: ListeningGoal
    expression: ExpressionLabel | None
    items: list[RecommendationItem]
