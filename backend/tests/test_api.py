from io import BytesIO

from fastapi.testclient import TestClient
import pytest
from PIL import Image

from app.main import app
from app.services import expression_service
from app.services.expression_model import (
    ExpressionModel,
    ModelNotConfiguredError,
    NoFaceDetectedError,
)


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


def test_corrected_expression_changes_catalogue_ranking_without_changing_goal() -> None:
    request = {
        "listening_goal": "help_me_focus",
        "languages": [],
        "genres": [],
        "limit": 5,
    }
    happy_response = client.post(
        "/api/v1/recommendations",
        json={**request, "expression": "happy"},
    )
    sad_response = client.post(
        "/api/v1/recommendations",
        json={**request, "expression": "sad"},
    )

    assert happy_response.status_code == sad_response.status_code == 200
    happy_body = happy_response.json()
    sad_body = sad_response.json()
    assert happy_body["listening_goal"] == sad_body["listening_goal"] == "help_me_focus"
    assert happy_body["expression"] == "happy"
    assert sad_body["expression"] == "sad"
    assert [item["track"]["id"] for item in happy_body["items"]] != [
        item["track"]["id"] for item in sad_body["items"]
    ]


def test_listening_goal_changes_ranking_independently_of_expression() -> None:
    request = {
        "expression": None,
        "languages": [],
        "genres": [],
        "limit": 5,
    }
    focus_response = client.post(
        "/api/v1/recommendations",
        json={**request, "listening_goal": "help_me_focus"},
    )
    energize_response = client.post(
        "/api/v1/recommendations",
        json={**request, "listening_goal": "energize_me"},
    )

    assert focus_response.status_code == energize_response.status_code == 200
    focus_body = focus_response.json()
    energize_body = energize_response.json()
    assert focus_body["expression"] is energize_body["expression"] is None
    assert focus_body["items"][0]["track"]["id"] == "trk_005"
    assert energize_body["items"][0]["track"]["id"] == "trk_003"


class FakeExpressionModel:
    version = "fake-fer-v1"

    def __init__(self, scores: dict[str, float] | None = None, error: Exception | None = None) -> None:
        self.scores = scores or {
            "angry": 0.02,
            "disgust": 0.01,
            "fear": 0.02,
            "happy": 0.82,
            "sad": 0.03,
            "surprise": 0.04,
            "neutral": 0.06,
        }
        self.error = error

    def predict_image(self, contents: bytes) -> dict[str, float]:
        if self.error:
            raise self.error
        return self.scores


def test_expression_prediction_returns_model_scores(monkeypatch) -> None:
    monkeypatch.setattr(expression_service, "get_expression_model", lambda: FakeExpressionModel())

    response = client.post(
        "/api/v1/expressions/predict",
        files={"image": ("portrait.jpg", b"image bytes", "image/jpeg")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["expression"] == "happy"
    assert body["confidence"] == 0.82
    assert body["probabilities"]["happy"] == 0.82
    assert body["status"] == "prediction_available"
    assert body["model_version"] == "fake-fer-v1"


def test_uncertain_prediction_has_no_expression(monkeypatch) -> None:
    scores = {label: 1 / 7 for label in expression_service.LABELS}
    monkeypatch.setattr(expression_service, "get_expression_model", lambda: FakeExpressionModel(scores))

    response = client.post(
        "/api/v1/expressions/predict",
        files={"image": ("portrait.jpg", b"image bytes", "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.json()["expression"] is None
    assert response.json()["status"] == "uncertain"


def test_expression_prediction_rejects_unsupported_file() -> None:
    response = client.post(
        "/api/v1/expressions/predict",
        files={"image": ("portrait.gif", b"image bytes", "image/gif")},
    )

    assert response.status_code == 415


def test_expression_prediction_rejects_empty_file() -> None:
    response = client.post(
        "/api/v1/expressions/predict",
        files={"image": ("portrait.jpg", b"", "image/jpeg")},
    )

    assert response.status_code == 400


def test_expression_prediction_limits_upload_size(monkeypatch) -> None:
    monkeypatch.setattr(expression_service.settings, "max_image_bytes", 2)

    response = client.post(
        "/api/v1/expressions/predict",
        files={"image": ("portrait.jpg", b"abc", "image/jpeg")},
    )

    assert response.status_code == 413


def test_missing_model_returns_setup_instructions(monkeypatch) -> None:
    def missing_model():
        raise ModelNotConfiguredError("Run the model download command.")

    monkeypatch.setattr(expression_service, "get_expression_model", missing_model)
    response = client.post(
        "/api/v1/expressions/predict",
        files={"image": ("portrait.jpg", b"image bytes", "image/jpeg")},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Run the model download command."


def test_no_face_result_is_a_controlled_validation_error(monkeypatch) -> None:
    fake_model = FakeExpressionModel(error=NoFaceDetectedError("No face detected."))
    monkeypatch.setattr(expression_service, "get_expression_model", lambda: fake_model)
    response = client.post(
        "/api/v1/expressions/predict",
        files={"image": ("landscape.jpg", b"image bytes", "image/jpeg")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "No face detected."


def test_face_extractor_rejects_undecodable_image() -> None:
    with pytest.raises(ValueError, match="not a valid supported image"):
        ExpressionModel._extract_face(b"not an image")


def test_face_extractor_rejects_photo_without_a_detectable_face() -> None:
    image_data = BytesIO()
    Image.new("RGB", (96, 96), "white").save(image_data, format="PNG")

    with pytest.raises(NoFaceDetectedError, match="No face was detected"):
        ExpressionModel._extract_face(image_data.getvalue())
