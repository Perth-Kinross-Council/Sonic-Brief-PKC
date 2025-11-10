output "frontend_url" {
  value = azurerm_static_web_app.frontend_webapp.default_host_name
}

output "backend_url" {
  value = azurerm_linux_web_app.backend_webapp.default_hostname
}

output "function_app_url" {
  value = azurerm_linux_function_app.function_call_function_app.default_hostname
}

output "cosmos_db_endpoint" {
  value = azurerm_cosmosdb_account.voice_account.endpoint
}

output "storage_account_name" {
  value = azurerm_storage_account.storage.name
}

output "openai_endpoint" {
  value = azurerm_cognitive_account.openai.endpoint
}

output "speech_service_endpoint" {
  value = azurerm_cognitive_account.SpeechServices.endpoint
}

# output "cognitive_deployment_id" {
#   value = azurerm_cognitive_account.SpeechServices.id
# }

# output "open_ai_deployments" {
#   value = azurerm_cognitive_deployment.openai_deployments
# }

output "az_func_audio_package_sha" {
  value       = data.archive_file.az_func_audio_package.output_sha
  description = "SHA hash of the az-func-audio.zip package to force archive creation during plan."
}

output "az_func_audio_package_path" {
  value       = data.archive_file.az_func_audio_package.output_path
  description = "Path to the az-func-audio.zip package. Forces zip creation during terraform plan."
}

output "retention_configuration" {
  value = {
    job_retention_days         = var.job_retention_days
    failed_job_retention_days  = var.failed_job_retention_days
    retention_dry_run          = var.retention_dry_run
    enable_automatic_retention = var.enable_automatic_retention
    retention_batch_size       = var.retention_batch_size
  }
  description = "Current retention policy configuration"
}

# Audit Infrastructure Outputs
output "audit_containers" {
  value = {
    audit_logs         = azurerm_cosmosdb_sql_container.audit_logs_container.name
    job_activity_logs  = azurerm_cosmosdb_sql_container.job_activity_logs_container.name
    blob_lifecycle_logs = azurerm_cosmosdb_sql_container.blob_lifecycle_logs_container.name
    system_metrics     = azurerm_cosmosdb_sql_container.system_metrics_container.name
    usage_analytics    = azurerm_cosmosdb_sql_container.usage_analytics_container.name
  }
  description = "Names of audit logging Cosmos DB containers"
}

output "audit_retention_configuration" {
  value = {
    audit_retention_seconds           = var.audit_retention_seconds
    metrics_retention_seconds         = var.metrics_retention_seconds
    usage_analytics_retention_seconds = var.usage_analytics_retention_seconds
    blob_lifecycle_retention_seconds  = var.blob_lifecycle_retention_seconds
  }
  description = "TTL configuration for audit containers"
}
