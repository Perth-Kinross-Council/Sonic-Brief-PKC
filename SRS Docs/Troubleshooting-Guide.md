# Troubleshooting Guide (SRS)

| Symptom | Quick Triage | Deep Dive | Resolution |
|---------|-------------|-----------|-----------|
| 401 after login | Check scope string | Inspect decoded JWT audience | Align frontend scope / backend audience |
| No transcription | Function logs empty | Blob trigger path mismatch | Verify container name & upload path |
| Slow first request | Cold start | App Service plan size | Warm-up ping / scale plan |
| Retention not deleting | Dry-run enabled | Flag value | Set `retention_dry_run=false` |
| Legacy token accepted (unexpected) | AUTH_METHOD value | Config not updated | Set to `entra` and restart |

Expand with incident learnings.
