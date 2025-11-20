resource "azurerm_service_plan" "az_func_audio_service_plan" {
  name                = "${local.name_prefix}-audio-processor-${random_string.unique.result}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  os_type             = "Linux"
  sku_name            = "B1"
  tags                = local.default_tags

}

data "archive_file" "az_func_audio_package" {
  type        = "zip"
  source_dir  = "../az-func-audio"
  output_path = "./az-func-audio.zip"
  excludes = [
    ".vscode/**",
    ".venv/**",
    "**/__pycache__/**",
    "tests/**",
    "README.md",
    ".env.sample",
    ".env",
    ".env.test",
    ".env.test.sample",
  ]
}

# This resource will change whenever function_app.py changes
resource "null_resource" "force_zip_recreation" {
  triggers = {
    function_app_hash = filemd5("../az-func-audio/function_app.py")
  }
}

resource "azurerm_application_insights" "functions_app_insights" {
  name                = "${local.name_prefix}-audio-processor-${random_string.unique.result}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.log_analytics_workspace.id
  tags                = local.default_tags
}

resource "azurerm_linux_function_app" "function_call_function_app" {
  depends_on          = [azurerm_cognitive_deployment.openai_deployments, azurerm_cosmosdb_account.voice_account, azurerm_storage_account.storage]
  name                = "${local.name_prefix}-audio-processor-${random_string.unique.result}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location

  service_plan_id      = azurerm_service_plan.az_func_audio_service_plan.id
  storage_account_name = azurerm_storage_account.storage.name

  site_config {
    always_on                              = true
  remote_debugging_enabled               = false
    application_insights_connection_string = azurerm_application_insights.functions_app_insights.connection_string
    application_stack {
      python_version = "3.11"
    }
  ftps_state = "Disabled"

  }

  app_settings = {
    AZURE_COSMOS_ENDPOINT = azurerm_cosmosdb_account.voice_account.endpoint

  AZURE_STORAGE_ACCOUNT_URL          = "https://${azurerm_storage_account.storage.name}.blob.core.windows.net"
  AZURE_STORAGE_RECORDINGS_CONTAINER = azurerm_storage_container.container.name

  # --- Unused (commented) legacy / experimental settings (present in deployed env but not referenced in function code) ---
  # audio__accountName = azurerm_storage_account.storage.name
  # audio__credential  = "managedidentity"

    # Azure Cosmos DB Configuration
    AZURE_COSMOS_DB_PREFIX = "voice_"
    AZURE_COSMOS_DB        = azurerm_cosmosdb_sql_database.voice_db.name

    # Azure OpenAI Configuration
    AZURE_OPENAI_API_VERSION = var.openai_model_deployment_api_version
    AZURE_OPENAI_DEPLOYMENT  = var.openai_model_deployment_name
    AZURE_OPENAI_ENDPOINT    = azurerm_cognitive_account.openai.endpoint

    # Azure OpenAI Audio Model Configuration
    AZURE_AUDIO_MODEL       = var.openai_model_audio_deployment_name
    AZURE_AUDIO_API_VERSION = var.openai_model_audio_deployment_api_version
    TRANSCRIPTION_MODEL     = var.transcription_model

    # Azure Speech Services Configuration
    AZURE_SPEECH_CANDIDATE_LOCALES    = "en-US,zu-ZA,af-ZA"
    AZURE_SPEECH_DEPLOYMENT           = azurerm_cognitive_account.SpeechServices.name
    AZURE_SPEECH_MAX_SPEAKERS         = "2"
    AZURE_SPEECH_TRANSCRIPTION_LOCALE = "en-US"
  AzureWebJobsStorage               = azurerm_storage_account.storage.primary_connection_string

    # Entra ID / Azure AD Authentication
    AZURE_TENANT_ID   = var.azure_tenant_id
    ENTRA_CLIENT_ID   = var.azure_client_id
    AZURE_AUTHORITY   = var.azure_authority
    AZURE_AUDIENCE    = var.azure_audience

    # Retention Policy Configuration
    JOB_RETENTION_DAYS               = var.job_retention_days
    FAILED_JOB_RETENTION_DAYS        = var.failed_job_retention_days
    DELETE_COMPLETED_JOBS            = "true"
    ARCHIVE_COMPLETED_JOBS           = "false"
    RETENTION_DRY_RUN               = var.retention_dry_run
    ENABLE_AUTOMATIC_RETENTION      = var.enable_automatic_retention
    RETENTION_BATCH_SIZE            = var.retention_batch_size
    RETENTION_MAX_ERRORS            = var.retention_max_errors
  # Blob receipt cleanup
  BLOB_RECEIPT_CLEANUP_ENABLED    = var.blob_receipt_cleanup_enabled
  BLOB_RECEIPT_RETENTION_DAYS     = var.blob_receipt_retention_days
  BLOB_RECEIPT_CLEANUP_MAX        = var.blob_receipt_cleanup_max
  # Costing (GBP)
  MODEL_INPUT_COST_PER_MILLION    = tostring(var.model_input_cost_per_million)
  MODEL_OUTPUT_COST_PER_MILLION   = tostring(var.model_output_cost_per_million)
  SPEECH_AUDIO_COST_PER_HOUR      = tostring(var.speech_audio_cost_per_hour)
  # Concurrency / scaling
  FUNCTIONS_WORKER_PROCESS_COUNT  = tostring(var.function_worker_process_count)
  WEBSITE_MAX_DYNAMIC_APPLICATION_SCALE_OUT = "1" # Limit scale-out if using single instance B1 plan; adjust if upgrading plan
  # Explicit log level (consumed in config.py via FUNCTIONS_LOG_LEVEL; default INFO if unset)
  FUNCTIONS_LOG_LEVEL             = "INFO"

  # --- Platform-managed / implicit settings intentionally not set here ---
  # FUNCTIONS_EXTENSION_VERSION, FUNCTIONS_WORKER_RUNTIME, SCM_DO_BUILD_DURING_DEPLOYMENT,
  # APPLICATIONINSIGHTS_CONNECTION_STRING (provided via application_insights_connection_string above), AzureWebJobsDashboard
  # If you need to override any, add them explicitly; otherwise they're provided by the platform or other resources.
  }
  identity {
    type = "SystemAssigned"
  }
  tags = local.default_tags
}

