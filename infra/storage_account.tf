
# Storage Account
resource "azurerm_storage_account" "storage" {
  name                     = "tfsonicbrief${random_string.unique.result}"
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  shared_access_key_enabled = true

  tags = local.default_tags
}

# Storage Container
resource "azurerm_storage_container" "container" {
  name                  = var.storage_container_name
  storage_account_id    = azurerm_storage_account.storage.id
  container_access_type = "private"
}


# Diagnostics for Storage Account -> Log Analytics (account-level metrics)
resource "azurerm_monitor_diagnostic_setting" "storage_diagnostics" {
  name                       = "${local.name_prefix}-storage-diag"
  target_resource_id         = azurerm_storage_account.storage.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.log_analytics_workspace.id

  metric {
    category = "Capacity"
    enabled  = true
    retention_policy {
      enabled = false
      days    = 0
    }
  }

  metric {
    category = "Transaction"
    enabled  = true
    retention_policy {
      enabled = false
      days    = 0
    }
  }
}



