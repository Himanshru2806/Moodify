from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_recommendations_return_ranked_items() -> None:
    response = client.post(
        "/api/v1/recommendations",
        json={
            "expression": "happy",
            "listening_goal": "help_me_focus",
            "languages": ["Instrumental"],
            "genres": ["lofi"],
            "limit": 3,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["listening_goal"] == "help_me_focus"
    assert len(body["items"]) == 3
    assert body["items"][0]["rank"] == 1
