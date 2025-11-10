# SRS Edition - MVP Deployment Configuration Guide

This document provides specific deployment configuration steps for the SRS Edition of Sonic Brief. The SRS Edition is an MVP solution with enterprise features that requires organizational review and testing before being considered production-ready for your specific environment.

## Who this is for

- Teams ready to evaluate and deploy the SRS Edition MVP with enterprise features
- System administrators configuring Entra ID authentication for organizational testing
- DevOps engineers setting up automated deployment for evaluation environments
- Organizations implementing MVP transcription solutions for internal assessment

> **📖 First time here?** Start with the main [README.md](./README.md) to understand the solution and choose your deployment path, then return here for SRS-specific configuration details.
> 
> **⚠️ Important**: This is an MVP solution requiring organizational review, security assessment, and potential modifications before being suitable for production use in your environment.

## 📚 Detailed Documentation

For comprehensive documentation, implementation details, and operational guidance, see the **[SRS Docs](./SRS%20Docs/)** folder which contains:

### 🚀 Getting Started

- **[Quick-Start-Guide.md](./SRS%20Docs/Quick-Start-Guide.md)** - Streamlined deployment for demos and rapid prototyping
- **[SRS-Redeployment-Guide.md](./SRS%20Docs/SRS-Redeployment-Guide.md)** - Complete step-by-step deployment instructions
- **[Entra-ID-App-Registration-Guide.md](./SRS%20Docs/Entra-ID-App-Registration-Guide.md)** - Detailed authentication setup

### 🏗️ Architecture & Design

- **[Auth-Architecture-SRS.md](./SRS%20Docs/Auth-Architecture-SRS.md)** - Authentication and authorization design
- **[SRS-Feature-Deltas.md](./SRS%20Docs/SRS-Feature-Deltas.md)** - Complete feature comparison vs. base implementation

### 🔧 Operations & Maintenance

- **[Configuration-Matrix.md](./SRS%20Docs/Configuration-Matrix.md)** - Environment configuration reference
- **[Troubleshooting-Guide.md](./SRS%20Docs/Troubleshooting-Guide.md)** - Common issues and solutions

### 🔒 Security & Compliance

- **[Security-Hardening-Status.md](./SRS%20Docs/Security-Hardening-Status.md)** - Implemented security features
- **[Security-Audit-Checklist.md](./SRS%20Docs/Security-Audit-Checklist.md)** - Production security verification

**💡 Tip**: Start with the [README.md](./SRS%20Docs/README.md) in the SRS Docs folder for a complete documentation overview and deployment path guidance.

## Prerequisites

Before deploying the SRS Edition, ensure you have:

- Azure subscription with Owner or Contributor access
- Azure OpenAI quota allocated (GPT-4o model availability in your region)
- Azure Speech Services quota (check regional availability)
- Two Entra ID app registrations (detailed below)
- Terraform installed (if using automated deployment) or Azure Portal access (for manual setup)

## Using GitHub Copilot for deployment assistance

**Highly recommended**: GitHub Copilot (even the free version) can significantly accelerate your deployment and troubleshooting process. We use this tool extensively during development, deployment, testing, and documentation.

### Why Copilot helps with this deployment

- **Context-aware guidance**: Open this repository in VS Code with Copilot enabled. It can read the codebase, configuration files, and this documentation to provide specific answers about your deployment.
- **Error resolution**: When you encounter errors (CORS issues, authentication failures, configuration mismatches), paste the error message into Copilot Chat and ask for help. It can analyze logs and suggest fixes.
- **Configuration validation**: Ask Copilot to review your `terraform.tfvars`, environment variables, or Entra ID app registration settings to catch common mistakes.
- **Step-by-step assistance**: If you're unsure about any deployment step, ask Copilot to explain it or provide the exact commands/settings you need.

### Practical examples

**During initial setup**:
```
@workspace How do I set up the two Entra ID app registrations for this deployment?
```

**When troubleshooting authentication**:
```
I'm getting "Invalid token" errors. My AZURE_AUDIENCE is set to api://abc123
and VITE_AZURE_BACKEND_SCOPE is api://abc123/user_impersonation. What's wrong?
```

