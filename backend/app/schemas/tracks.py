from pydantic import BaseModel, Field


class Track(BaseModel):
    id: str
    title: str
    artist: str
    language: str
    genre: str
    energy: float = Field(ge=0, le=1)
    tags: list[str]
    source_url: str | None = None
