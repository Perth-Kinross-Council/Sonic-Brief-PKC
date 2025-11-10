# Generate a random complex password
resource "random_password" "db_password" {
  length           = 16
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "azurerm_cosmosdb_account" "voice_account" {
  name                = "${local.name_prefix}-voice-${random_string.unique.result}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  identity {
    type = "SystemAssigned"
  }
  consistency_policy {
    consistency_level       = "BoundedStaleness"
    max_interval_in_seconds = 5
    max_staleness_prefix    = 100
  }

  geo_location {
    location          = azurerm_resource_group.rg.location
    failover_priority = 0
    zone_redundant    = false
  }



  is_virtual_network_filter_enabled = false
  public_network_access_enabled     = true
  analytical_storage_enabled        = false
  minimal_tls_version               = "Tls12"

  multiple_write_locations_enabled   = false
  automatic_failover_enabled         = false
  free_tier_enabled                  = false
  access_key_metadata_writes_enabled = false



  backup {
    type                = "Periodic"
    storage_redundancy  = "Geo"
    interval_in_minutes = 240
    retention_in_hours  = 8
  }
  capabilities {
    name = "EnableServerless"
  }

  capacity {
    total_throughput_limit = 4000
  }
  tags = local.default_tags

}

resource "azurerm_cosmosdb_sql_database" "voice_db" {
  name                = "VoiceDB"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
}

resource "azurerm_monitor_diagnostic_setting" "cosmos_diagnostics" {
  name                       = "${local.name_prefix}-cosmos-diag"
  target_resource_id         = azurerm_cosmosdb_account.voice_account.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.log_analytics_workspace.id

  enabled_log {
    category = "DataPlaneRequests"
  }

  enabled_log {
    category = "QueryRuntimeStatistics"
  }

  enabled_log {
    category = "PartitionKeyStatistics"
  }
}

resource "azurerm_cosmosdb_sql_container" "voice_auth_container" {
  name                = "voice_auth"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  database_name       = azurerm_cosmosdb_sql_database.voice_db.name

  partition_key_paths   = ["/id"]
  partition_key_version = 2

  # Unique key block: enforce uniqueness on the email field.
  unique_key {
    paths = ["/email"]
  }

  conflict_resolution_policy {
    mode                     = "LastWriterWins"
    conflict_resolution_path = "/_ts"
  }

  indexing_policy {
    indexing_mode = "consistent"

    # Index the email property.
    included_path {
      path = "/email/?"
    }

    # Catch-all path to index any other properties.
    included_path {
      path = "/*"
    }

    # Exclude the _etag system property.
    excluded_path {
      path = "/_etag/?"
    }
  }
}

resource "azurerm_cosmosdb_sql_container" "voice_jobs_container" {
  name                = "voice_jobs"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  database_name       = azurerm_cosmosdb_sql_database.voice_db.name

  partition_key_paths   = ["/id"]
  partition_key_version = 2

  # Unique key block: enforce uniqueness on the combination of user_id and created_at.
  unique_key {
    paths = ["/user_id", "/created_at"]
  }

  conflict_resolution_policy {
    mode                     = "LastWriterWins"
    conflict_resolution_path = "/_ts"
  }

  indexing_policy {
    indexing_mode = "consistent"

    # Index the user_id property.
    included_path {
      path = "/user_id/?"
    }

    # Index the prompt_category_id property.
    included_path {
      path = "/prompt_category_id/?"
    }

    # Index the prompt_subcategory_id property.
    included_path {
      path = "/prompt_subcategory_id/?"
    }

    # Index the status property.
    included_path {
      path = "/status/?"
    }

    # Index the created_at property.
    included_path {
      path = "/created_at/?"
    }

    # Index audit trail array generically (nested wildcard segments invalid in Cosmos DB)
    included_path {
      path = "/audit_trail/?"
    }

    # Index metrics properties for performance analytics
    included_path {
      path = "/metrics/processing_time_ms/?"
    }

    included_path {
      path = "/metrics/file_size_bytes/?"
    }

    # Catch-all path to index any other properties.
    included_path {
      path = "/*"
    }

    # Exclude the _etag system property.
    excluded_path {
      path = "/_etag/?"
    }
  }
}

resource "azurerm_cosmosdb_sql_container" "voice_prompts_container" {
  name                = "voice_prompts"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  database_name       = azurerm_cosmosdb_sql_database.voice_db.name

  partition_key_paths   = ["/id"]
  partition_key_version = 2

  # Unique key block: enforce uniqueness on the name field.
  unique_key {
    paths = ["/name"]
  }

  conflict_resolution_policy {
    mode                     = "LastWriterWins"
    conflict_resolution_path = "/_ts"
  }

  indexing_policy {
    indexing_mode = "consistent"

    # Index the type property (to differentiate between categories and subcategories).
    included_path {
      path = "/type/?"
    }

    # Index the category_id property (used in subcategories).
    included_path {
      path = "/category_id/?"
    }

    # Index the name property.
    included_path {
      path = "/name/?"
    }

    # Catch-all path to index any other properties.
    included_path {
      path = "/*"
    }

    # Exclude the _etag system property.
    excluded_path {
      path = "/_etag/?"
    }
  }
}

