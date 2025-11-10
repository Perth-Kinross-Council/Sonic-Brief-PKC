# Backend (FastAPI) Service

This directory contains the FastAPI backend for Sonic Brief. It provides authentication, upload handling, prompt management, and job retrieval endpoints.

## Quick Start (Local)
```bash
# From repository root
cd backend_app
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r ../az-func-audio/requirements.txt -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Environment Variables
Core runtime configuration (log level, CORS, debug endpoints) is summarized in the root README and fully documented in [`../CONFIGURATION.md`](../CONFIGURATION.md). Only non-secret operational toggles live here.

Minimum for local dev (create `.env`):
```
BACKEND_LOG_LEVEL=INFO
ALLOW_ORIGINS=http://localhost:5173
ENABLE_DEBUG_ENDPOINTS=false
```
(You may omit `ALLOW_ORIGINS` for default localhost values.)

## CORS
`ALLOW_ORIGINS` (comma-separated) overrides the default localhost list. Do not use wildcard `*`. Each origin is trimmed; empty segments ignored.

## Debug Endpoints
Routes like `/debug-audit` are gated by `ENABLE_DEBUG_ENDPOINTS=true`. Leave disabled unless actively investigating.

## Logging
`BACKEND_LOG_LEVEL` controls verbosity. Use `INFO` normally; temporarily raise to `DEBUG` for investigations and revert promptly.

## Health & Smoke Tests
After starting locally:
- `GET /` basic metadata
- `GET /health` composite health info
- `GET /test/deployment` deployment verification

## Adding New Settings
1. Add to code with safe default via `os.getenv`.
2. If needed in infrastructure, expose as Terraform variable and app setting.
3. Update `CONFIGURATION.md`.

## Future
- Application Insights integration
- Key Vault-managed secret retrieval for Speech/OpenAI creds
- Centralized correlation IDs & structured request logging

---
_Last updated: 2025-08-20_
