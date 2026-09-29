"""The AI service must refuse every request without the shared key,
except /health. Uses a minimal app with the real middleware, so the test
doesn't load the embedding model or Playwright."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from internal_auth import InternalKeyMiddleware, is_valid_key

KEY = "test-internal-key-0123456789abcdef"


def make_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(InternalKeyMiddleware)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/ats-apply")
    def ats_apply(data: dict):
        return {"ran": True, "user_id": data.get("user_id")}

    @app.get("/linkedin/session-status/{user_id}")
    def session_status(user_id: str):
        return {"ran": True}

    return TestClient(app)


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", KEY)


def test_health_is_open_without_a_key():
    assert make_client().get("/health").status_code == 200


@pytest.mark.parametrize("headers", [{}, {"X-Internal-Key": "wrong"}, {"X-Internal-Key": ""}, {"X-Api-Key": KEY}])
def test_protected_routes_refuse_a_missing_or_wrong_key(headers):
    client = make_client()
    res = client.post("/ats-apply", json={"user_id": "victim"}, headers=headers)
    assert res.status_code == 401
    assert "ran" not in res.text
    assert client.get("/linkedin/session-status/victim", headers=headers).status_code == 401


def test_protected_routes_run_with_the_right_key():
    client = make_client()
    res = client.post("/ats-apply", json={"user_id": "u1"}, headers={"X-Internal-Key": KEY})
    assert res.status_code == 200
    assert res.json() == {"ran": True, "user_id": "u1"}


def test_fails_closed_when_the_key_is_not_configured(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_KEY", raising=False)
    client = make_client()
    assert client.post("/ats-apply", json={}, headers={"X-Internal-Key": ""}).status_code == 401
    assert client.post("/ats-apply", json={}, headers={"X-Internal-Key": KEY}).status_code == 401
    assert client.get("/health").status_code == 200


def test_is_valid_key_rejects_empty_values(monkeypatch):
    assert is_valid_key(KEY) is True
    assert is_valid_key(None) is False
    monkeypatch.setenv("INTERNAL_API_KEY", "")
    assert is_valid_key("") is False