# Wait for Function App platform stabilization before attempting deployment
resource "time_sleep" "wait_for_function_stable" {
  create_duration = "180s"
  depends_on      = [azurerm_linux_function_app.function_call_function_app]
}

# Diagnostic settings for Function App -> Log Analytics
resource "azurerm_monitor_diagnostic_setting" "function_app_diagnostics" {
  name                       = "${local.name_prefix}-func-diag"
  target_resource_id         = azurerm_linux_function_app.function_call_function_app.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.log_analytics_workspace.id

  enabled_log {
    category = "FunctionAppLogs"
  }
}

# Retry-based zip deployment to mitigate transient SCM restarts
resource "null_resource" "publish_function_call_zip" {
  triggers = {
    package_sha = data.archive_file.az_func_audio_package.output_sha
  }
  provisioner "local-exec" {
    interpreter = ["powershell", "-ExecutionPolicy", "Bypass", "-Command"]
    command = <<EOT
$ErrorActionPreference = 'Stop'
$rg = "${azurerm_linux_function_app.function_call_function_app.resource_group_name}"
$name = "${azurerm_linux_function_app.function_call_function_app.name}"

function Invoke-Deploy {
  Write-Host '[Function OneDeploy] Removing WEBSITE_RUN_FROM_PACKAGE if present'
  az functionapp config appsettings delete --resource-group $rg --name $name --setting-names WEBSITE_RUN_FROM_PACKAGE | Out-Null
  Write-Host '[Function OneDeploy] Deploying zip via az webapp deploy (OneDeploy)'
  az webapp deploy --resource-group $rg --name $name --src-path ./az-func-audio.zip --type zip --timeout 1200
}

$max = 5
$delay = 60
for($i=1; $i -le $max; $i++) {
  Write-Host "[Function OneDeploy] Attempt $i of $max"
  try {
    Invoke-Deploy
    if($LASTEXITCODE -eq 0){ Write-Host '[Function OneDeploy] Success'; exit 0 }
  } catch { Write-Warning "[Function OneDeploy] Error: $_" }
  if($i -lt $max){
    Write-Host "[Function OneDeploy] Sleeping $delay s before retry"
    Start-Sleep -Seconds $delay
    Write-Host '[Function OneDeploy] Restarting Function App to clear any stale deployments'
    az functionapp stop --resource-group $rg --name $name | Out-Null
    Start-Sleep -Seconds 10
    az functionapp start --resource-group $rg --name $name | Out-Null
  }
}
Write-Error '[Function OneDeploy] Failed after retries'; exit 1
EOT
  }
  depends_on = [time_sleep.wait_for_function_stable, data.archive_file.az_func_audio_package]
}


