from collections.abc import Generator
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
import pytest

from app.api.routes import auth as auth_routes, youtube as youtube_routes
from app.core.database import Base, get_db
from app.main import app
from app.models import AdminAuditLog, AuthToken, PersonalSong, RefreshSession, User, YouTubeConnection  # noqa: F401
from app.core.config import settings
from app.services.admin_bootstrap import promote_configured_superuser


@pytest.fixture
def api_client(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[TestClient, list[tuple[str, str]]], None, None]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    sent: list[tuple[str, str]] = []

    def capture_email(user, purpose: str, token: str) -> None:
        sent.append((purpose, token))

    monkeypatch.setattr(auth_routes, "_send_action", capture_email)

    def override_get_db() -> Generator[Session, None, None]:
        database = TestSession()
        try:
            yield database
        finally:
            database.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client, sent
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def register_and_login(client: TestClient, sent: list[tuple[str, str]], email: str) -> str:
    username = email.split("@", 1)[0].replace("-", "_")
    response = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": "correct-horse-battery",
        "display_name": "Test Listener",
        "username": username,
    })
    assert response.status_code == 201
    purpose, verification_token = sent.pop(0)
    assert purpose == "verify"
    assert client.post("/api/v1/auth/verify", json={"token": verification_token}).status_code == 200
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "correct-horse-battery"})
    assert response.status_code == 200
    return response.json()["access_token"]


def test_personal_playlist_requires_verified_auth_and_isolated_by_user(api_client) -> None:
    client, sent = api_client
    assert client.get("/api/v1/personal-playlists/songs").status_code == 401

    response = client.post("/api/v1/auth/register", json={
        "email": "unverified@example.com",
        "password": "correct-horse-battery",
        "display_name": "Unverified Listener",
        "username": "unverified",
    })
    assert response.status_code == 201
    unverified_token = client.post(
        "/api/v1/auth/login",
        json={"email": "unverified@example.com", "password": "correct-horse-battery"},
    )
    assert unverified_token.status_code == 403
    purpose, token = sent.pop(0)
    assert purpose == "verify"
    assert client.post("/api/v1/auth/verify", json={"token": token}).status_code == 200

    first_access = register_and_login(client, sent, "first@example.com")
    first_headers = {"Authorization": f"Bearer {first_access}"}
    created = client.post(
        "/api/v1/personal-playlists/songs",
        headers=first_headers,
        json={"mood": "happy", "title": "  Here Comes the Sun  "},
    )
    assert created.status_code == 201
    assert created.json()["title"] == "Here Comes the Sun"
    assert created.json()["position"] == 1

    second_access = register_and_login(client, sent, "second@example.com")
    second_headers = {"Authorization": f"Bearer {second_access}"}
    assert client.get("/api/v1/personal-playlists/songs", headers=second_headers).json() == []
    assert client.delete(
        f"/api/v1/personal-playlists/songs/{created.json()['id']}", headers=second_headers
    ).status_code == 404
    assert len(client.get("/api/v1/personal-playlists/songs?mood=happy", headers=first_headers).json()) == 1


