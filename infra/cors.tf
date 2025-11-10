locals {
  swa_origin = "https://${azurerm_static_web_app.frontend_webapp.default_host_name}"

  normalized_extra_origins = [for o in var.extra_allowed_origins : trimspace(replace(o, "/$", ""))]
  normalized_swa_origin    = trimspace(replace(local.swa_origin, "/$", ""))

  backend_allowed_origins     = distinct(concat([local.normalized_swa_origin], local.normalized_extra_origins))
  backend_allowed_origins_csv = join(",", local.backend_allowed_origins)
}

resource "null_resource" "configure_backend_cors" {
  count = var.configure_backend_cors_via_cli ? 1 : 0

  depends_on = [
    azurerm_static_web_app.frontend_webapp,
    azurerm_linux_web_app.backend_webapp,
    null_resource.deploy_frontend
  ]

  triggers = {
    backend_name    = azurerm_linux_web_app.backend_webapp.name
    backend_rg      = azurerm_linux_web_app.backend_webapp.resource_group_name
    origins_hash    = sha256(local.backend_allowed_origins_csv)
    subscription_id = var.subscription_id
  }

  provisioner "local-exec" {
    interpreter = ["powershell", "-Command"]
    command     = <<EOT
      $ErrorActionPreference = 'Stop'
      $rg  = "${azurerm_linux_web_app.backend_webapp.resource_group_name}"
      $app = "${azurerm_linux_web_app.backend_webapp.name}"
      $originsCsv = "${local.backend_allowed_origins_csv}"
      $origins = $originsCsv.Split(',') | ForEach-Object { $_.TrimEnd('/') }

      az account set --subscription ${var.subscription_id} | Out-Null

      # Reset platform CORS to exact allowed origins
      $current = az webapp cors show --resource-group $rg --name $app | ConvertFrom-Json
      if ($current.allowedOrigins -ne $null -and $current.allowedOrigins.Count -gt 0) {
        foreach ($o in $current.allowedOrigins) {
          az webapp cors remove --resource-group $rg --name $app --allowed-origins $o | Out-Null
        }
      }
      foreach ($o in $origins) {
        if ($o) { az webapp cors add --resource-group $rg --name $app --allowed-origins $o | Out-Null }
      }

      # Set ALLOW_ORIGINS for backend app code (FastAPI CORSMiddleware)
      az webapp config appsettings set --resource-group $rg --name $app --settings ALLOW_ORIGINS=$originsCsv | Out-Null
    EOT
  }
}
