# SRS API Contract and Security Deltas

This document captures the API surface areas and security requirements that differ or are clarified for the SRS deployment, beyond the base README.

See also: `SRS-Feature-Deltas.md`, `Entra-ID-App-Registration-Guide.md`, `Configuration-Matrix.md`, `Observability-Guide.md`.

## Auth overview

- Interactive calls: Bearer JWT issued by Entra ID for the backend API audience.
- Required scope: Use the value configured in `azure_backend_scope` (Terraform). Default is `api://<backend-app-id>/user_impersonation`.
  - Note: Some legacy samples and Swagger OAuth setup use `access_as_user`. Always align the scope string with `azure_backend_scope`.
- App-only ingestion: Client credentials token with an app role in `roles` claim. Backend validates the role value from `SERVICE_PRINCIPAL_UPLOAD_ROLE` (environment-configurable).

## Primary endpoint groups (indicative)

- `POST /upload`
  - Auth: User JWT (delegated) with `azure_backend_scope`.
  - Responsibility: Upload audio; creates a job document; enqueues processing via Blob triggers.
  - Returns: Job id, status, links.

- `GET /upload/jobsmobilequery` (mobile-friendly query)
  - Auth: User JWT (delegated). When Swagger OAuth is enabled for testing, the OAuth2 implicit scheme is available.
  - Filters: `job_id`, `status`, `file_path`, `created_at`, `prompt_subcategory_id`.

- `POST /upload/machine` (if enabled)
  - Auth: App-only token with required role in `roles` claim.
  - Role value: `SERVICE_PRINCIPAL_UPLOAD_ROLE` (set per environment).
  - Use case: Trusted machine-to-machine ingestion without a user context.

- `GET /prompts/*`
  - Auth: User JWT (delegated).
  - Purpose: Fetch category/subcategory prompts; filtered by subcategory id.

- `GET /admin/*`
  - Auth: User JWT (delegated) plus application roles/claims where required (e.g., `roles` includes `admin`).

## Security controls

- CORS: Driven by `ALLOW_ORIGINS` in App Service. Production must use explicit origins (no wildcard).
- Swagger OAuth: Controlled by `ENABLE_SWAGGER_OAUTH` (default false). When disabled, docs are served without OAuth client config.
- Debug endpoints: Gated behind `ENABLE_DEBUG_ENDPOINTS=false` by default; when disabled, routes return 404.
- Token sanitization: Error messages should avoid leaking tokens or PII.
- App role for ingestion: `SERVICE_PRINCIPAL_UPLOAD_ROLE` (Terraform variable `service_principal_upload_role`) must match the backend app role assigned to the ingestion service principal.

## Response and error patterns

- Success: JSON with `status`, `job_id` (where applicable), and resource URLs.
- Failures: JSON with `status` (HTTP-aligned integer), and a `message` sanitized of secrets.
- Common failures:
  - 401/403: Missing scope/audience mismatch or missing app role.
  - 415: Unsupported audio type (see supported list in functions `config.py`).
  - 429: Upstream model throttling (OpenAI, Speech). Implement retries with backoff at caller if applicable.

## Verification checklist (API/security)

- [ ] Frontend uses `VITE_AZURE_BACKEND_SCOPE` matching Terraform `azure_backend_scope`.
- [ ] Backend validates audience; scope validation is implemented where applicable.
- [ ] App-only upload endpoints validate `roles` contains `SERVICE_PRINCIPAL_UPLOAD_ROLE`.
- [ ] Swagger OAuth disabled in production; when enabled in dev, scope matches `azure_backend_scope`.

Last updated: 2025-09-09