# Audit Logging Containers - Added to match existing Azure infrastructure
resource "azurerm_cosmosdb_sql_container" "audit_logs_container" {
  name                = "audit_logs"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  database_name       = azurerm_cosmosdb_sql_database.voice_db.name

  partition_key_paths   = ["/date"]
  partition_key_version = 2

  # TTL for compliance retention (7 years)
  default_ttl = var.audit_retention_seconds

  conflict_resolution_policy {
    mode                     = "LastWriterWins"
    conflict_resolution_path = "/_ts"
  }

  indexing_policy {
    indexing_mode = "consistent"

    # Index user activity properties
    included_path {
      path = "/user_id/?"
    }

    included_path {
      path = "/action_type/?"
    }

    included_path {
      path = "/resource_id/?"
    }

    included_path {
      path = "/timestamp/?"
    }

    included_path {
      path = "/component/?"
    }

    # Catch-all path
    included_path {
      path = "/*"
    }

    # Exclude system properties
    excluded_path {
      path = "/_etag/?"
    }
  }
}

resource "azurerm_cosmosdb_sql_container" "job_activity_logs_container" {
  name                = "job_activity_logs"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  database_name       = azurerm_cosmosdb_sql_database.voice_db.name

  partition_key_paths   = ["/job_id"]
  partition_key_version = 2

  # TTL matches job retention policy
  default_ttl = var.audit_retention_seconds

  conflict_resolution_policy {
    mode                     = "LastWriterWins"
    conflict_resolution_path = "/_ts"
  }

  indexing_policy {
    indexing_mode = "consistent"

    # Index job lifecycle properties
    included_path {
      path = "/job_id/?"
    }

    included_path {
      path = "/activity_type/?"
    }

    included_path {
      path = "/status/?"
    }

    included_path {
      path = "/timestamp/?"
    }

    included_path {
      path = "/component/?"
    }

    included_path {
      path = "/user_id/?"
    }

    # Catch-all path
    included_path {
      path = "/*"
    }

    # Exclude system properties
    excluded_path {
      path = "/_etag/?"
    }
  }
}

resource "azurerm_cosmosdb_sql_container" "blob_lifecycle_logs_container" {
  name                = "blob_lifecycle_logs"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  database_name       = azurerm_cosmosdb_sql_database.voice_db.name

  partition_key_paths   = ["/date"]
  partition_key_version = 2

  # TTL for blob operations tracking
  default_ttl = var.blob_lifecycle_retention_seconds

  conflict_resolution_policy {
    mode                     = "LastWriterWins"
    conflict_resolution_path = "/_ts"
  }

  indexing_policy {
    indexing_mode = "consistent"

    # Index blob operation properties
    included_path {
      path = "/blob_url/?"
    }

    included_path {
      path = "/operation_type/?"
    }

    included_path {
      path = "/job_id/?"
    }

    included_path {
      path = "/timestamp/?"
    }

    included_path {
      path = "/user_id/?"
    }

    # Catch-all path
    included_path {
      path = "/*"
    }

    # Exclude system properties
    excluded_path {
      path = "/_etag/?"
    }
  }
}

resource "azurerm_cosmosdb_sql_container" "system_metrics_container" {
  name                = "system_metrics"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  database_name       = azurerm_cosmosdb_sql_database.voice_db.name

  partition_key_paths   = ["/metric_type"]
  partition_key_version = 2

  # TTL for metrics retention (90 days default)
  default_ttl = var.metrics_retention_seconds

  conflict_resolution_policy {
    mode                     = "LastWriterWins"
    conflict_resolution_path = "/_ts"
  }

  indexing_policy {
    indexing_mode = "consistent"

    # Index performance metrics properties
    included_path {
      path = "/metric_type/?"
    }

    included_path {
      path = "/timestamp/?"
    }

    included_path {
      path = "/component/?"
    }

    included_path {
      path = "/severity/?"
    }

    included_path {
      path = "/value/?"
    }

    # Catch-all path
    included_path {
      path = "/*"
    }

    # Exclude system properties
    excluded_path {
      path = "/_etag/?"
    }
  }
}

resource "azurerm_cosmosdb_sql_container" "usage_analytics_container" {
  name                = "usage_analytics"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  database_name       = azurerm_cosmosdb_sql_database.voice_db.name

  partition_key_paths   = ["/user_id"]
  partition_key_version = 2

  # TTL for usage analytics (3 years default)
  default_ttl = var.usage_analytics_retention_seconds

  conflict_resolution_policy {
    mode                     = "LastWriterWins"
    conflict_resolution_path = "/_ts"
  }

  indexing_policy {
    indexing_mode = "consistent"

    # Index usage analytics properties
    included_path {
      path = "/user_id/?"
    }

    included_path {
      path = "/event_type/?"
    }

    included_path {
      path = "/date/?"
    }

    included_path {
      path = "/job_id/?"
    }

    included_path {
      path = "/file_type/?"
    }

    included_path {
      path = "/processing_status/?"
    }

    included_path {
      path = "/timestamp/?"
    }

    # Catch-all path
    included_path {
      path = "/*"
    }

    # Exclude system properties
    excluded_path {
      path = "/_etag/?"
    }
  }
}

resource "azurerm_cosmosdb_sql_role_definition" "data_reader" {
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  name                = "${local.name_prefix}-voice-reader-role"
  type                = "BuiltInRole"
  assignable_scopes   = [azurerm_cosmosdb_account.voice_account.id]



  permissions {
    data_actions = ["Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/read",
      "Microsoft.DocumentDB/databaseAccounts/readMetadata",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/executeQuery",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/readChangeFeed",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/read"
    ]
  }
}

resource "azurerm_cosmosdb_sql_role_definition" "data_contributor" {
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = azurerm_cosmosdb_account.voice_account.name
  name                = "${local.name_prefix}-voice-contributer-role"
  type                = "BuiltInRole"
  assignable_scopes   = [azurerm_cosmosdb_account.voice_account.id]


  permissions {
    data_actions = [
      "Microsoft.DocumentDB/databaseAccounts/readMetadata",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/*",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/*"
    ]
  }
}
