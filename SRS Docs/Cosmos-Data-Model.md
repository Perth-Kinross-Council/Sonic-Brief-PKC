# Cosmos Data Model (SRS)

This page documents the Cosmos DB logical model used by Sonic Brief SRS. Cross-check with `infra/cosmos.tf` and application code in `az-func-audio/` and `backend_app/`.

See also: `Data-Retention-Policy.md`, `SRS-Feature-Deltas.md`, `Observability-Guide.md`.

## Database

- Name: `VoiceDB`
- Mode: SQL API, serverless, BoundedStaleness (per Terraform)

## Containers

1. voice_auth

- Partition key: `/id`
- Unique key(s): `/email`
- Typical docs: user records with `id`, `email`, `roles`, `auth_method`.
- Indexing: email and catch‑all; excludes `_etag`.

1. voice_jobs

- Partition key: `/id` (point reads by id)
- Unique key(s): `/user_id`, `/created_at`
- Indexed fields include: `/user_id`, `/prompt_category_id`, `/prompt_subcategory_id`, `/status`, `/created_at`, `/audit_trail`, `/metrics/processing_time_ms`, `/metrics/file_size_bytes`.
- Typical job document fields observed in code:
  - `id` (string)
  - `type`: "job"
  - `status`: "uploaded" | "transcribing" | "transcribed" | "completed" | "failed"
  - `file_path`, `transcription_file_path`, `analysis_file_path`
  - `prompt_category_id`, `prompt_subcategory_id`
  - `user_id`
  - `created_at`, `updated_at` (ISO8601)
  - `metrics` (object), `audit_trail` (array)

1. voice_prompts

- Partition key: `/id`
- Unique key(s): `/name`
- Indexed fields include: `/type`, `/category_id`, `/name`
- Contents:
  - Category docs (`type=prompt_category`), subcategory docs (`type=prompt_subcategory`)
  - For subcategories, a `prompts` object keyed by title is expected by functions.

1. audit_logs

- Partition key: `/date` (e.g., yyyy‑MM‑dd)
- TTL: `var.audit_retention_seconds`
- Indexed: `/user_id`, `/action_type`, `/resource_id`, `/timestamp`, `/component` + catch‑all
- Purpose: compliance/usage audits from backend and functions.

1. job_activity_logs

- Partition key: `/job_id`
- TTL: `var.audit_retention_seconds`
- Indexed: `/job_id`, `/activity_type`, `/status`, `/timestamp`, `/component`, `/user_id` + catch‑all
- Purpose: detailed job lifecycle events for troubleshooting.

1. blob_lifecycle_logs

- Partition key: `/date`
- TTL: `var.blob_lifecycle_retention_seconds`
- Indexed: `/blob_url`, `/operation_type`, `/job_id`, `/timestamp`, `/user_id` + catch‑all
- Purpose: storage lifecycle operations (deletes, moves) for audit.

1. system_metrics

- Partition key: `/metric_type`
- TTL: `var.metrics_retention_seconds`
- Indexed: `/metric_type`, `/timestamp`, `/component`, `/severity`, `/value` + catch‑all
- Purpose: platform metrics not suited for Log Analytics.

1. usage_analytics

- Partition key: `/user_id`
- TTL: `var.usage_analytics_retention_seconds`
- Indexed: `/user_id`, `/event_type`, `/date`, `/job_id`, `/file_type`, `/processing_status`, `/timestamp` + catch‑all
- Purpose: product usage/telemetry analytics.

## Sample documents (redacted)

voice_jobs

```json
{
  "id": "job_12345",
  "type": "job",
  "status": "transcribed",
  "user_id": "u_abc",
  "file_path": "https://.../recordings/abc.wav",
  "transcription_file_path": "https://.../transcripts/abc.txt",
  "analysis_file_path": "https://.../analysis/abc.json",
  "prompt_category_id": "cat_001",
  "prompt_subcategory_id": "sub_017",
  "created_at": "2025-08-20T14:03:25Z",
  "updated_at": "2025-08-20T14:29:01Z",
  "metrics": { "processing_time_ms": 93211, "file_size_bytes": 4183211 }
}
```

voice_prompts (subcategory)

```json
{
  "id": "sub_017",
  "type": "prompt_subcategory",
  "category_id": "cat_001",
  "name": "Medical Appointment",
  "prompts": {
    "Default": "You are a helpful assistant...",
    "Compliance": "Summarize with compliance focus..."
  }
}
```

## Operational notes

- Functions use managed identity to access Cosmos (no key in code).
- Jobs are upserted with updated `updated_at`. Reads by id use partition key `id` for efficient lookups.
- Prompt retrieval expects `type='prompt_subcategory'` and an `id` equal to subcategory id.
- URL fields are normalized (spaces, unescape) before lookups; ensure clients record consistent blob URLs.