**For Terraform issues**:
```
@workspace My terraform apply failed with "quota exceeded" for OpenAI.
What are my options?
```

**Configuration verification**:
```
Can you check if my backend environment variables are complete? Here's my list: [paste your settings]
```

### How to get started with Copilot

1. **Install**: Get the GitHub Copilot extension for VS Code (free tier available)
2. **Open this repo**: Clone this repository and open it in VS Code
3. **Use Chat**: Press `Ctrl+I` (Windows) or `Cmd+I` (Mac) to open Copilot Chat
4. **Use `@workspace`**: Prefix questions with `@workspace` to give Copilot full repository context

**Pro tip**: Keep deployment logs, error messages, and configuration files open in VS Code tabs when asking Copilot for help. It can reference open files for more accurate suggestions.

## What's different vs. the base Sonic Brief

The SRS Edition transforms the base Sonic Brief proof-of-concept into an MVP solution with enterprise features. This enhanced version is closer to production-readiness than the base implementation but still requires organizational review, security assessment, and potential customization for production deployment.

### Key New Features Added in SRS Edition

#### 🎙️ **Audio Recording in Browser**
- **Direct browser recording**: Users can now record audio directly within the web interface without needing external recording devices
- **Multiple input formats**: Support for various audio formats including WAV, MP3, and OGG
- **Automatic audio format conversion**: Uploaded audio files are automatically converted to the optimal format for transcription processing

#### 🔐 **Microsoft Entra ID Authentication**
- **Enterprise single sign-on**: Full integration with Microsoft Entra ID (formerly Azure AD) for seamless organizational authentication
- **Conditional access support**: Compatibility with organizational security policies and multi-factor authentication
- **Role-based access**: User permissions and access controls aligned with organizational directory structures

#### ⚡ **Transcription-Only Processing**
- **Flexible processing options**: Users can choose to process an existing transcript
- **Cost optimization**: Option to skip transcription stage when existing transcript is provided
- **Workflow efficiency**: Streamlined processing path for use cases that only require transcript summary

#### 📊 **Analytics & Reporting**
- **Usage dashboards**: Analytics showing processing volumes, success rates, and system performance
- **Cost tracking**: Detailed breakdown of processing costs by user, department, or time period
- **Performance metrics**: Processing time analytics, transcription accuracy insights, and system health monitoring
- **Export capabilities**: Data export functionality for integration with external reporting systems

#### 🔍 **Comprehensive Auditing**
- **Complete audit trail**: Detailed logging of all user actions, processing events, and system changes
- **Compliance reporting**: Audit logs designed to meet organizational compliance and governance requirements
- **Event tracking**: Monitoring of file uploads, processing status changes, user logins, and administrative actions
- **Searchable audit interface**: User-friendly interface for searching and filtering audit events

#### 🎨 **Enhanced User Experience**
- **Improved navigation**: Streamlined interface with better organization of features and content
- **Real-time status updates**: Live progress indicators for transcription and summarization processes
- **Advanced file management**: Better organization and search capabilities for processed recordings and reports
- **Mobile-responsive design**: Optimized interface that works seamlessly across desktop, tablet, and mobile devices

#### 🔧 **Administrative Features**
- **User management**: Administrative interface for managing users, roles, and permissions
- **System configuration**: Centralized configuration management for operational settings
- **Data retention policies**: Configurable retention settings for automatic cleanup of old recordings and data

#### 🛡️ **Enterprise Security**
- **Enhanced data protection**: Advanced security measures for protecting sensitive audio content and transcriptions
- **Secure token handling**: Improved authentication token management and security
- **Environment isolation**: Clear separation between development, testing, and production environments
- **Compliance ready**: Features designed to support organizational security and compliance requirements

