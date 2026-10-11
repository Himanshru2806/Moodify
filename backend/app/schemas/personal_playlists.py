from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


ExpressionLabel = Literal["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]


class PersonalSongCreate(BaseModel):
    mood: ExpressionLabel
    title: str = Field(min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Song title cannot be blank.")
        return title


class PersonalSongResponse(BaseModel):
    id: str
    mood: ExpressionLabel
    title: str
    position: int
    created_at: datetime
