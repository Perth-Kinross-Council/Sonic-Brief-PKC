# SRS Redeployment Guide

Comprehensive checklist for deploying a new SRS instance of Sonic Brief into a **separate Azure subscription / tenant**.

> Goal: Achieve a clean, functional environment with minimal manual drift from IaC (Terraform) and correct Entra ID + resource identities.

---
## 1. Prerequisites
| Item | Notes |
|------|-------|
| Azure Subscription | Owner or Contributor + User Access Administrator to assign roles |
| Terraform Backend | (Recommended) Remote state (e.g., Azure Storage) per environment |
| Two Entra App Registrations | Backend API & Frontend SPA (single tenant or multi-tenant decision) |
| Azure OpenAI Quota | Region + model availability (gpt‑4o / embeddings) |
| Speech Service Quota | Region (latency + compliance) |
| Domain / Custom Hostnames (Optional) | DNS + certificate plan |

> **Security Note:** Never commit actual secrets, API keys, or production GUIDs to source control. Use placeholders in documentation and manage secrets through Azure App Settings or Key Vault.

## 2. Create / Configure Entra ID App Registrations

> **📖 Detailed Instructions:** For complete step-by-step guidance, see [`Entra-ID-App-Registration-Guide.md`](./Entra-ID-App-Registration-Guide.md)

| Step | Backend API App | Frontend SPA App |
|------|-----------------|------------------|
| Platform | Web/API (expose API) | SPA / Single Page Application |
| Expose API | Application ID URI (e.g., `api://<backend-client-id>`) | N/A |
| Scope | `user_impersonation` (add description, enabled) | Add as delegated permission (API Permissions) |
| Redirect URIs | (If interactive tools) optional | Frontend URL(s): local dev + deployed SWA |
| Certificates & Secrets | Not required for implicit MSAL SPA | None |
| Token Config | (Optional) Add groups/roles claims if needed | N/A |

Record:
* Tenant ID
* Backend Client ID
* Frontend Client ID
* Audience / App ID URI
* Scope full string: `api://<backend-client-id>/user_impersonation`

## 3. Prepare Terraform Variables
Create `terraform.tfvars` (or use `.auto.tfvars`) based on `infra/variables.tf.sample`:
```
subscription_id              = "<new-sub-id>"
environment                  = "dev-srs"
prefix                       = "srs-"         # avoid collisions
azure_tenant_id              = "<tenant-guid>"
azure_client_id              = "<backend-app-guid>"
azure_frontend_client_id     = "<frontend-app-guid>"
azure_audience               = "api://<backend-app-guid>"
azure_backend_scope          = "api://<backend-app-guid>/<user_impersonation_scope>"
frontend_static_hostname     = "placeholder-static-host.auto.azurestaticapps.net"
auth_method                  = "entra"         # do not default to both
job_retention_days           = 15
blob_receipt_retention_days  = 15
openai_location              = "swedencentral" # confirm quota
voice_location               = "northeurope"   # confirm latency
```

> Ensure **all** globally unique names (storage, static web app, openai service, etc.) are derived from `prefix + environment` to avoid collisions.

## 4. Terraform Apply Order (if splitting state)
If using a single state file, a single `terraform apply` is sufficient. If modularizing:
1. Resource Group + Log Analytics
2. Networking / Storage / Cosmos
3. OpenAI + Speech
4. Function App + App Service (backend)
5. Static Web App

## 5. Post-Provision Role Assignments
| Principal | Resource | Role | Why |
|----------|----------|------|-----|
| Backend App Service (MSI) | Cosmos DB Account | Cosmos DB Built-in Data Contributor | Read/write jobs, logs |
| Function App (MSI) | Storage Account | Storage Blob Data Contributor | Audio blob access |
| Function App (MSI) | Cosmos DB Account | Cosmos DB Built-in Data Contributor | Write transcription / analysis |
| (Optional) Backend MSI | Key Vault | Key Vault Secrets User | Secret retrieval if using Key Vault |

