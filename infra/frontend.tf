# step 8) Create static Web App for frontend
resource "azurerm_static_web_app" "frontend_webapp" {
  depends_on          = [azurerm_linux_web_app.backend_webapp]
  name                = "${local.name_prefix}-sonic-brief-${random_string.unique.result}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = var.static_web_location
  tags                = local.default_tags
  app_settings = {
  # Frontend API base URL -> point to backend web app
  "VITE_API_URL"             = "https://${azurerm_linux_web_app.backend_webapp.default_hostname}"
  # Branding
  "VITE_APP_SUBTITLE"        = var.frontend_app_subtitle
  "VITE_APP_TITLE"           = var.frontend_app_title
  # Auth config (reuse backend auth_method var for frontend)
  "VITE_AUTH_METHOD"         = var.auth_method
  # Azure Entra/MSAL params
  "VITE_AZURE_AUDIENCE"      = var.azure_audience
  "VITE_AZURE_BACKEND_SCOPE" = var.azure_backend_scope
  "VITE_AZURE_CLIENT_ID"     = var.azure_frontend_client_id
  "VITE_AZURE_TENANT_ID"     = var.azure_tenant_id
  # Other UI env
  "VITE_BASE_URL"            = "/"
  "VITE_JOB_RETENTION_DAYS"  = tostring(var.job_retention_days)
  }
}

# Build and deploy the frontend
resource "null_resource" "build_frontend" {
  depends_on = [azurerm_static_web_app.frontend_webapp]
  triggers = {
    # Trigger rebuild when key files change
    package_json = filemd5("../frontend_app/package.json")
    vite_config = filemd5("../frontend_app/vite.config.js")
    # You can add more triggers for src files if needed
  }
  
  provisioner "local-exec" {
    working_dir = "../frontend_app"
    command = "npm install --legacy-peer-deps && npm run build"
  }
}

resource "null_resource" "deploy_frontend" {
  depends_on = [null_resource.build_frontend]
  triggers = {
    # Always deploy after build
    build_complete = null_resource.build_frontend.id
  }
  
  provisioner "local-exec" {
    command = "swa deploy ../frontend_app/dist --env production --deployment-token '${azurerm_static_web_app.frontend_webapp.api_key}'"
  }
}
