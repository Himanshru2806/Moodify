import httpx
import pytest

from app.core.config import settings
from app.services import youtube


def test_missing_youtube_oauth_settings_are_reported_explicitly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "youtube_client_id", None)
    monkeypatch.setattr(settings, "youtube_client_secret", None)
    monkeypatch.setattr(settings, "youtube_redirect_uri", None)
    monkeypatch.setattr(settings, "youtube_token_encryption_key", None)

    with pytest.raises(youtube.YouTubeProviderError, match="MOODIFY_YOUTUBE_CLIENT_ID") as error:
        youtube.require_oauth_config()

    assert error.value.status_code == 503


@pytest.mark.parametrize(
    ("reason", "expected"),
    [
        (
            "accessNotConfigured",
            "YouTube Data API v3 is not enabled for the Google Cloud project",
        ),
        ("keyInvalid", "Google rejected MOODIFY_YOUTUBE_API_KEY."),
        ("quotaExceeded", "YouTube Data API quota is exhausted."),
        ("ipRefererBlocked", "Google blocked the YouTube API key"),
    ],
)
def test_youtube_search_explains_google_api_configuration_errors(
    monkeypatch: pytest.MonkeyPatch,
    reason: str,
    expected: str,
) -> None:
    monkeypatch.setattr(settings, "youtube_api_key", "test-key")
    response = httpx.Response(
        403,
        json={"error": {"errors": [{"reason": reason}]}},
        request=httpx.Request("GET", "https://www.googleapis.com/youtube/v3/search"),
    )
    monkeypatch.setattr(youtube.httpx, "get", lambda *args, **kwargs: response)

    with pytest.raises(youtube.YouTubeProviderError, match=expected):
        youtube.search_videos("Yellow", "Coldplay")
