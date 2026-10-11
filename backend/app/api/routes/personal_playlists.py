from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.database import get_db
from app.models import PersonalSong, User
from app.schemas.personal_playlists import ExpressionLabel, PersonalSongCreate, PersonalSongResponse, PersonalSongUpdate


router = APIRouter(prefix="/personal-playlists/songs", tags=["personal playlists"])


def _response(song: PersonalSong) -> PersonalSongResponse:
    return PersonalSongResponse(
        id=song.id,
        mood=song.mood,  # type: ignore[arg-type]
        title=song.title,
        artist=song.artist,
        youtube_video_id=song.youtube_video_id,
        youtube_video_title=song.youtube_video_title,
        youtube_channel_title=song.youtube_channel_title,
        youtube_thumbnail_url=song.youtube_thumbnail_url,
        position=song.position,
        created_at=song.created_at,
    )


@router.get("", response_model=list[PersonalSongResponse])
def list_personal_songs(
    mood: ExpressionLabel | None = Query(default=None),
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> list[PersonalSongResponse]:
    query = select(PersonalSong).where(PersonalSong.user_id == user.id)
    if mood is not None:
        query = query.where(PersonalSong.mood == mood)
    songs = database.scalars(query.order_by(PersonalSong.mood, PersonalSong.position, PersonalSong.created_at, PersonalSong.id)).all()
    return [_response(song) for song in songs]


@router.post("", response_model=PersonalSongResponse, status_code=status.HTTP_201_CREATED)
def add_personal_song(
    payload: PersonalSongCreate,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> PersonalSongResponse:
    next_position = (database.scalar(select(func.coalesce(func.max(PersonalSong.position), 0)).where(
        PersonalSong.user_id == user.id, PersonalSong.mood == payload.mood
    )) or 0) + 1
    song = PersonalSong(user_id=user.id, mood=payload.mood, title=payload.title, artist=payload.artist, position=next_position)
    database.add(song)
    database.commit()
    database.refresh(song)
    return _response(song)


@router.put("/{song_id}", response_model=PersonalSongResponse)
def update_personal_song(
    song_id: str,
    payload: PersonalSongUpdate,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> PersonalSongResponse:
    song = database.scalar(select(PersonalSong).where(PersonalSong.id == song_id, PersonalSong.user_id == user.id))
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found.")
    if song.title != payload.title or song.artist != payload.artist:
        song.youtube_video_id = None
        song.youtube_video_title = None
        song.youtube_channel_title = None
        song.youtube_thumbnail_url = None
    song.title = payload.title
    song.artist = payload.artist
    database.commit()
    database.refresh(song)
    return _response(song)


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_personal_song(
    song_id: str,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> None:
    song = database.scalar(select(PersonalSong).where(PersonalSong.id == song_id, PersonalSong.user_id == user.id))
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found.")
    database.delete(song)
    database.commit()