# Assign Cognitive Services Contributor role to the Web App
resource "azurerm_role_assignment" "cognitive_services_contributor" {
  depends_on           = [azurerm_linux_function_app.function_call_function_app, azurerm_cognitive_account.openai]
  scope                = azurerm_cognitive_account.openai.id
  role_definition_name = "Cognitive Services Contributor"

  principal_id                     = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
  skip_service_principal_aad_check = true
}


# Assign Cognitive Services OpenAI Contributor role to the Web App
resource "azurerm_role_assignment" "openai_contributor" {
  depends_on           = [azurerm_linux_function_app.function_call_function_app, azurerm_cognitive_account.openai]
  scope                = azurerm_cognitive_account.openai.id
  role_definition_name = "Cognitive Services OpenAI Contributor"

  principal_id                     = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
  skip_service_principal_aad_check = true

}

# Assign Cognitive Services OpenAI Contributor role to the Web App
resource "azurerm_role_assignment" "speech_contributor" {
  depends_on           = [azurerm_linux_function_app.function_call_function_app, azurerm_cognitive_account.SpeechServices]
  scope                = azurerm_cognitive_account.SpeechServices.id
  role_definition_name = "Cognitive Services Speech Contributor"

  principal_id                     = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
  skip_service_principal_aad_check = true

}

resource "azurerm_cosmosdb_sql_role_assignment" "data_reader_role" {
  depends_on          = [azurerm_linux_function_app.function_call_function_app, azurerm_cosmosdb_account.voice_account]
  name                = "736180af-7fbc-4c7f-9003-22735673c1c3"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name


  role_definition_id = azurerm_cosmosdb_sql_role_definition.data_reader.id
  principal_id       = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
  scope              = azurerm_cosmosdb_account.voice_account.id


}

resource "azurerm_cosmosdb_sql_role_assignment" "data_contributor_role" {
  depends_on          = [azurerm_linux_function_app.function_call_function_app, azurerm_cosmosdb_account.voice_account]
  name                = "736180af-7fbc-4c7f-9003-22895173c1c3"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name

  role_definition_id = azurerm_cosmosdb_sql_role_definition.data_contributor.id
  principal_id       = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
  scope              = azurerm_cosmosdb_account.voice_account.id

}


#Storage Account Contributor
resource "azurerm_role_assignment" "func_storage_account_contributor" {
  depends_on           = [azurerm_linux_function_app.function_call_function_app, azurerm_storage_account.storage]
  scope                = azurerm_storage_account.storage.id
  role_definition_name = "Storage Account Contributor"
  principal_id         = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
}

#Storage Blob Data Contributor
resource "azurerm_role_assignment" "func_storage_blob_data_contributor" {
  depends_on           = [azurerm_linux_function_app.function_call_function_app, azurerm_storage_account.storage]
  scope                = azurerm_storage_account.storage.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
}

#   Storage Queue Data Contributor
resource "azurerm_role_assignment" "func_storage_queue_data_contributor" {
  depends_on           = [azurerm_linux_function_app.function_call_function_app, azurerm_storage_account.storage]
  scope                = azurerm_storage_account.storage.id
  role_definition_name = "Storage Queue Data Contributor"
  principal_id         = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
}

#recordingcontainer
resource "azurerm_role_assignment" "func_recording_container_storage_contributor" {
  depends_on           = [azurerm_linux_function_app.function_call_function_app, azurerm_storage_container.container]
  scope                = azurerm_storage_container.container.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_function_app.function_call_function_app.identity[0].principal_id
}

resource "time_sleep" "wait_before_start" {
  depends_on      = [azurerm_linux_function_app.function_call_function_app]
  create_duration = "120s" # Adjust the time as needed
}


# # Define local-exec provisioner to run az cli commands

