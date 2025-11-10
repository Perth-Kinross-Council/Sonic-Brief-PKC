# SRS Documentation Overview

The **SRS Docs** folder contains implementation-specific documentation for the "SRS" (separate / derivative) deployment of Sonic Brief. These documents highlight what differs from the base Sonic Brief implementation and guide developers & operations through standing up, operating, and hardening an SRS environment.

## 🚀 Quick Start Guide

### For New Implementers

1. **Start Here**: [`Quick-Start-Guide.md`](./Quick-Start-Guide.md) - Essential deployment steps and gotchas
2. **Authentication Setup**: [`Entra-ID-App-Registration-Guide.md`](./Entra-ID-App-Registration-Guide.md) - Step-by-step Entra ID configuration
3. **Deployment**: Choose your path:
   - **Automated**: [`SRS-Redeployment-Guide.md`](./SRS-Redeployment-Guide.md) with Terraform
   - **Manual**: [`../manual-deployment/README.md`](../manual-deployment/README.md) via Azure Portal

### Deployment Path Selection

| Path | Use Case | Time | Complexity | Guide |
|------|----------|------|------------|-------|
| **Quick Start** | Rapid prototyping, demos | 30 min | Low | [`Quick-Start-Guide.md`](./Quick-Start-Guide.md) |
| **Automated (Terraform)** | Production environments | 1-2 hours | Medium | [`SRS-Redeployment-Guide.md`](./SRS-Redeployment-Guide.md) |
| **Manual (Portal)** | Learning, custom configs | 2-3 hours | High | [`../manual-deployment/README.md`](../manual-deployment/README.md) |

**Selection Guidance**:
- **Choose Quick Start** if you need a working demo quickly and aren't concerned about production-grade security
- **Choose Automated** for production deployments with infrastructure as code
- **Choose Manual** if you need to understand every component or have complex organizational requirements

### For Ongoing Operations
1. **Configuration Management**: [`Configuration-Matrix.md`](./Configuration-Matrix.md)
2. **Troubleshooting**: [`Troubleshooting-Guide.md`](./Troubleshooting-Guide.md)

## Document Index

| File | Purpose | Audience |
|------|---------|----------|
| **Deployment & Setup** | | |
| `Quick-Start-Guide.md` | **NEW** - Streamlined getting started guide | New implementers |
| `SRS-Redeployment-Guide.md` | End‑to‑end checklist for cloning & re-deploying into a fresh Azure tenant/subscription | DevOps engineers |
| `Entra-ID-App-Registration-Guide.md` | Detailed step-by-step instructions for creating and configuring Entra ID App Registrations | IT administrators |
| **Configuration & Management** | | |
| `Configuration-Matrix.md` | Side‑by‑side variable / setting comparison: Base vs SRS vs Environment overrides | DevOps, system admins |
| `Environment-Comparison-Guide.md` | Configuration comparison across dev/staging/production environments for drift detection | Operations teams |
| **Architecture & Security** | | |
| `Auth-Architecture-SRS.md` | Authentication & authorization design (Entra ID app registrations, scopes, legacy deprecation flags) | Architects, security teams |
| `SRS-API-Contract-and-Security.md` | Endpoint auth models, security expectations, error patterns, verification checklist | Developers, security auditors |
| `Cosmos-Data-Model.md` | Containers, partition keys, TTLs, indexing, sample documents | Database administrators |
| `Security-Hardening-Status.md` | Completed security hardening features and implementation status | Security teams |
| `Security-Audit-Checklist.md` | Production security verification checklist and quarterly review items | Compliance officers |
| **Operations** | | |
| `Observability-Guide.md` | Log Analytics/Application Insights queries and alert ideas | Operations teams |
| `Troubleshooting-Guide.md` | Common failure modes, symptoms, root causes, and resolution steps | Support teams |
| `Data-Retention-Policy.md` | Retention parameters, rationale, compliance notes | Compliance, data governance |
| **Process & Quality** | | |
| `Release-Checklist.md` | Pre-release verification & promotion checklist (dev → test → prod) | Release managers |
| `SRS-Feature-Deltas.md` | Detailed list of features, enhancements, and architectural changes added in SRS vs the base Sonic Brief | Product managers, stakeholders |

## How to Use

### First-Time Deployment
1. **Start with the Quick Start Guide** for rapid deployment overview
2. **Follow the Redeployment Guide** for detailed step-by-step instructions
3. **Populate the Configuration Matrix early**—keeps drift visible
4. **Complete security hardening** using the audit checklist

### Ongoing Operations
1. **Keep documentation current**—drives operational maturity
2. **Link any incident post‑mortems back into Troubleshooting** for knowledge capture
3. **Use Environment Comparison Guide** for regular drift detection
4. **Follow Release Checklist** for consistent deployments

## Base vs SRS Scope

"Base" refers to the reference implementation (minus Entra auth adaptations). "SRS" extends it with:

### 🔐 **Authentication & Security**
* Entra ID dual app registrations (frontend + backend) & scope alignment
* Enhanced token management with performance monitoring
* Security hardening (token redaction, debug endpoint gating, Swagger OAuth control)
* Advanced authentication controls and monitoring

### 🛠️ **Operational Excellence**
* Expanded retention automation & cleanup jobs
* Terraform‑driven environment variable parity enforcement
* Environment-driven configuration (CORS, logging, debug endpoints)
* Centralized configuration management with canonical documentation
* Deployment utilities for clean environment testing

### 🎨 **Developer Experience**
* Modern frontend tooling (ESLint v9, Prettier, EditorConfig)
* Enhanced API client architecture with structured error handling
* Comprehensive CI/CD verification workflows
* Root-level proxy scripts for simplified development
* Enhanced unit testing with performance optimizations

### 📊 **Enterprise Features**
* Advanced analytics and reporting capabilities
* Comprehensive audit logging and compliance features
* Enhanced user management and role-based access
* Mobile frontend integration (partnership with Servent)
* Cost tracking and performance monitoring



---


