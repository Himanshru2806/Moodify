from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.schemas.tracks import Track


AdminRole = Literal["user", "admin", "super_user"]


class AdminUserResponse(BaseModel):
    id: str
    email: EmailStr
    display_name: str
    username: str
    role: AdminRole
    is_verified: bool
    is_suspended: bool
    created_at: datetime


class RoleUpdate(BaseModel):
    role: AdminRole


class SuspensionUpdate(BaseModel):
    suspended: bool


class AdminMetricsResponse(BaseModel):
    users_total: int
    users_verified: int
    users_suspended: int
    songs_total: int


class AdminAuditResponse(BaseModel):
    id: str
    actor_user_id: str | None
    target_user_id: str | None
    action: str
    details: str
    created_at: datetime


class RecommendationWeights(BaseModel):
    goal_tag_weight: float = Field(default=2.0, ge=0, le=5)
    language_match_weight: float = Field(default=1.0, ge=0, le=5)
    genre_match_weight: float = Field(default=1.0, ge=0, le=5)
    expression_affinity_weight: float = Field(default=0.5, ge=0, le=5)
    energy_weight: float = Field(default=1.0, ge=0, le=5)


class AdminStatusResponse(BaseModel):
    status: str
    environment: str
    api_version: str
    database: str


class MessageResponse(BaseModel):
    message: str


class UserSearch(BaseModel):
    q: str | None = Field(default=None, max_length=100)