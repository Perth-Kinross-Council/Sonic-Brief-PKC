# Azure Functions (az-func-audio) Hardening Notes

This function app processes audio via a Blob trigger and writes results to Storage and Cosmos DB.

## New settings
- AZURE_STORAGE_DEADLETTER_CONTAINER: destination for failed blobs (default: <recordings>-deadletter)
- FUNC_MAX_ATTEMPTS: max processing attempts per blob (default: 3)
- FUNC_BACKOFF_BASE_SECONDS: base for exponential backoff (default: 2)
- FUNC_BACKOFF_MAX_SECONDS: cap for backoff (default: 30)
- SKIP_TOKEN_VALIDATION: allow system-triggered runs without a Bearer token (default: false)

## Behavior
- Idempotency: skips jobs already transcribed or completed.
- Retries: bounded exponential backoff with jitter around external calls (download, AI, Speech).
- Dead-letter: after max attempts, blob is moved to dead-letter and job marked failed.
- Metrics: processing time, size, and duration captured where possible.

## Operational notes
- Ensure the function's managed identity has permissions to read/write both the recordings and dead-letter containers.
- Verify Cosmos containers exist; audit containers are best-effort and non-fatal if missing.
- functionTimeout is set to 10 minutes in host.json.
