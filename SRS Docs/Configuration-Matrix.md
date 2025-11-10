# Configuration Matrix (Base vs SRS)

> **Note**: This document consolidates configuration management across all SRS components. For detailed environment variable descriptions, see the [canonical CONFIGURATION.md](../CONFIGURATION.md).

| Category | Variable / Setting | Base (Reference) | SRS Target | Notes / Drift Risks |
|----------|--------------------|------------------|-----------|---------------------|
| Auth | AUTH_METHOD / auth_method | both / legacy | entra | Ensure frontend VITE_AUTH_METHOD aligns |
| Auth | azure_audience | api://{base-id} | api://{srs-backend-id} | Must match exposed API App ID URI |
| Auth | Scope string | user_impersonation (implicit) | explicit configured | Use `azure_backend_scope` as canonical; FE uses `VITE_AZURE_BACKEND_SCOPE` |
| Frontend | frontend_static_hostname | base SWA host | new SWA host | Update after first deploy |
| Retention | job_retention_days | 15 | 15 (or env-specific) | Keep UI & backend consistent |
| Retention | retention_dry_run | true (earlier) | false (prod) | Use true in staging first |
| Speech | voice_location | region A | region B? | Latency vs quota tradeoff |
| OpenAI | openai_location | region A | region A/B | Model availability gating |
| Costing | model_input_cost_per_million | 0 | >0 when tracking | Analytical only |
| Alerts | enable_alerts | maybe off | on | Requires action group for emails |
| Legacy | JWT_* secrets | Present | (present until removed) | Remove after deprecation |
| Logging | BACKEND_LOG_LEVEL | INFO (implicit) | INFO/DEBUG (explicit) | Environment-controlled logging |
| Logging | FUNCTIONS_LOG_LEVEL | INFO (implicit) | INFO/DEBUG (explicit) | Azure Functions logging control |
| CORS | ALLOW_ORIGINS | Hard-coded | Environment variable | Comma-separated origins, localhost fallback |
| Security | ENABLE_DEBUG_ENDPOINTS | true (implicit) | false (default) | Production security hardening |
| Security | ENABLE_SWAGGER_OAUTH | true (implicit) | false (default) | Swagger OAuth security gating |
| Auth (M2M) | SERVICE_PRINCIPAL_UPLOAD_ROLE | fixed value in some envs | env-configurable | Backend expects this value in token `roles` |

## Environment Variable Quick Reference (SRS Enhancements)

| Variable | Component | Default | Purpose | Security Level |
|----------|-----------|---------|---------|----------------|
| BACKEND_LOG_LEVEL | Backend App | INFO | Logging verbosity | Low |
| FUNCTIONS_LOG_LEVEL | Azure Functions | INFO | Function logging | Low |
| ALLOW_ORIGINS | Backend App | localhost only | CORS configuration | Medium |
| ENABLE_DEBUG_ENDPOINTS | Backend App | false | Debug endpoint exposure | High |
| ENABLE_SWAGGER_OAUTH | Backend App | false | Swagger OAuth enabling | Medium |
| AZURE_ENV_NAME | Backend/Functions | unknown | Environment identification | Low |
| AZURE_SUBSCRIPTION_ID | Backend | (hidden) | Health endpoint info | Low |
| SERVICE_PRINCIPAL_UPLOAD_ROLE | Backend App | (set per env) | Required role name for service principal ingestion | Medium |
| azure_backend_scope | FE/BE | api://{backend-id}/user_impersonation | Canonical API scope string (FE and Swagger use this) | High |
| VITE_AZURE_BACKEND_SCOPE | Frontend | (not set) | Frontend env var mirroring `azure_backend_scope` | High |

## Terraform to App Settings Mapping

| Terraform Variable | App Setting Name | Default Value | Purpose |
|--------------------|------------------|---------------|---------|
| backend_log_level | BACKEND_LOG_LEVEL | INFO | Backend FastAPI logging level |
| allow_origins | ALLOW_ORIGINS | (empty → localhost) | CORS allowed origins |
| azure_backend_scope | VITE_AZURE_BACKEND_SCOPE | api://{client-id}/user_impersonation | Frontend API scope |
| service_principal_upload_role | SERVICE_PRINCIPAL_UPLOAD_ROLE | ndluploader | M2M upload role requirement |

## Recent Additions

| Variable | Added | Purpose | Impact |
|----------|-------|---------|--------|
| ENABLE_DEBUG_ENDPOINTS | 2025-09 | Security hardening | Protects debug routes in production |
| ENABLE_SWAGGER_OAUTH | 2025-09 | OAuth control | Disables Swagger OAuth in secure environments |
| Enhanced CORS handling | 2025-09 | Environment flexibility | Secure production CORS with dev fallbacks |
| Structured logging levels | 2025-09 | Operational control | Fine-grained log management |

Notes:

* Prefer `user_impersonation` as scope name unless an existing environment standardizes on `access_as_user`. In all cases, use `azure_backend_scope` as the single source of truth to avoid drift across code, Terraform, and docs.
* The ingestion app role value must equal `SERVICE_PRINCIPAL_UPLOAD_ROLE`. Tokens must include this value in `roles` for privileged endpoints.
* All sensitive variables (API keys, secrets) should be managed through Azure App Settings or Key Vault—never committed to source control.


