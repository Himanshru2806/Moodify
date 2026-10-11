from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


ExpressionLabel = Literal["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]


class PersonalSongCreate(BaseModel):
    mood: ExpressionLabel
    title: str = Field(min_length=1, max_length=200)
    artist: str | None = Field(default=None, max_length=200)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Song title cannot be blank.")
        return title

    @field_validator("artist")
    @classmethod
    def artist_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        artist = value.strip()
        if not artist:
            raise ValueError("Artist cannot be blank when provided.")
        return artist


class PersonalSongUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    artist: str = Field(min_length=1, max_length=200)

    @field_validator("title", "artist")
    @classmethod
    def fields_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Song title and artist cannot be blank.")
        return normalized


class PersonalSongResponse(BaseModel):
    id: str
    mood: ExpressionLabel
    title: str
    artist: str | None = None
    youtube_video_id: str | None = None
    youtube_video_title: str | None = None
    youtube_channel_title: str | None = None
    youtube_thumbnail_url: str | None = None
    position: int
    created_at: datetime


class YouTubeMatch(BaseModel):
    video_id: str
    title: str
    channel_title: str
    thumbnail_url: str | None = None


class YouTubeMatchSelection(BaseModel):
    video_id: str = Field(min_length=1, max_length=32)


class YouTubeConnectionStatus(BaseModel):
    connected: bool
    google_email: str | None = None
    remote_revoked: bool | None = None


class YouTubeAuthorizationStart(BaseModel):
    authorization_url: str


class YouTubeAuthorizationRequest(BaseModel):
    mood: ExpressionLabel | None = None


class YouTubePlaylistCreate(BaseModel):
    mood: ExpressionLabel
    title: str = Field(min_length=1, max_length=150)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Playlist title cannot be blank.")
        return title


class YouTubePlaylistResponse(BaseModel):
    id: str
    title: str
    mood: ExpressionLabel
    url: str
    status: str
    added_count: int
    failed_song_ids: list[str]