Validate via Portal or CLI (ARG queries) that assignments exist.

## 6. Configure Frontend
After first SWA deploy Azure assigns a hostname. Update:
* `frontend_static_hostname` variable (for subsequent applies)
* CORS origins in backend & function app (if not wildcard, ensure SWA domain present)

## 7. Application Settings (Runtime Drift Watchlist)
Ensure the following Terraform-provisioned settings match portal runtime:
| Setting | Backend | Function App | Frontend (VITE_*) |
|---------|---------|--------------|-------------------|
| AUTH_METHOD | entra | N/A | VITE_AUTH_METHOD=entra |
| AZURE_* (tenant/client/audience) | ✔ | (subset if needed) | VITE_AAD_TENANT, VITE_AAD_CLIENT_ID |
| RETENTION / JOB vars | ✔ | ✔ (if functions read them) | VITE_RETENTION_DAYS (UI display only) |
| OPENAI_* | ✔ | (only if functions call analysis) | N/A |
| SPEECH_* | ✔ | ✔ | N/A |

## 8. Deployment Steps (End-to-End)
1. `terraform init && terraform apply` (confirm output endpoints)
2. Build & deploy backend (CI/CD or manual zip)
3. Package & deploy functions (zip or func deploy)
4. Build frontend & deploy to SWA (`swa deploy` or GitHub Action)
5. Update SWA hostname variable & re-apply Terraform (so backend CORS stays consistent)
6. Smoke test: login (MSAL), upload audio, observe transcription & summary, retention dry-run logs.

## 8.1. Manual Deployment Fallback (When Terraform Doesn't Deploy Code)

> **⚠️ Known Issue**: While Terraform builds Azure resources correctly, it sometimes fails to deploy application code to the assets. Use these manual commands as a fallback.

### Prerequisites for Manual Deployment

Before running manual deployment commands:

1. Ensure Terraform has successfully created all Azure resources
2. Note the resource names from Terraform output (they contain random suffixes)
3. Have deployment tokens and credentials ready

### Deploy Backend API

```bash
# Navigate to infra folder to ensure zip files are generated
cd infra

# Run terraform to generate zip files (if not already done)
terraform init
terraform plan

# Deploy backend using Azure CLI
az webapp deployment source config-zip \
  --resource-group <resource-group-name> \
  --name <backend-app-service-name> \
  --src backend.zip
```

**Example:**

```bash
az webapp deployment source config-zip \
  --resource-group myorg-sb-v2t-dev-v2-accelerator-rg \
  --name myorg-sb-v2t-dev-v2-echo-brief-backend-api-xxxx \
  --src backend.zip
```

### Deploy Function App

```bash
# Deploy function app using Azure CLI (from infra folder)
az functionapp deployment source config-zip \
  --subscription <subscription-id> \
  --resource-group <resource-group-name> \
  --name <function-app-name> \
  --src az-func-audio.zip \
  --build-remote true
```

**Example:**

```bash
az functionapp deployment source config-zip \
  --subscription 12345678-1234-1234-1234-123456789012 \
  --resource-group myorg-sb-v2t-dev-v2-accelerator-rg \
  --name myorg-sb-v2t-dev-v2-audio-processor-xxxx \
  --src az-func-audio.zip \
  --build-remote true
```

### Deploy Frontend (Static Web App)

```bash
# Navigate to frontend_app folder
cd frontend_app

# Install dependencies and build (using pnpm)
pnpm install
pnpm build

# Deploy to Static Web App using SWA CLI
swa deploy ./dist \
  --env=production \
  --deployment-token=<your-deployment-token>
```

> **📝 Note:** This project uses `pnpm` as the package manager. If you prefer `npm`, use these equivalent commands:
>
> ```bash
> npm install
> npm run build
> ```

**Example:**

```bash
swa deploy ./dist \
  --env=production \
  --deployment-token=abcd1234efgh5678ijkl9012mnop3456qrst7890uvwx1234yz567890ab
```

