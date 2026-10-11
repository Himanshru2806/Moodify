from __future__ import annotations

from typing import Any, TypedDict, cast
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
YOUTUBE_WRITE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl"
GOOGLE_IDENTITY_SCOPES = ("openid", "email")


class YouTubeVideoMatch(TypedDict):
    video_id: str
    title: str
    channel_title: str
    thumbnail_url: str | None


class YouTubeProviderError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def oauth_is_configured() -> bool:
    return bool(
        settings.youtube_client_id
        and settings.youtube_client_secret
        and settings.youtube_redirect_uri
        and settings.youtube_token_encryption_key
    )


def require_oauth_config() -> None:
    _oauth_configuration()


def _oauth_configuration() -> tuple[str, str, str, str]:
    client_id = settings.youtube_client_id
    client_secret = settings.youtube_client_secret
    redirect_uri = settings.youtube_redirect_uri
    encryption_key = settings.youtube_token_encryption_key
    if not client_id or not client_secret or not redirect_uri or not encryption_key:
        raise YouTubeProviderError("YouTube authorization is not configured on this server.", 503)
    try:
        Fernet(encryption_key.encode())
    except ValueError as error:
        raise YouTubeProviderError("YouTube token encryption is not configured correctly.", 503) from error
    return client_id, client_secret, redirect_uri, encryption_key


def require_search_config() -> None:
    if not settings.youtube_api_key:
        raise YouTubeProviderError("YouTube search is not configured on this server.", 503)


def encrypt_refresh_token(token: str) -> str:
    _, _, _, encryption_key = _oauth_configuration()
    return Fernet(encryption_key.encode()).encrypt(token.encode()).decode()


def decrypt_refresh_token(token: str) -> str:
    _, _, _, encryption_key = _oauth_configuration()
    try:
        return Fernet(encryption_key.encode()).decrypt(token.encode()).decode()
    except (InvalidToken, ValueError) as error:
        raise YouTubeProviderError("The stored YouTube connection cannot be decrypted; reconnect the account.", 503) from error


def build_authorization_url(state: str) -> str:
    client_id, _, redirect_uri, _ = _oauth_configuration()
    params: dict[str, str] = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join((*GOOGLE_IDENTITY_SCOPES, YOUTUBE_WRITE_SCOPE)),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"


def _check_response(response: httpx.Response, operation: str) -> dict[str, Any]:
    try:
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError) as error:
        status_code = response.status_code if response.status_code >= 400 else 502
        raise YouTubeProviderError(f"YouTube provider {operation} failed.", status_code) from error
    if not isinstance(body, dict):
        raise YouTubeProviderError(f"YouTube provider returned an invalid {operation} response.")
    return cast(dict[str, Any], body)


def exchange_authorization_code(code: str) -> dict[str, Any]:
    client_id, client_secret, redirect_uri, _ = _oauth_configuration()
    try:
        response = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
    except httpx.HTTPError as error:
        raise YouTubeProviderError("Could not complete Google authorization.", 503) from error
    return _check_response(response, "authorization")


def fetch_google_identity(access_token: str) -> dict[str, Any]:
    try:
        response = httpx.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
    except httpx.HTTPError as error:
        raise YouTubeProviderError("Could not verify the connected Google account.", 503) from error
    identity = _check_response(response, "account verification")
    if not isinstance(identity.get("sub"), str) or not identity["sub"]:
        raise YouTubeProviderError("Google did not return an account identifier.")
    return identity


def refresh_access_token(refresh_token: str) -> str:
    client_id, client_secret, _, _ = _oauth_configuration()
    try:
        response = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "refresh_token",
            },
            timeout=15,
        )
    except httpx.HTTPError as error:
        raise YouTubeProviderError("Could not refresh YouTube authorization.", 503) from error
    token = _check_response(response, "token refresh").get("access_token")
    if not isinstance(token, str) or not token:
        raise YouTubeProviderError("Google did not return an access token.", 503)
    return token


def revoke_refresh_token(refresh_token: str) -> None:
    _oauth_configuration()
    try:
        response = httpx.post(GOOGLE_REVOKE_URL, data={"token": refresh_token}, timeout=10)
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise YouTubeProviderError("Google could not revoke the YouTube connection.", 503) from error


def search_videos(title: str, artist: str, limit: int = 5) -> list[YouTubeVideoMatch]:
    require_search_config()
    api_key = settings.youtube_api_key
    assert api_key is not None
    try:
        response = httpx.get(
            f"{YOUTUBE_API_BASE}/search",
            params={
                "part": "snippet",
                "type": "video",
                "maxResults": min(max(limit, 1), 10),
                "q": f"{title} {artist}",
                "key": api_key,
            },
            timeout=15,
        )
    except httpx.HTTPError as error:
        raise YouTubeProviderError("YouTube search is temporarily unavailable.", 503) from error
    payload = _check_response(response, "search")
    matches: list[YouTubeVideoMatch] = []
    for item in payload.get("items", []):
        video_id = item.get("id", {}).get("videoId")
        snippet = item.get("snippet", {})
        thumbnails = snippet.get("thumbnails", {})
        thumbnail = thumbnails.get("medium", {}).get("url") or thumbnails.get("default", {}).get("url")
        if isinstance(video_id, str) and isinstance(snippet.get("title"), str):
            matches.append({
                "video_id": video_id,
                "title": snippet["title"][:500],
                "channel_title": str(snippet.get("channelTitle", ""))[:200],
                "thumbnail_url": thumbnail if isinstance(thumbnail, str) else None,
            })
    return matches


def create_remote_playlist(access_token: str, title: str, description: str) -> str:
    try:
        response = httpx.post(
            f"{YOUTUBE_API_BASE}/playlists",
            params={"part": "snippet,status"},
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "snippet": {"title": title, "description": description},
                "status": {"privacyStatus": "private"},
            },
            timeout=20,
        )
    except httpx.HTTPError as error:
        raise YouTubeProviderError("Could not create the YouTube playlist.", 503) from error
    playlist_id = _check_response(response, "playlist creation").get("id")
    if not isinstance(playlist_id, str) or not playlist_id:
        raise YouTubeProviderError("YouTube did not return a playlist identifier.")
    return playlist_id


def insert_remote_playlist_item(access_token: str, playlist_id: str, video_id: str) -> str | None:
    try:
        response = httpx.post(
            f"{YOUTUBE_API_BASE}/playlistItems",
            params={"part": "snippet"},
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "snippet": {
                    "playlistId": playlist_id,
                    "resourceId": {"kind": "youtube#video", "videoId": video_id},
                },
            },
            timeout=20,
        )
    except httpx.HTTPError as error:
        raise YouTubeProviderError("Could not add a selected video to the YouTube playlist.", 503) from error
    return _check_response(response, "playlist item insertion").get("id")
