import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.dependencies import get_auth_cache, get_app_config, get_service_container, get_cached_user_service
from app.routers.auth import get_current_user_cached


class FakeCache:
    def stats(self):
        return {"total_entries": 0, "valid_entries": 0}

    def clear(self):
        return None


class FakeAuthConfig:
    def is_entra_enabled(self):
        return False

    def get_enabled_methods(self):
        return ["legacy"]


class FakeConfig:
    auth_config = FakeAuthConfig()


class FakeServiceContainer:
    def get_health_status(self):
        return {"status": "ok", "services": {}, "timestamp": "now"}


class FakeUserCacheService:
    def get_cache_stats(self):
        return {"entries": 0}

    def invalidate_user_cache(self, identifier, lookup_type):
        return None

    def clear_all_cache(self):
        return None


def override_standard_user():
    return {"id": "u1", "email": "user@example.com", "roles": ["standard"]}


def override_admin_user():
    return {"id": "uadmin", "email": "admin@example.com", "roles": ["admin"]}


def override_cache():
    return FakeCache()


def override_config():
    return FakeConfig()


def override_service_container():
    return FakeServiceContainer()


def override_user_cache_service():
    return FakeUserCacheService()


client = TestClient(app)


def test_cache_stats_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_auth_cache] = override_cache
    try:
        r = client.get("/admin/auth/cache/stats")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_cache_stats_allowed_for_admin():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_auth_cache] = override_cache
    try:
        r = client.get("/admin/auth/cache/stats")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "success"
    finally:
        app.dependency_overrides.clear()


def test_cache_clear_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_auth_cache] = override_cache
    try:
        r = client.post("/admin/auth/cache/clear")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_cache_clear_allowed_for_admin():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_auth_cache] = override_cache
    try:
        r = client.post("/admin/auth/cache/clear")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "success"
    finally:
        app.dependency_overrides.clear()


def test_jwks_stats_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_app_config] = override_config
    try:
        r = client.get("/admin/auth/admin/jwks/stats")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_jwks_stats_admin_ok():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_app_config] = override_config
    try:
        r = client.get("/admin/auth/admin/jwks/stats")
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_jwks_refresh_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_app_config] = override_config
    try:
        r = client.post("/admin/auth/admin/jwks/refresh")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_jwks_refresh_admin_returns_400_when_disabled():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_app_config] = override_config
    try:
        r = client.post("/admin/auth/admin/jwks/refresh")
        assert r.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_performance_stats_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_auth_cache] = override_cache
    app.dependency_overrides[get_service_container] = override_service_container
    try:
        r = client.get("/admin/auth/admin/performance/stats")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_performance_stats_admin_ok():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_auth_cache] = override_cache
    app.dependency_overrides[get_service_container] = override_service_container
    try:
        r = client.get("/admin/auth/admin/performance/stats")
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_monitoring_summary_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_auth_cache] = override_cache
    app.dependency_overrides[get_service_container] = override_service_container
    app.dependency_overrides[get_app_config] = override_config
    try:
        r = client.get("/admin/auth/monitoring/summary")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_monitoring_summary_admin_ok():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_auth_cache] = override_cache
    app.dependency_overrides[get_service_container] = override_service_container
    app.dependency_overrides[get_app_config] = override_config
    try:
        r = client.get("/admin/auth/monitoring/summary")
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_user_cache_stats_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_cached_user_service] = override_user_cache_service
    try:
        r = client.get("/admin/auth/user-cache/stats")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_user_cache_stats_admin_ok():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_cached_user_service] = override_user_cache_service
    try:
        r = client.get("/admin/auth/user-cache/stats")
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_user_cache_invalidate_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_cached_user_service] = override_user_cache_service
    try:
        r = client.post("/admin/auth/user-cache/invalidate", json={"identifier": "x", "lookup_type": "email"})
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_user_cache_invalidate_admin_ok():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_cached_user_service] = override_user_cache_service
    try:
        r = client.post("/admin/auth/user-cache/invalidate", json={"identifier": "x", "lookup_type": "email"})
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_user_cache_clear_forbidden_for_non_admin():
    app.dependency_overrides[get_current_user_cached] = override_standard_user
    app.dependency_overrides[get_cached_user_service] = override_user_cache_service
    try:
        r = client.post("/admin/auth/user-cache/clear")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_user_cache_clear_admin_ok():
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_cached_user_service] = override_user_cache_service
    try:
        r = client.post("/admin/auth/user-cache/clear")
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_user_cache_invalidate_admin_422_on_invalid_payload():
    """Router should reject invalid payloads via Pydantic (empty/missing fields)."""
    app.dependency_overrides[get_current_user_cached] = override_admin_user
    app.dependency_overrides[get_cached_user_service] = override_user_cache_service
    try:
        # Empty identifier should fail validation (min_length=1)
        r1 = client.post("/admin/auth/user-cache/invalidate", json={"identifier": "", "lookup_type": "email"})
        assert r1.status_code == 422

        # Missing identifier field should also fail
        r2 = client.post("/admin/auth/user-cache/invalidate", json={"lookup_type": "email"})
        assert r2.status_code == 422

        # Missing lookup_type field should fail
        r3 = client.post("/admin/auth/user-cache/invalidate", json={"identifier": "user@example.com"})
        assert r3.status_code == 422
    finally:
        app.dependency_overrides.clear()
