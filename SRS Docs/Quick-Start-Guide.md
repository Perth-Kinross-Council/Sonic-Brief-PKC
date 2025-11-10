# Sonic Brief SRS - Quick Start Guide

> **Goal**: Get a working SRS instance deployed in 1-2 hours with minimal complexity. This guide focuses on the essential steps—refer to detailed guides for production hardening.

## Prerequisites Checklist

| Requirement | Status | Notes |
|-------------|--------|-------|
| Azure Subscription with Owner/Contributor access | ⬜ | Need to create resources and assign roles |
| Azure OpenAI quota in your region | ⬜ | Check `gpt-4o` availability |
| Azure Speech Services quota | ⬜ | Verify regional availability |
| Local machine with Terraform/PowerShell | ⬜ | Or use Azure Cloud Shell |

## 🚀 30-Minute Deployment Path

### Step 1: Create Entra ID App Registrations (10 minutes)

1. **Backend API App**:
   - Azure Portal → Entra ID → App registrations → New registration
   - Name: `sonic-brief-api-{your-suffix}`
   - Platform: Web
   - **Expose an API** → Add scope `user_impersonation`
   - Record: `Client ID`, `Tenant ID`, `Application ID URI`

2. **Frontend SPA App**:
   - New registration: `sonic-brief-frontend-{your-suffix}`
   - Platform: Single-page application
   - **API permissions** → Add permission → My APIs → Select backend → `user_impersonation`
   - Record: `Client ID`

> **💡 Detailed Steps**: See [`Entra-ID-App-Registration-Guide.md`](./Entra-ID-App-Registration-Guide.md)

### Step 2: Deploy Infrastructure (15 minutes)

1. **Clone and Configure**:
   ```powershell
   git clone https://github.com/SimonHarris101/Sonic-Brief-RC-V1.git
   cd Sonic-Brief-RC-V1/infra
   cp terraform.tfvars.sample terraform.tfvars
   cp backend.tf.sample backend.tf
   ```

2. **Edit terraform.tfvars** with your values:
   ```hcl
   subscription_id = "your-subscription-id"
   environment = "dev"
   prefix = "sbrs-"
   azure_tenant_id = "your-tenant-id"
   azure_client_id = "backend-app-client-id"
   azure_frontend_client_id = "frontend-app-client-id"
   azure_audience = "api://backend-app-client-id"
   azure_backend_scope = "api://backend-app-client-id/user_impersonation"
   ```

3. **Deploy**:
   ```powershell
   terraform init
   terraform plan
   terraform apply
   ```

### Step 3: Configure Frontend Redirects (5 minutes)

After deployment completes:

1. **Get Static Web App URL** from Terraform output
2. **Update Frontend App Registration**:
   - Azure Portal → Entra ID → App registrations → Frontend app
   - Authentication → Add redirect URI: `https://{your-swa-url}.azurestaticapps.net`

## ⚡ Essential Configuration

### Environment Variables (Auto-configured by Terraform)

| Variable | Purpose | Default |
|----------|---------|---------|
| `ALLOW_ORIGINS` | CORS origins | Your Static Web App URL |
| `BACKEND_LOG_LEVEL` | Logging verbosity | `INFO` |
| `ENABLE_DEBUG_ENDPOINTS` | Debug routes | `false` (secure) |

### First Test

1. **Navigate to your Static Web App URL**
2. **Sign in with Entra ID**
3. **Upload a short audio file**
4. **Verify transcription and summarization work**

## 🛠️ Development Setup (Optional)

### Local Frontend Development

```powershell
cd frontend_app
npm install
npm run dev
```

### Local Backend Development

```powershell
cd backend_app
pip install -r requirements.txt
# Configure .env with your Azure resources
python -m uvicorn app.main:app --reload
```

## 📊 Health Checks

| Component | Check | Expected |
|-----------|--------|----------|
| Frontend | Browse to Static Web App | Login page loads |
| Backend | `{backend-url}/health` | `{"status": "healthy"}` |
| Authentication | Sign in with Entra ID | Redirects to dashboard |
| Processing | Upload test audio | Status progresses to "completed" |

## 🔧 Common Issues & Quick Fixes

### Authentication Fails
- **Check**: Frontend app redirect URI matches deployed URL
- **Fix**: Update app registration with exact Static Web App URL

### CORS Errors
- **Check**: `ALLOW_ORIGINS` includes frontend URL
- **Fix**: Update App Service application settings

### Audio Processing Fails
- **Check**: Azure OpenAI and Speech Service keys are configured
- **Fix**: Verify quotas and regional availability

### Files Not Uploading
- **Check**: Storage account configuration and permissions
- **Fix**: Verify managed identity has Blob Storage access

## 📖 Additional Resources

### For Production Use
1. **Security Hardening**: Follow [`Security-Audit-Checklist.md`](./Security-Audit-Checklist.md)
2. **Monitoring Setup**: Configure alerts per [`Observability-Guide.md`](./Observability-Guide.md)
3. **Data Retention**: Review [`Data-Retention-Policy.md`](./Data-Retention-Policy.md)

### For Development
1. **Configuration Management**: Review [`Configuration-Matrix.md`](./Configuration-Matrix.md)
2. **Troubleshooting**: Bookmark [`Troubleshooting-Guide.md`](./Troubleshooting-Guide.md)

## 🆘 Need Help?

| Issue Type | Resource |
|------------|----------|
| Deployment Problems | [`SRS-Redeployment-Guide.md`](./SRS-Redeployment-Guide.md) |
| Authentication Issues | [`Auth-Architecture-SRS.md`](./Auth-Architecture-SRS.md) |
| Runtime Problems | [`Troubleshooting-Guide.md`](./Troubleshooting-Guide.md) |
| Configuration Questions | [`Configuration-Matrix.md`](./Configuration-Matrix.md) |

## Deployment Time Expectations

| Phase | Time | Complexity |
|-------|------|------------|
| App Registrations | 10 min | Low |
| Terraform Deployment | 15 min | Medium |
| Frontend Configuration | 5 min | Low |
| **Total First Deployment** | **30 min** | **Low-Medium** |
| Production Hardening | +2 hours | Medium-High |

---

