from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
import secrets
from typing import ParamSpec, TypeVar
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.routes.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models import AuthToken, PersonalSong, User, YouTubeConnection, YouTubePlaylist, YouTubePlaylistItem
from app.schemas.personal_playlists import (
    ExpressionLabel,
    PersonalSongResponse,
    YouTubeConnectionStatus,
    YouTubeAuthorizationRequest,
    YouTubeAuthorizationStart,
    YouTubeMatch,
    YouTubeMatchSelection,
    YouTubePlaylistCreate,
    YouTubePlaylistResponse,
)
from app.services.security import hash_token
from app.services.youtube import (
    YOUTUBE_WRITE_SCOPE,
    YouTubeProviderError,
    build_authorization_url,
    create_remote_playlist,
    decrypt_refresh_token,
    encrypt_refresh_token,
    exchange_authorization_code,
    fetch_google_identity,
    insert_remote_playlist_item,
    refresh_access_token,
    revoke_refresh_token,
    search_videos,
)


router = APIRouter(prefix="/youtube", tags=["YouTube playlists"])
OAUTH_STATE_PURPOSE = "youtube_oauth_state"
OAUTH_STATE_LIFETIME = timedelta(minutes=10)
OAUTH_STATE_COOKIE = "moodify_youtube_oauth_state"
SUPPORTED_MOODS: tuple[ExpressionLabel, ...] = ("angry", "disgust", "fear", "happy", "sad", "surprise", "neutral")
ProviderParams = ParamSpec("ProviderParams")
ProviderResult = TypeVar("ProviderResult")


def _provider_call(
    callable_: Callable[ProviderParams, ProviderResult],
    *args: ProviderParams.args,
    **kwargs: ProviderParams.kwargs,
) -> ProviderResult:
    try:
        return callable_(*args, **kwargs)
    except YouTubeProviderError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error


def _connection(database: Session, user: User) -> YouTubeConnection:
    connection = database.scalar(select(YouTubeConnection).where(YouTubeConnection.user_id == user.id))
    if connection is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Connect a YouTube account before creating a playlist.")
    return connection


def _song_response(song: PersonalSong) -> PersonalSongResponse:
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


def _playlist_response(playlist: YouTubePlaylist) -> YouTubePlaylistResponse:
    items = playlist.items
    failed_ids = [item.personal_song_id for item in items if item.status == "failed" and item.personal_song_id]
    return YouTubePlaylistResponse(
        id=playlist.id,
        title=playlist.title,
        mood=playlist.mood,  # type: ignore[arg-type]
        url=f"https://www.youtube.com/playlist?list={playlist.youtube_playlist_id}",
        status=playlist.status,
        added_count=sum(item.status == "added" for item in items),
        failed_song_ids=failed_ids,
    )


