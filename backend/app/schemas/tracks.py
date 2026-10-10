from pydantic import BaseModel, Field

from app.schemas.expressions import ExpressionLabel


class Track(BaseModel):
    id: str
    title: str
    artist: str
    language: str
    genre: str
    energy: float = Field(ge=0, le=1)
    tags: list[str]
    expression_affinities: dict[ExpressionLabel, float] = Field(default_factory=dict)
    source_url: str | None = None
