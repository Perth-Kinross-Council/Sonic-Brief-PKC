# Data Retention Policy (SRS)

| Data Type | Container / Store | Retention (Days/Secs) | Rationale |
|-----------|-------------------|-----------------------|-----------|
| Completed Jobs | Cosmos (jobs) | 15 days | Cost + relevance |
| Failed Jobs | Cosmos (jobs) | 14 days | Debug window |
| Blob Receipts | Storage receipts | 15 days | Reinforce idempotency |
| Audit Logs | Cosmos audit | 7 years (220752000s) | Long-term compliance retention |
| Metrics | Cosmos metrics | 90 days | Trend analysis |
| Usage Analytics | Cosmos usage | 3 years | Reporting |
| Blob Lifecycle Logs | Cosmos lifecycle | 1 year | Ops review |

Adjust per jurisdictional / compliance requirements.