def test_youtube_match_review_and_playlist_creation_are_user_scoped(api_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, sent = api_client
    access = register_and_login(client, sent, "youtube-listener@example.com")
    headers = {"Authorization": f"Bearer {access}"}
    created_song = client.post(
        "/api/v1/personal-playlists/songs",
        headers=headers,
        json={"mood": "happy", "title": "Yellow", "artist": "Coldplay"},
    )
    assert created_song.status_code == 201
    song_id = created_song.json()["id"]
    assert created_song.json()["artist"] == "Coldplay"

    match = {
        "video_id": "video-123",
        "title": "Yellow (Official Video)",
        "channel_title": "Coldplay",
        "thumbnail_url": "https://example.test/thumb.jpg",
    }
    monkeypatch.setattr(youtube_routes, "search_videos", lambda title, artist: [match])
    found = client.get(f"/api/v1/youtube/songs/{song_id}/matches", headers=headers)
    assert found.status_code == 200
    assert found.json() == [match]
    rejected = client.put(
        f"/api/v1/youtube/songs/{song_id}/match", headers=headers, json={"video_id": "not-a-result"}
    )
    assert rejected.status_code == 422
    selected = client.put(
        f"/api/v1/youtube/songs/{song_id}/match", headers=headers, json={"video_id": "video-123"}
    )
    assert selected.status_code == 200
    assert selected.json()["youtube_video_id"] == "video-123"

    from app.core.database import get_db

    database = next(app.dependency_overrides[get_db]())
    database.add(YouTubeConnection(
        user_id=database.query(User).filter_by(email="youtube-listener@example.com").one().id,
        google_subject="google-subject-1",
        google_email="listener@gmail.com",
        encrypted_refresh_token="encrypted-refresh-token",
    ))
    database.commit()
    database.close()

    monkeypatch.setattr(youtube_routes, "decrypt_refresh_token", lambda token: "refresh-token")
    monkeypatch.setattr(youtube_routes, "refresh_access_token", lambda token: "access-token")
    monkeypatch.setattr(youtube_routes, "create_remote_playlist", lambda token, title, description: "playlist-123")
    monkeypatch.setattr(youtube_routes, "insert_remote_playlist_item", lambda token, playlist, video: "item-123")
    playlist = client.post(
        "/api/v1/youtube/playlists",
        headers=headers,
        json={"mood": "happy", "title": "Moodify — Happy"},
    )
    assert playlist.status_code == 201
    assert playlist.json()["url"] == "https://www.youtube.com/playlist?list=playlist-123"
    assert playlist.json()["added_count"] == 1
    history = client.get("/api/v1/youtube/playlists?mood=happy", headers=headers)
    assert history.status_code == 200
    assert history.json()[0]["title"] == "Moodify — Happy"
    assert history.json()[0]["status"] == "created"

    sad_song = client.post(
        "/api/v1/personal-playlists/songs",
        headers=headers,
        json={"mood": "sad", "title": "Fix You", "artist": "Coldplay"},
    ).json()
    assert client.put(
        f"/api/v1/youtube/songs/{sad_song['id']}/match", headers=headers, json={"video_id": "video-123"}
    ).status_code == 200
    monkeypatch.setattr(youtube_routes, "create_remote_playlist", lambda token, title, description: "playlist-partial")
    monkeypatch.setattr(youtube_routes, "insert_remote_playlist_item", lambda *args: (_ for _ in ()).throw(
        youtube_routes.YouTubeProviderError("temporary provider error", 503)
    ))
    partial = client.post(
        "/api/v1/youtube/playlists", headers=headers, json={"mood": "sad", "title": "Moodify — Sad"}
    )
    assert partial.status_code == 201
    assert partial.json()["status"] == "partial"
    assert partial.json()["failed_song_ids"] == [sad_song["id"]]
    monkeypatch.setattr(youtube_routes, "insert_remote_playlist_item", lambda token, playlist, video: "retried-item")
    retried = client.post(f"/api/v1/youtube/playlists/{partial.json()['id']}/retry", headers=headers)
    assert retried.status_code == 200
    assert retried.json()["status"] == "created"
    assert retried.json()["added_count"] == 1

    other_access = register_and_login(client, sent, "youtube-other@example.com")
    assert client.get(f"/api/v1/youtube/songs/{song_id}/matches", headers={"Authorization": f"Bearer {other_access}"}).status_code == 404


def test_youtube_search_reports_missing_api_key(api_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, sent = api_client
    access = register_and_login(client, sent, "youtube-config@example.com")
    headers = {"Authorization": f"Bearer {access}"}
    created = client.post(
        "/api/v1/personal-playlists/songs",
        headers=headers,
        json={"mood": "happy", "title": "Yellow", "artist": "Coldplay"},
    )
    assert created.status_code == 201
    monkeypatch.setattr(settings, "youtube_api_key", None)

    response = client.get(
        f"/api/v1/youtube/songs/{created.json()['id']}/matches",
        headers=headers,
    )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "YouTube search is not configured on this server. Set MOODIFY_YOUTUBE_API_KEY "
        "to a YouTube Data API v3 key and restart the backend."
    )


def test_youtube_oauth_state_is_single_use_user_bound_and_refresh_token_encrypted(api_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, sent = api_client
    access = register_and_login(client, sent, "oauth-listener@example.com")
    headers = {"Authorization": f"Bearer {access}"}
    from cryptography.fernet import Fernet

    monkeypatch.setattr(settings, "youtube_client_id", "test-client-id")
    monkeypatch.setattr(settings, "youtube_client_secret", "test-client-secret")
    monkeypatch.setattr(settings, "youtube_redirect_uri", "http://localhost:8000/api/v1/youtube/oauth/callback")
    monkeypatch.setattr(settings, "youtube_token_encryption_key", Fernet.generate_key().decode())

    started = client.post("/api/v1/youtube/oauth/start", headers=headers, json={"mood": "happy"})
    assert started.status_code == 200
    state = parse_qs(urlparse(started.json()["authorization_url"]).query)["state"][0]
    monkeypatch.setattr(youtube_routes, "exchange_authorization_code", lambda code: {
        "access_token": "provider-access-token",
        "refresh_token": "provider-refresh-token",
    })
    monkeypatch.setattr(youtube_routes, "fetch_google_identity", lambda token: {
        "sub": "google-subject-123", "email": "listener@gmail.com",
    })

    callback = client.get(
        "/api/v1/youtube/oauth/callback",
        params={"code": "authorization-code", "state": state},
        follow_redirects=False,
    )
    assert callback.status_code == 303
    assert callback.headers["location"].endswith("/#create-playlist?mood=happy&youtube=connected")
    connection_status = client.get("/api/v1/youtube/connection", headers=headers)
    assert connection_status.json() == {"connected": True, "google_email": "listener@gmail.com", "remote_revoked": None}

    from app.core.database import get_db

    database = next(app.dependency_overrides[get_db]())
    connection = database.query(YouTubeConnection).one()
    assert connection.encrypted_refresh_token != "provider-refresh-token"
    from app.services.youtube import decrypt_refresh_token

    assert decrypt_refresh_token(connection.encrypted_refresh_token) == "provider-refresh-token"
    database.close()

    replay = client.get(
        "/api/v1/youtube/oauth/callback",
        params={"code": "second-code", "state": state},
        follow_redirects=False,
    )
    assert "youtube=invalid-state" in replay.headers["location"]


def test_personal_song_validation_and_one_time_email_tokens(api_client) -> None:
    client, sent = api_client
    access = register_and_login(client, sent, "listener@example.com")
    headers = {"Authorization": f"Bearer {access}"}

    assert client.post(
        "/api/v1/personal-playlists/songs", headers=headers, json={"mood": "unknown", "title": "Song"}
    ).status_code == 422
    assert client.post(
        "/api/v1/personal-playlists/songs", headers=headers, json={"mood": "sad", "title": "   "}
    ).status_code == 422

    forgot = client.post("/api/v1/auth/forgot-password", json={"email": "listener@example.com"})
    assert forgot.status_code == 200
    purpose, reset_token = sent.pop(0)
    assert purpose == "reset"
    changed = client.post(
        "/api/v1/auth/reset-password",
        json={"token": reset_token, "password": "even-better-password-2026"},
    )
    assert changed.status_code == 200
    assert client.post(
        "/api/v1/auth/reset-password",
        json={"token": reset_token, "password": "another-valid-password"},
    ).status_code == 400
    assert client.post(
        "/api/v1/auth/login", json={"email": "listener@example.com", "password": "even-better-password-2026"}
    ).status_code == 200


def test_legacy_title_only_song_can_be_updated_with_artist(api_client) -> None:
    client, sent = api_client
    access = register_and_login(client, sent, "legacy-song@example.com")
    headers = {"Authorization": f"Bearer {access}"}
    legacy = client.post(
        "/api/v1/personal-playlists/songs",
        headers=headers,
        json={"mood": "happy", "title": "Yellow"},
    )
    assert legacy.status_code == 201
    assert legacy.json()["artist"] is None

    updated = client.put(
        f"/api/v1/personal-playlists/songs/{legacy.json()['id']}",
        headers=headers,
        json={"title": "Yellow", "artist": "Coldplay"},
    )
    assert updated.status_code == 200
    assert updated.json()["artist"] == "Coldplay"


def test_profile_validation_and_update_are_user_scoped(api_client) -> None:
    client, sent = api_client
    invalid_email = client.post("/api/v1/auth/register", json={
        "email": "not-an-email",
        "password": "correct-horse-battery",
        "display_name": "Invalid Email",
        "username": "invalid_email",
    })
    assert invalid_email.status_code == 422

    access = register_and_login(client, sent, "listener@example.com")
    headers = {"Authorization": f"Bearer {access}"}
    duplicate_username = client.post("/api/v1/auth/register", json={
        "email": "different@example.com",
        "password": "correct-horse-battery",
        "display_name": "Different Listener",
        "username": "LISTENER",
    })
    assert duplicate_username.status_code == 409

    profile = client.get("/api/v1/auth/me", headers=headers)
    assert profile.status_code == 200
    assert profile.json() == {
        "email": "listener@example.com",
        "display_name": "Test Listener",
        "username": "listener",
    }
    updated = client.put(
        "/api/v1/auth/me",
        headers=headers,
        json={"display_name": "  New Listener  ", "username": "  New_Listener  "},
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "New Listener"
    assert updated.json()["username"] == "new_listener"
    assert client.put(
        "/api/v1/auth/me", headers=headers, json={"display_name": "", "username": "invalid name"}
    ).status_code == 422
    assert client.get("/api/v1/auth/me").status_code == 401

    register_and_login(client, sent, "another@example.com")
    duplicate = client.put(
        "/api/v1/auth/me", headers=headers, json={"display_name": "Listener", "username": "another"}
    )
    assert duplicate.status_code == 409


def test_admin_permissions_metrics_and_suspension(api_client) -> None:
    client, sent = api_client
    regular_token = register_and_login(client, sent, "regular@example.com")
    regular_headers = {"Authorization": f"Bearer {regular_token}"}
    assert client.get("/api/v1/admin/users", headers=regular_headers).status_code == 403

    admin_token = register_and_login(client, sent, "admin@example.com")
    engine = client.app.state  # Keep model changes through the same dependency-backed database.
    del engine
    from app.core.database import get_db

    database = next(app.dependency_overrides[get_db]())
    admin = database.query(User).filter_by(email="admin@example.com").one()
    admin.role = "admin"
    database.commit()
    database.close()

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    assert client.get("/api/v1/admin/users?q=regular", headers=admin_headers).json()[0]["email"] == "regular@example.com"
    metrics = client.get("/api/v1/admin/metrics", headers=admin_headers)
    assert metrics.status_code == 200
    assert metrics.json()["users_total"] == 2
    assert client.get("/api/v1/admin/audit", headers=admin_headers).status_code == 403

    regular_id = client.get("/api/v1/admin/users?q=regular", headers=admin_headers).json()[0]["id"]
    suspended = client.put(
        f"/api/v1/admin/users/{regular_id}/suspension",
        headers=admin_headers,
        json={"suspended": True},
    )
    assert suspended.status_code == 200
    assert suspended.json()["is_suspended"] is True
    assert client.get("/api/v1/personal-playlists/songs", headers=regular_headers).status_code == 403
    assert client.post(
        "/api/v1/auth/login", json={"email": "regular@example.com", "password": "correct-horse-battery"}
    ).status_code == 403


def test_superuser_role_changes_audit_and_self_protection(api_client) -> None:
    client, sent = api_client
    owner_token = register_and_login(client, sent, "owner@example.com")
    user_token = register_and_login(client, sent, "member@example.com")
    ordinary_token = register_and_login(client, sent, "ordinary@example.com")
    from app.core.database import get_db

    database = next(app.dependency_overrides[get_db]())
    owner = database.query(User).filter_by(email="owner@example.com").one()
    owner.role = "super_user"
    target = database.query(User).filter_by(email="member@example.com").one()
    target_id = target.id
    database.commit()
    database.close()

    headers = {"Authorization": f"Bearer {owner_token}"}
    changed = client.put(f"/api/v1/admin/users/{target_id}/role", headers=headers, json={"role": "admin"})
    assert changed.status_code == 200
    assert changed.json()["role"] == "admin"
    assert client.put(
        f"/api/v1/admin/users/{owner.id}/role", headers=headers, json={"role": "user"}
    ).status_code == 400
    assert client.get("/api/v1/admin/audit", headers=headers).json()[0]["action"] == "change_role"
    assert client.get("/api/v1/admin/metrics", headers={"Authorization": f"Bearer {ordinary_token}"}).status_code == 403


def test_owner_bootstrap_only_promotes_existing_verified_user(api_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, sent = api_client
    token = register_and_login(client, sent, "product-owner@example.com")
    from app.core.database import get_db

    database = next(app.dependency_overrides[get_db]())
    user = database.query(User).filter_by(email="product-owner@example.com").one()
    assert user.role == "user"
    monkeypatch.setattr(settings, "initial_superuser_email", "product-owner@example.com")
    promote_configured_superuser(database)
    user = database.query(User).filter_by(email="product-owner@example.com").one()
    assert user.role == "super_user"
    promote_configured_superuser(database)  # Promotion is idempotent.
    monkeypatch.setattr(settings, "initial_superuser_email", "missing@example.com")
    with pytest.raises(RuntimeError, match="existing, verified"):
        promote_configured_superuser(database)
    assert client.get("/api/v1/admin/metrics", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    database.close()


def test_superuser_catalogue_settings_and_status(api_client) -> None:
    client, sent = api_client
    owner_token = register_and_login(client, sent, "catalogue-owner@example.com")
    regular_token = register_and_login(client, sent, "catalogue-user@example.com")
    from app.core.database import get_db

    database = next(app.dependency_overrides[get_db]())
    owner = database.query(User).filter_by(email="catalogue-owner@example.com").one()
    owner.role = "super_user"
    database.commit()
    database.close()
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    regular_headers = {"Authorization": f"Bearer {regular_token}"}

    assert client.get("/api/v1/admin/status", headers=regular_headers).status_code == 403
    status_response = client.get("/api/v1/admin/status", headers=owner_headers)
    assert status_response.status_code == 200
    assert "jwt_secret" not in status_response.text.lower()
    assert client.get("/api/v1/admin/catalogue", headers=regular_headers).status_code == 403

    track_payload = {
        "id": "owner_track", "title": "Owner Track", "artist": "Moodify", "language": "English",
        "genre": "ambient", "energy": 0.25, "tags": ["calm"], "expression_affinities": {}, "source_url": None,
    }
    created = client.post("/api/v1/admin/catalogue", headers=owner_headers, json=track_payload)
    assert created.status_code == 201
    assert any(track["id"] == "owner_track" for track in client.get("/api/v1/tracks").json())
    updated_payload = {**track_payload, "title": "Updated Owner Track"}
    assert client.put("/api/v1/admin/catalogue/owner_track", headers=owner_headers, json=updated_payload).json()["title"] == "Updated Owner Track"
    assert client.put("/api/v1/admin/catalogue/wrong-id", headers=owner_headers, json=updated_payload).status_code == 422

    defaults = client.get("/api/v1/admin/settings/recommendations", headers=owner_headers)
    assert defaults.status_code == 200
    weights = {**defaults.json(), "goal_tag_weight": 3.25}
    assert client.put("/api/v1/admin/settings/recommendations", headers=owner_headers, json=weights).json()["goal_tag_weight"] == 3.25
    assert client.put("/api/v1/admin/settings/recommendations", headers=owner_headers, json={**weights, "energy_weight": 6}).status_code == 422
    assert client.get("/api/v1/admin/audit", headers=owner_headers).status_code == 200

    assert client.delete("/api/v1/admin/catalogue/owner_track", headers=owner_headers).status_code == 409
    second_track = {**track_payload, "id": "owner_track_2", "title": "Second Owner Track"}
    assert client.post("/api/v1/admin/catalogue", headers=owner_headers, json=second_track).status_code == 201
    assert client.delete("/api/v1/admin/catalogue/owner_track", headers=owner_headers).status_code == 200
    assert client.delete("/api/v1/admin/catalogue/does-not-exist", headers=owner_headers).status_code == 404