#### 📱 **Mobile Frontend Solution**
- **Partnership development**: Developed in collaboration with Servent (https://servent.co.uk/) to provide comprehensive mobile access to Sonic Brief
- **Cross-platform compatibility**: Designed primarily for Android devices with deployable support for iOS platforms
- **Offline and online recording**: Full audio recording capabilities that work seamlessly whether connected or disconnected from the network
- **Hybrid data synchronization**: Recordings captured offline are synchronized when connectivity is restored
- **Entra ID authentication**: Integrated Microsoft Entra ID authentication for secure access to uploads and existing recordings
- **Complete mobile experience**: Access to all previously submitted recordings with full transcript and summary viewing capabilities
- **Organizational compliance**: Built-in data retention policies that can align with organizational governance and data management requirements
- **Seamless integration**: Designed to be compatible with the SRS Sonic Brief

> **⚠️ MVP Considerations**: While these features provide enterprise functionality, organizations should conduct thorough testing, security review, and customization assessment before production deployment.

### What This Means for Deployment

The SRS Edition focuses on production readiness, operational control, and enterprise authentication. These enhancements were developed to meet the needs of large-scale organizational deployments.

### Authentication and authorization

**Why the change**: Enterprise organizations require modern identity integration with conditional access policies and centralized user management.

- Microsoft Entra ID (Azure AD) support as the primary authentication method (SPA + API)
- Dual-mode option during migration: legacy JWT remains available if AUTH_METHOD=both
- Canonical API scope: `api://{backend-app-id}/user_impersonation`
- Background token refresh and advanced caching for improved user experience

### Operational controls (environment driven)

**Why the change**: Production environments need flexible configuration without code changes or redeployments.

- CORS via `ALLOW_ORIGINS` (no wildcards in production for security)
- Logging levels for backend and functions (`BACKEND_LOG_LEVEL`, `FUNCTIONS_LOG_LEVEL`)
- Debug routes gated by `ENABLE_DEBUG_ENDPOINTS=false` by default (security-first approach)
- Optional Swagger OAuth gated by `ENABLE_SWAGGER_OAUTH=false` by default

### Reliability and maintainability

**Why the change**: Large teams need consistent patterns and error handling across the codebase.

- Centralized API URL handling and structured fetch error handling on the frontend
- Cleaner configuration mapping from Terraform → App Settings
- Enhanced retry logic with exponential backoff for authentication
- Comprehensive audit logging for compliance requirements

### Security posture

**Why the change**: Production deployments require defense-in-depth and secure defaults.

- Token redaction in error surfaces (prevents credential leakage in logs)
- Production-safe defaults for debug endpoints and Swagger OAuth
- Enhanced input validation and sanitization
- Security-gated diagnostic endpoints (404 when disabled)

## Compatibility and migration

- You can run "Entra only" (recommended) or "both" to keep legacy JWT available during transition.
- No change to core data flow or storage layout is required to adopt SRS Edition.

## About the Servent Mobile frontend (optional)

This repository includes a **Mobile frontend** solution developed by Servent as a separate folder.  This is a Hybrid .NET MAUI (Android / iOS) + Blazor application targeting .NET9. It is an optional mobile interface for Sonic Brief that is **not covered by the deployment guides or Terraform scripts** in this document.

### Important notes

- **Standalone solution**: The mobile frontend is a completely separate application with its own deployment process
- **Not integrated**: It is **not** included in the Terraform infrastructure automation or the deployment steps outlined in this guide
- **Own README**: The mobile frontend folder contains its own README with specific deployment instructions
- **Repository organization**: The mobile solution is included here for completeness and convenience, but can be managed independently

### Recommended approach

If you plan to use the Servent Mobile frontend:

1. **Copy to separate location**: Consider copying the mobile frontend folder to its own repository or workspace for independent version control and deployment
2. **Follow its own README**: Use the deployment instructions in the mobile frontend's README file, not this document
3. **Separate lifecycle**: Treat it as a separate project with its own dependencies, build process, and deployment pipeline

If you don't need the mobile frontend, you can safely ignore or remove its folder without affecting the core Sonic Brief deployment.

## Minimal deployment deltas (over and above the root README)

Follow the root README for the standard architecture, then add the SRS-specific steps below.

### 1) Create two Entra ID app registrations

**Why needed**: Entra ID uses separate app registrations for the backend API (which exposes scopes) and the frontend SPA (which requests those scopes).

1. **Backend API app registration**

   - Navigate to Azure Portal → Entra ID → App registrations → New registration
   - Name: `sonic-brief-api-{your-org}`
   - Supported account types: Single tenant (recommended)
   - **Expose an API** → Add Application ID URI (e.g., `api://{backend-app-id}`)
   - **Expose an API** → Add scope: `user_impersonation` (enabled, admin consent not required)

2. **Frontend SPA app registration**

   - Navigate to Azure Portal → Entra ID → App registrations → New registration
   - Name: `sonic-brief-frontend-{your-org}`
   - Supported account types: Single tenant (recommended)
   - Platform: Single-page application
   - **API permissions** → Add permission → My APIs → Select your backend API → Delegated permissions → `user_impersonation`
   - **Authentication** → Add platform → Single-page application
   - Add redirect URIs for your Static Web App (e.g., `https://{your-swa}.azurestaticapps.net`)

**Record these values** (you'll need them for environment configuration):

- Tenant ID (from Azure Portal → Entra ID → Overview)
- Backend Client ID (from backend app registration → Overview)
- Frontend Client ID (from frontend app registration → Overview)
- Application ID URI (from backend app → Expose an API), e.g., `api://{backend-app-id}`
- Full scope string, e.g., `api://{backend-app-id}/user_impersonation`

### 2) Configure environment variables

**Backend App Service** – Set these in Azure Portal → App Service → Configuration → Application settings:

**Authentication (required)**:

- `AUTH_METHOD=entra` (use `both` only if you need legacy JWT during migration)
- `ENTRA_CLIENT_ID={backend-client-id}` (use the backend API app client ID)
- `AZURE_TENANT_ID={tenant-guid}` (your Azure AD tenant ID)
- `AZURE_AUTHORITY=https://login.microsoftonline.com/{tenant-guid}`
- `AZURE_AUDIENCE=api://{backend-app-id}` (the Application ID URI you set up)

**Azure Services (required)**:

- `SPEECH_KEY={your-speech-service-key}` (from Azure Speech Service)
- `SPEECH_REGION={your-region}` (e.g., `eastus`)
- `OPENAI_API_KEY={your-openai-key}` (from Azure OpenAI Service)
- `OPENAI_ENDPOINT={your-openai-endpoint}` (e.g., `https://{name}.openai.azure.com/`)

**Operational controls (recommended)**:

- `BACKEND_LOG_LEVEL=INFO` (or `WARNING` in steady state)
- `ALLOW_ORIGINS=https://{your-swa}.azurestaticapps.net` (comma-separated list, no wildcards)
- `ENABLE_DEBUG_ENDPOINTS=false` (recommended for production)
- `ENABLE_SWAGGER_OAUTH=false` (recommended for production)

**Azure Functions** – Set these in Azure Portal → Function App → Configuration → Application settings:

- `FUNCTIONS_LOG_LEVEL=INFO` (controls Azure Functions logging verbosity)
- Same `SPEECH_KEY`, `SPEECH_REGION`, `OPENAI_API_KEY`, `OPENAI_ENDPOINT` as backend

**Frontend (Static Web App)** – Set these via environment variables or build configuration:

- `VITE_AUTH_METHOD=entra` (must match backend setting)
- `VITE_AZURE_CLIENT_ID={frontend-client-id}` (use the frontend SPA app client ID)
- `VITE_AZURE_TENANT_ID={tenant-guid}` (same as backend)
- `VITE_AZURE_BACKEND_SCOPE=api://{backend-app-id}/user_impersonation` (the full scope string)
- `VITE_API_URL=https://{your-backend}.azurewebsites.net` (your backend API URL)

### 3) Terraform deployment (optional, but recommended)

**Why use Terraform**: Infrastructure as Code ensures consistent, repeatable deployments and makes it easier to manage multiple environments (dev/staging/prod).

If using the provided Terraform configuration in `infra/`:

1. Copy `terraform.tfvars.sample` to `terraform.tfvars`
2. Fill in your values (tenant IDs, client IDs, subscription ID, etc.)
3. Run `terraform init && terraform plan && terraform apply`

**Key Terraform variables** that map to the environment variables above:

| Terraform variable | App Setting | Purpose |
|--------------------|------------|---------|
| `azure_tenant_id` | `AZURE_TENANT_ID` | Your Entra ID tenant |
| `azure_client_id` | `ENTRA_CLIENT_ID` | Backend API client ID |
| `azure_frontend_client_id` | `VITE_AZURE_CLIENT_ID` | Frontend SPA client ID |
| `azure_audience` | `AZURE_AUDIENCE` | Backend API Application ID URI |
| `azure_backend_scope` | `VITE_AZURE_BACKEND_SCOPE` | Full scope string for frontend |
| `backend_log_level` | `BACKEND_LOG_LEVEL` | Backend logging verbosity |
| `allow_origins` | `ALLOW_ORIGINS` | CORS origins list |

**Manual deployment**: If not using Terraform, create resources via Azure Portal and set the environment variables manually in each resource's Configuration settings.


## Quick validation checklist

After deployment, verify these key functions:

### Authentication

- Navigate to your Static Web App URL
- Log in via Entra ID (you should see Microsoft login page)
- After login, you should be redirected to the Sonic Brief dashboard
- Test API call: `GET {backend-url}/auth/me` should return a user object with `auth_type:"entra"`

### CORS

- Open browser developer tools (F12) → Console tab
- Verify no CORS errors when making API calls from the frontend
- If you see CORS errors, check that `ALLOW_ORIGINS` includes your Static Web App URL

### Audio Processing

- Upload a short test audio file (30 seconds or less)
- Verify job status progresses: `pending` → `transcribing` → `transcribed` → `completed`
- Download the generated transcript and summary
- Check Azure Functions logs if processing fails

### Security

- Try accessing debug endpoints (e.g., `{backend-url}/debug-audit`)
- With `ENABLE_DEBUG_ENDPOINTS=false`, these should return 404
- Verify Swagger UI OAuth is disabled if `ENABLE_SWAGGER_OAUTH=false`

## Common issues and troubleshooting

### Authentication fails with "Invalid token" or 401 errors

**Cause**: Token validation mismatch between frontend and backend.

**Fix**:
- Verify `AZURE_AUDIENCE` in backend matches the Application ID URI
- Confirm `VITE_AZURE_BACKEND_SCOPE` in frontend matches the exposed scope exactly
- Check that both apps are in the same tenant
- Ensure the frontend app has API permissions granted (with admin consent if required)

### CORS errors in browser console

**Cause**: Backend doesn't recognize the frontend origin.

**Fix**:
- Add your Static Web App URL to `ALLOW_ORIGINS` (exact match, including https://)
- No trailing slashes in the origin URL
- Restart the App Service after changing configuration
- For local development, add `http://localhost:5173` and `http://localhost:3000`

### Audio processing fails or times out

**Cause**: Missing or invalid Azure service credentials.

**Fix**:
- Verify `SPEECH_KEY` and `SPEECH_REGION` are correct in Function App settings
- Confirm `OPENAI_API_KEY` and `OPENAI_ENDPOINT` are valid
- Check Azure OpenAI deployment name matches your configuration
- Verify you have quota available for both Speech and OpenAI services
- Check Function App logs in Azure Portal → Function App → Log stream

### Static Web App shows "Not Found" or blank page

**Cause**: Build or deployment issue.

**Fix**:
- Check Static Web App deployment logs in GitHub Actions (if using GitHub deployment)
- Verify `VITE_API_URL` points to your backend App Service
- Ensure all required `VITE_*` environment variables are set in Static Web App configuration
- Clear browser cache and try incognito mode

### "Insufficient quota" errors

**Cause**: Azure OpenAI or Speech Service quota limits reached.

**Fix**:
- Check quota usage in Azure Portal → Azure OpenAI → Quotas
- Request quota increase if needed
- Consider using a different region with available quota
- For testing, use shorter audio files to reduce quota consumption

## 📚 Next Steps

This guide covers the essential SRS Edition deployment configuration. For comprehensive documentation including operational procedures, architecture details, and advanced troubleshooting:

**Visit the [SRS Docs](./SRS%20Docs/) folder** - Start with [README.md](./SRS%20Docs/README.md) for complete documentation overview and recommended deployment paths.

**Need help choosing?** Return to the main [README.md](./README.md) for deployment path guidance and feature comparisons.

---

*This guide focuses on SRS Edition deployment specifics. Last updated: 2025-11-05*
