from fastapi import Depends
from fastapi.testclient import TestClient
from app.app import app  # assuming FastAPI app is exposed here

# Minimal smoke test to ensure the new dependencies import and can be wired.

def test_import_scope_dependencies():
    from app.routers.auth import require_entra_scopes, require_entra_roles, require_admin_cached
    assert callable(require_entra_scopes)
    assert callable(require_entra_roles)
    assert callable(require_admin_cached)
