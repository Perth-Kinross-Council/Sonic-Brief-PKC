# Observability Guide (SRS)

This guide shows how to monitor Sonic Brief using Log Analytics and Application Insights. Infra wires diagnostics for Functions, Cosmos, Storage, and Azure OpenAI into the Log Analytics workspace.

References: `infra/log_analytics.tf`, `infra/az_functions.tf`, `infra/cosmos.tf`, `infra/storage_account.tf`, `infra/openai.tf`.

## Where logs go

- Azure Functions: Application Insights + Log Analytics (AppRequests, AppTraces, AppDependencies)
- Cosmos DB: AzureDiagnostics (DataPlaneRequests, QueryRuntimeStatistics, PartitionKeyStatistics)
- Storage Account: AzureDiagnostics (Blob/Queue metrics)
- Azure OpenAI: AzureDiagnostics (Cognitive Services)

## KQL cookbook

Function failures (last 24h)

```kusto
AppRequests
| where timestamp > ago(24h)
| where success == false
| project timestamp, name, resultCode, duration, operation_Id, operation_Name
| order by timestamp desc
```

Function exceptions (stack + custom dims)

```kusto
AppTraces
| where timestamp > ago(24h)
| where severityLevel >= 3
| project timestamp, message, severityLevel, operation_Id, customDimensions
| order by timestamp desc
```

Slow function executions (> 5s)

```kusto
AppRequests
| where timestamp > ago(24h)
| extend durMs = toint(duration / 1ms)
| where durMs > 5000
| project timestamp, name, durMs, resultCode, operation_Id
| order by durMs desc
```

Azure OpenAI rate limits / errors

```kusto
AzureDiagnostics
| where TimeGenerated > ago(24h)
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES/ACCOUNTS"
| where tostring(OperationName) contains "TextGeneration" or tostring(OperationName) contains "ChatCompletions"
| project TimeGenerated, OperationName, ResultType, ResultSignature, ResultDescription, correlationId_g
| order by TimeGenerated desc
```

Cosmos DB throttling (429 RequestRateTooLarge)

```kusto
AzureDiagnostics
| where TimeGenerated > ago(24h)
| where ResourceProvider == "MICROSOFT.DOCUMENTDB/databaseAccounts"
| where toint(StatusCode) == 429 or ResultType == "429"
| project TimeGenerated, requestResourceType_s, collectionName_s, ActivityId_g, DurationMs_d, StatusCode
| order by TimeGenerated desc
```

Cosmos query hotspots (RU heavy)

```kusto
AzureDiagnostics
| where TimeGenerated > ago(24h)
| where ResourceProvider == "MICROSOFT.DOCUMENTDB/databaseAccounts"
| where Category == "QueryRuntimeStatistics"
| project TimeGenerated, collectionName_s, QueryText_s, RetrievedDocumentCount_d, RetrievedDocumentSizeBytes_d, OutputDocumentCount_d
| order by RetrievedDocumentSizeBytes_d desc
```

Storage 403/404 errors (blob)

```kusto
AzureDiagnostics
| where TimeGenerated > ago(24h)
| where ResourceProvider == "MICROSOFT.STORAGE/STORAGEACCOUNTS"
| where Category has "Blob" and (StatusCode == 403 or StatusCode == 404)
| project TimeGenerated, OperationName, Uri, StatusCode, CallerIpAddress
| order by TimeGenerated desc
```

401/403 auth errors seen by Functions (if proxied)

```kusto
AppRequests
| where timestamp > ago(24h)
| where resultCode in ("401", "403")
| project timestamp, name, resultCode, operation_Id
| order by timestamp desc
```

Correlate a failing request to traces/dependencies

```kusto
let op = toscalar(AppRequests | where timestamp > ago(24h) and success == false | top 1 by timestamp desc | project operation_Id);
AppTraces
| where operation_Id == op
| project timestamp, message, severityLevel
| order by timestamp asc
```

## Tips

- Use operation_Id to correlate AppRequests, AppDependencies, and AppTraces.
- Pin common queries as Saved searches in the workspace.
- Set alert rules on key queries (e.g., Functions failures rate > N/min, Cosmos 429 spikes, OpenAI 429 spikes).
- Ensure Application Insights sampling is appropriate for load (reduce for production diagnostics).


