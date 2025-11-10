import pytest
from starlette.testclient import TestClient

from app.main import app


@pytest.mark.parametrize("path", ["/health", "/"])
def test_security_headers_present(path: str):
    client = TestClient(app)
    resp = client.get(path)
    # Presence checks (values may vary by host/proxy but must exist)
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") in {"DENY", "SAMEORIGIN"}
    assert resp.headers.get("Referrer-Policy") is not None
    # HSTS applies over HTTPS; ensure header is set in production
    assert "Strict-Transport-Security" in resp.headers