def _frontend_result(result: str, mood: ExpressionLabel | None = None) -> RedirectResponse:
    params = f"youtube={quote(result)}"
    if mood is not None:
        params = f"mood={quote(mood)}&{params}"
    target = f"{settings.frontend_url.rstrip('/')}/#create-playlist?{params}"
    response = RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(
        OAUTH_STATE_COOKIE,
        path=f"{settings.api_prefix}/youtube/oauth",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/connection", response_model=YouTubeConnectionStatus)
def get_connection_status(
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> YouTubeConnectionStatus:
    connection = database.scalar(select(YouTubeConnection).where(YouTubeConnection.user_id == user.id))
    return YouTubeConnectionStatus(
        connected=connection is not None,
        google_email=connection.google_email if connection else None,
    )


@router.post("/oauth/start", response_model=YouTubeAuthorizationStart)
def start_oauth(
    payload: YouTubeAuthorizationRequest,
    response: Response,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> YouTubeAuthorizationStart:
    nonce = secrets.token_urlsafe(32)
    state = f"{nonce}.{payload.mood or '-'}"
    authorization_url = _provider_call(build_authorization_url, state)
    database.add(AuthToken(
        user_id=user.id,
        token_hash=hash_token(state),
        purpose=OAUTH_STATE_PURPOSE,
        expires_at=datetime.now(timezone.utc) + OAUTH_STATE_LIFETIME,
    ))
    database.commit()
    response.set_cookie(
        OAUTH_STATE_COOKIE,
        state,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=int(OAUTH_STATE_LIFETIME.total_seconds()),
        path=f"{settings.api_prefix}/youtube/oauth",
    )
    return YouTubeAuthorizationStart(authorization_url=authorization_url)


@router.get("/oauth/callback")
def finish_oauth(
    request: Request,
    code: str | None = Query(default=None, max_length=2048),
    state: str | None = Query(default=None, max_length=200),
    error: str | None = Query(default=None, max_length=100),
    database: Session = Depends(get_db),
) -> RedirectResponse:
    state_cookie = request.cookies.get(OAUTH_STATE_COOKIE, "")
    if not state or not secrets.compare_digest(state, state_cookie):
        return _frontend_result("invalid-state")

    state_record = database.scalar(select(AuthToken).where(
        AuthToken.token_hash == hash_token(state),
        AuthToken.purpose == OAUTH_STATE_PURPOSE,
    ))
    if state_record is None:
        return _frontend_result("invalid-state")
    mood_value = state.rsplit(".", 1)[-1]
    mood: ExpressionLabel | None = next((supported for supported in SUPPORTED_MOODS if mood_value == supported), None)
    expires_at = state_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    user = database.get(User, state_record.user_id)
    database.delete(state_record)
    database.commit()
    if user is None or expires_at <= datetime.now(timezone.utc) or not user.is_verified or user.is_suspended:
        return _frontend_result("expired")
    if error or not code:
        return _frontend_result("denied" if error == "access_denied" else "error", mood)

    try:
        tokens = _provider_call(exchange_authorization_code, code)
        granted_scope_value = tokens.get("scope")
        granted_scopes = set(str(granted_scope_value).split()) if granted_scope_value is not None else None
        if granted_scopes is not None and YOUTUBE_WRITE_SCOPE not in granted_scopes:
            return _frontend_result("scope-denied", mood)
        access_token = tokens.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            return _frontend_result("error", mood)
        identity = _provider_call(fetch_google_identity, access_token)
        refresh_token = tokens.get("refresh_token")
        connection = database.scalar(select(YouTubeConnection).where(YouTubeConnection.user_id == user.id))
        if not isinstance(refresh_token, str) or not refresh_token:
            if connection is None:
                return _frontend_result("reauthorize", mood)
            refresh_token = _provider_call(decrypt_refresh_token, connection.encrypted_refresh_token)
        encrypted = _provider_call(encrypt_refresh_token, refresh_token)
    except HTTPException:
        return _frontend_result("error", mood)
    if connection is None:
        connection = YouTubeConnection(user_id=user.id, google_subject=identity["sub"], encrypted_refresh_token=encrypted)
        database.add(connection)
    connection.google_subject = identity["sub"]
    connection.google_email = identity.get("email") if isinstance(identity.get("email"), str) else None
    connection.encrypted_refresh_token = encrypted
    database.commit()
    return _frontend_result("connected", mood)


@router.delete("/connection", response_model=YouTubeConnectionStatus)
def disconnect_youtube(
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> YouTubeConnectionStatus:
    connection = database.scalar(select(YouTubeConnection).where(YouTubeConnection.user_id == user.id))
    if connection is None:
        return YouTubeConnectionStatus(connected=False)
    remote_revoked = True
    try:
        refresh_token = _provider_call(decrypt_refresh_token, connection.encrypted_refresh_token)
        _provider_call(revoke_refresh_token, refresh_token)
    except HTTPException:
        remote_revoked = False
    database.delete(connection)
    database.commit()
    return YouTubeConnectionStatus(connected=False, remote_revoked=remote_revoked)


@router.get("/playlists", response_model=list[YouTubePlaylistResponse])
def list_created_playlists(
    mood: ExpressionLabel | None = Query(default=None),
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> list[YouTubePlaylistResponse]:
    query = select(YouTubePlaylist).options(selectinload(YouTubePlaylist.items)).where(YouTubePlaylist.user_id == user.id)
    if mood is not None:
        query = query.where(YouTubePlaylist.mood == mood)
    playlists = database.scalars(query.order_by(YouTubePlaylist.created_at.desc())).all()
    return [_playlist_response(playlist) for playlist in playlists]


@router.get("/songs/{song_id}/matches", response_model=list[YouTubeMatch])
def find_song_matches(
    song_id: str,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> list[YouTubeMatch]:
    song = database.scalar(select(PersonalSong).where(PersonalSong.id == song_id, PersonalSong.user_id == user.id))
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found.")
    if not song.artist:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Add the artist before searching for this song.")
    return [YouTubeMatch(
        video_id=match["video_id"],
        title=match["title"],
        channel_title=match["channel_title"],
        thumbnail_url=match["thumbnail_url"],
    ) for match in _provider_call(search_videos, song.title, song.artist)]


@router.put("/songs/{song_id}/match", response_model=PersonalSongResponse)
def choose_song_match(
    song_id: str,
    payload: YouTubeMatchSelection,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> PersonalSongResponse:
    song = database.scalar(select(PersonalSong).where(PersonalSong.id == song_id, PersonalSong.user_id == user.id))
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found.")
    if not song.artist:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Add the artist before confirming a match.")
    matches = _provider_call(search_videos, song.title, song.artist)
    match = next((item for item in matches if item["video_id"] == payload.video_id), None)
    if match is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose a video from the current search results.")
    song.youtube_video_id = str(match["video_id"])
    song.youtube_video_title = str(match["title"])
    song.youtube_channel_title = str(match["channel_title"])
    song.youtube_thumbnail_url = match["thumbnail_url"]
    database.commit()
    database.refresh(song)
    return _song_response(song)


@router.post("/playlists", response_model=YouTubePlaylistResponse, status_code=status.HTTP_201_CREATED)
def create_mood_playlist(
    payload: YouTubePlaylistCreate,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> YouTubePlaylistResponse:
    connection = _connection(database, user)
    songs = database.scalars(select(PersonalSong).where(
        PersonalSong.user_id == user.id,
        PersonalSong.mood == payload.mood,
    ).order_by(PersonalSong.position, PersonalSong.created_at, PersonalSong.id)).all()
    if not songs:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Add songs to this mood before creating a playlist.")
    if len(songs) > 50:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A single YouTube playlist can include at most 50 saved songs.")
    incomplete = [song.id for song in songs if not song.artist or not song.youtube_video_id]
    if incomplete:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "Add an artist and confirm a YouTube match for every song in this mood first.", "song_ids": incomplete},
        )

    refresh_token = _provider_call(decrypt_refresh_token, connection.encrypted_refresh_token)
    access_token = _provider_call(refresh_access_token, refresh_token)
    remote_id = _provider_call(
        create_remote_playlist,
        access_token,
        payload.title,
        f"Created with Moodify for the {payload.mood} mood.",
    )
    playlist = YouTubePlaylist(
        user_id=user.id,
        mood=payload.mood,
        title=payload.title,
        youtube_playlist_id=remote_id,
        status="creating",
    )
    items: list[YouTubePlaylistItem] = []
    for index, song in enumerate(songs, start=1):
        if not song.artist or not song.youtube_video_id:
            continue
        items.append(YouTubePlaylistItem(
            personal_song_id=song.id,
            youtube_video_id=song.youtube_video_id,
            title=song.youtube_video_title or song.title,
            artist=song.artist,
            position=index,
            status="pending",
        ))
    playlist.items = items
    database.add(playlist)
    database.commit()
    database.refresh(playlist)

    failed_song_ids: list[str] = []
    for index, item in enumerate(items):
        try:
            _provider_call(insert_remote_playlist_item, access_token, remote_id, item.youtube_video_id)
            item.status = "added"
            database.commit()
        except HTTPException:
            failed_song_ids = [remaining.personal_song_id for remaining in items[index:] if remaining.personal_song_id]
            for remaining in items[index:]:
                remaining.status = "failed"
            playlist.status = "partial"
            database.commit()
            break
    else:
        playlist.status = "created"
        database.commit()

    response = _playlist_response(playlist)
    response.failed_song_ids = failed_song_ids
    return response


@router.post("/playlists/{playlist_id}/retry", response_model=YouTubePlaylistResponse)
def retry_failed_playlist_items(
    playlist_id: str,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> YouTubePlaylistResponse:
    playlist = database.scalar(select(YouTubePlaylist).options(selectinload(YouTubePlaylist.items)).where(
        YouTubePlaylist.id == playlist_id,
        YouTubePlaylist.user_id == user.id,
    ))
    if playlist is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found.")
    failed_items = [item for item in playlist.items if item.status == "failed"]
    if not failed_items:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This playlist has no failed tracks to retry.")
    connection = _connection(database, user)
    access_token = _provider_call(
        refresh_access_token,
        _provider_call(decrypt_refresh_token, connection.encrypted_refresh_token),
    )
    for index, item in enumerate(failed_items):
        try:
            _provider_call(insert_remote_playlist_item, access_token, playlist.youtube_playlist_id, item.youtube_video_id)
            item.status = "added"
            database.commit()
        except HTTPException:
            for remaining in failed_items[index:]:
                remaining.status = "failed"
            playlist.status = "partial"
            database.commit()
            break
    else:
        playlist.status = "created"
        database.commit()
    return _playlist_response(playlist)
