from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
import pytest

from app.api.routes import auth as auth_routes
from app.core.database import Base, get_db
from app.main import app
from app.models import AdminAuditLog, AuthToken, PersonalSong, RefreshSession, User  # noqa: F401
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
