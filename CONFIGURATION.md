# Configuration Reference

Canonical reference for operational and runtime configuration of the Sonic Brief solution. Keep this file as the single source of truth; other READMEs should link here rather than duplicating tables.

> **📋 SRS Configuration Matrix**: For environment-specific comparisons and deployment configurations, see [`SRS Docs/Configuration-Matrix.md`](./SRS%20Docs/Configuration-Matrix.md) which provides side-by-side configuration comparison and Terraform variable mapping.

## Environment Variables

| Name | Applies To | Source (Terraform/App Settings) | Default / Fallback | Required for Prod | Description |
|------|------------|----------------------------------|--------------------|-------------------|-------------|
| BACKEND_LOG_LEVEL | Backend App (FastAPI) | `backend_log_level` variable -> App Setting | INFO | Recommended (set explicitly) | Structured logging verbosity. One of DEBUG/INFO/WARNING/ERROR/CRITICAL. Use DEBUG only temporarily. |
| FUNCTIONS_LOG_LEVEL | Azure Functions (audio processing) | Inline in `az_functions.tf` / App Setting | INFO | Recommended | Controls Python function logging level. |
| ALLOW_ORIGINS | Backend App (CORS) | `allow_origins` variable -> App Setting | Localhost dev defaults if blank | YES | Comma-separated list of allowed browser origins. No wildcard `*` in production. |
| ENABLE_DEBUG_ENDPOINTS | Backend App | Manual App Setting (not parameterized) | false | NO (keep false) | If `true` exposes debug/diagnostic endpoints (e.g. `/debug-audit`). Leave `false` in prod. |
| AZURE_ENV_NAME | Backend / Observability | Set by deployment pipeline (optional) | unknown | Optional | Environment tag surfaced in health endpoints. |
| AZURE_SUBSCRIPTION_ID | Backend / Observability | Terraform / pipeline injection | (hidden) | Optional | Used only for truncated reporting in health endpoint. |
| WEBSITE_SITE_NAME | Azure App Service | Platform-provided | local | N/A | App Service site name (injected by Azure). |
| SPEECH_KEY / SPEECH_REGION | Functions / Backend (future KV) | App Settings / Key Vault (future) | none | YES (when speech enabled) | Azure Speech service credentials (will move to Key Vault). |
| OPENAI_API_KEY / OPENAI_ENDPOINT | Functions | App Settings / Key Vault (future) | none | YES (for summarization) | Azure OpenAI access (managed identity / KV planned). |
| SERVICE_PRINCIPAL_UPLOAD_ROLE | Backend App (upload auth) | `service_principal_upload_role` variable -> App Setting | ndluploader | YES | App role value the backend expects in `roles` claim for app-only (client credentials) upload endpoints. |
| INGESTION_CLIENT_ID | External ingestion process | App Setting / Deployment secret store (NOT committed) | none | YES (if machine uploads) | Client ID of dedicated ingestion (machine-to-machine) app registration. Not used by end-users. |
| INGESTION_CLIENT_SECRET | External ingestion process | Secret store / Key Vault (planned) | none | YES (if machine uploads) | Secret or certificate-based credential for ingestion app. Rotate regularly; never commit. |
| AZURE_TENANT_ID | All | `azure_tenant_id` variable -> App Setting | none | YES | Directory tenant used for all tokens; reused by ingestion SP. |
| AZURE_AUDIENCE | Backend / Ingestion | `azure_audience` variable -> App Setting | api://<backend-app-id> | YES | Application ID URI (audience) of backend API; ingestion tokens must target this. |

> Keys containing secrets (e.g., `SPEECH_KEY`, `OPENAI_API_KEY`) must not be committed. Transition to Key Vault + managed identity is on the hardening roadmap.

### CORS Handling (`ALLOW_ORIGINS`)
- Blank value: backend permits only localhost dev origins.
- Non-blank: each comma-separated segment is trimmed; empty segments ignored.
- Change requires App Service restart (Azure usually does this automatically when settings change).

### Logging Strategy
- Prefer `INFO` for steady-state.
- Temporarily raise to `DEBUG` only during targeted investigations; revert promptly.
- Plan: integrate with Application Insights (future) and add dynamic log level toggle via Azure App Configuration if needed.

### Debug Endpoints
- Guarded by `ENABLE_DEBUG_ENDPOINTS` == `true` (string, case-insensitive).
- Returning 404 when disabled avoids advertising their presence.
- Treat enabling as a change control event.

## Terraform Variable Mapping
| Terraform Variable | App Setting (if any) | Notes |
|--------------------|----------------------|-------|
| backend_log_level | BACKEND_LOG_LEVEL | Optional override; default INFO. |
| allow_origins | ALLOW_ORIGINS | If empty string, backend falls back to localhost list. |

(See `infra/variables.tf.sample` for the full variable set; only the above map directly to the new runtime env behavior introduced in Lite Refactor Phase 1.)

## Adding a New Variable
1. Define the Terraform variable (if infrastructure-managed).
2. Inject it into the target resource `app_settings` block.
3. Read it in code via `os.getenv` with a safe default.
4. Update this file (single source of truth) and link from relevant READMEs.
5. If the value is sensitive, plan Key Vault integration (not plain text) and add a future migration note.

## Future Enhancements
- Key Vault integration for Speech/OpenAI keys (managed identity).
- Application Insights instrumentation key removed in favor of connection string + env.
- Azure App Configuration centralization (feature flags & dynamic log level).
- Pre-commit secret scanning (gitleaks) enforcing no accidental secret commit.
- Managed Identity (ingestion) replacing client secret, with app role still enforced.
- Key Vault references for `INGESTION_CLIENT_SECRET` (until certificate / MI migration complete).

---