### Getting Required Values

**Resource Names:** Check Terraform output or Azure Portal for exact resource names with random suffixes.

**Deployment Token:**

1. Go to Azure Portal → Static Web Apps → Your SWA resource
2. Navigate to "Deployment tokens"
3. Copy the deployment token

**Subscription ID:**

```bash
az account show --query id --output tsv
```

**Resource Group:** Check Terraform variables or output for the exact resource group name.

### Manual Deployment Order

1. **Backend API** - Deploy first as other components may depend on it
2. **Function App** - Deploy audio processing functions
3. **Frontend** - Deploy last to ensure backend is ready

### Verification After Manual Deployment

After manual deployment, verify:

* Backend API responds at `https://<backend-name>.azurewebsites.net/health`
* Function App shows deployed functions in Azure Portal
* Frontend loads correctly at Static Web App URL
* End-to-end audio processing workflow works

### Troubleshooting Manual Deployment

**Backend deployment fails:**

* Ensure `backend.zip` exists in infra folder (run `terraform plan` to generate)
* Check App Service logs for deployment errors

**Function deployment fails:**

* Verify `az-func-audio.zip` exists in infra folder
* Try without `--build-remote true` flag if remote build fails
* Check Function App logs for errors

**Frontend deployment fails:**

* Verify SWA deployment token is correct and not expired
* Ensure `pnpm build` completed successfully
* Check if `./dist` folder contains built files

## 9. Likely Issues & Mitigations
| Category | Symptom | Cause | Mitigation |
|----------|---------|-------|-----------|
| Auth – 401 | MSAL obtains token but API 401 | Scope mismatch (frontend using wrong `azure_backend_scope`) | Align scope string; purge cached token; re-login |
| Auth – Silent Legacy Use | Legacy endpoints active | AUTH_METHOD left as `both` | Set `auth_method="entra"` and redeploy |
| CORS | Browser blocked | SWA host not in allowed origins | Add SWA hostname & re-apply / restart |
| OpenAI | 429 / model not found | Region lacks model quota | Pick supported region; request quota increase |
| Speech | 403 / region mismatch | Speech resource region differs from function config | Align `voice_location` & function env |
| Storage Name Conflict | Apply fails | Global name already taken | Adjust `prefix`/`environment` to new unique string |
| Cosmos Throughput Throttle | High latency | Insufficient RU/s | Scale provisioned throughput or enable autoscale |
| Retention Deleting Too Soon | Missing historical jobs | Wrong `job_retention_days` | Increase value; disable automatic retention temporarily |
| Function Cold Starts | Slow first transcription | Consumption plan & concurrency | Consider Premium plan or prewarming strategy |
| Missing MSI Role | Runtime 403 Cosmos / Storage | Role assignment lag or missing | Re-run role assignment; wait propagation (~5m) |

## 10. Validation Checklist (Pre Go-Live)
* [ ] Login succeeds (MSAL) and access token audience matches `azure_audience`.
* [ ] Audio upload -> transcription -> summary pipeline completes.
* [ ] Cosmos containers populated (jobs, job_activity_logs, audit_logs).
* [ ] Retention dry-run (if enabled) logs candidate deletions only.
* [ ] OpenAI summarization returns content (no 429/401).
* [ ] Structured logs visible in Log Analytics.
* [ ] No legacy auth endpoints reachable (if disabled).
* [ ] Frontend displays correct environment name & retention days.

## 11. Base vs SRS Differentiators Summary

| Aspect | Base | SRS |
|--------|------|-----|
| Auth Default | (Legacy or hybrid) | Entra only |
| Retention Config | Basic / partial | Parameterized + dry-run & receipt cleanup |
| Infra Variables | Minimal | Extended (costing, retention, alerts) |
| Security Features | Basic | Production-hardened with comprehensive controls |

---

Maintain this guide with each architectural change to prevent knowledge drift.
