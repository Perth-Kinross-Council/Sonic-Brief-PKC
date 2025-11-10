# SRS Feature Deltas

A catalog of capabilities present in the current SRS codebase that go beyond the base (reference) Sonic Brief implementation (`SonicBrief-EID`). Use this to:
* Understand upgrade impact when rebasing from upstream/base.
* Communicate value-add to stakeholders.
* Guide regression & acceptance testing in new environments.

## 1. Authentication & Authorization
| Area | Base | SRS Enhancement | Rationale / Impact |
|------|------|-----------------|--------------------|
| Auth Modes | (Legacy JWT focus) | Dual-mode (Entra + legacy) with security controls | Smooth migration to Entra ID |
| Entra Integration | Absent / minimal | Full MSAL frontend + backend audience validation | Modern identity & conditional access compatibility |
| Scope Handling | Implicit / unused | Explicit `user_impersonation` scope surfaced in config variables | Scope management capabilities |
| Diagnostics | Minimal | Auth diagnostics components (UnifiedAuthMonitor, Debug Panel) | Faster auth issue triage |

## 2. Retention & Data Lifecycle
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| Job Retention | Hard-coded / manual | Configurable `job_retention_days`, `failed_job_retention_days` | Operational flexibility |
| Blob Receipt Cleanup | Not implemented | Automated receipt cleanup with batch + dry‑run | Storage hygiene, cost control |
| Dry-Run Mode | Not available | `retention_dry_run` flag (now default false in prod) | Safe evaluation before deletion |
| Batch Processing | N/A | Tunable `retention_batch_size` | Performance tuning |

## 3. Infrastructure & Configuration Management
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| Terraform Variables | Core minimal set | Expanded matrix (auth, retention, costing, alerts, logging, CORS) | Reduced portal drift |
| Sample Variables | Absent | `variables.tf.sample` with mock GUIDs + `backend.tf.sample` for remote state | Faster environment bootstrap |
| Configuration Reference | Ad hoc | Centralized `CONFIGURATION.md` with canonical env var mapping | Single source of truth |
| Environment-driven CORS | Hard-coded | `ALLOW_ORIGINS` variable with fallback to localhost | Secure production deployments |
| Logging Control | Fixed | `BACKEND_LOG_LEVEL` and `FUNCTIONS_LOG_LEVEL` variables | Operational flexibility |
| Debug Endpoints | Always exposed | Gated behind `ENABLE_DEBUG_ENDPOINTS` flag (default false) | Production security |

## 4. Observability & Diagnostics
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| Structured Logging | Basic | Shared `structured_logging` usage + audit/usage containers with level control | Traceability |
| Diagnostics UI | Not present | DiagnosticPanel & Enhanced Debug tooling (gated by env flag) | Speeds root cause analysis |
| Error Message Sanitization | Raw error exposure | Sanitized `userMessage` fields with token redaction | Security & UX |
| Debug Gating | Always on | Environment-controlled debug endpoint exposure | Production security |

## 5. Frontend UX / Functional Enhancements
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| Category Collapse | Buggy | Fixed collapse toggle logic | Usability |
| Audit Log Modal | Absent | Added on-demand view modal | Faster review of processing events |
| Audio MIME Support | Narrow | Expanded AAC/container MIME variants | Broader device compatibility |
| Unified Auth Manager | Minimal | Token orchestration (MSAL + legacy fallback + caching) | Smoother transition period |

## 6. Reporting & Analytics
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| Usage Analytics | Limited | Extended containers (usage, metrics) | Cost & performance insights |
| Cost Modeling Vars | Absent | `model_input_cost_per_million`, etc. | Cost attribution capabilities |

## 7. Operational Enhancements
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| Alert Variables | Minimal | Added alert thresholds & toggles | Proactive incident detection |
| Release Process | Informal | Formal `Release-Checklist.md` | Consistent promotion |
| Deployment Utilities | Manual | `create-deployment-test-snapshot.ps1` for history-free repo cloning | Faster test environments |
| CORS Configuration | Hard-coded | Environment-driven CORS with secure defaults | Production security |
| Swagger OAuth | Always enabled | Gated behind `ENABLE_SWAGGER_OAUTH` flag | Security hardening |

## 8. Frontend Development & Tooling
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| ESLint Configuration | Basic/outdated | ESLint v9 with flat config, comprehensive rules | Modern code quality standards |
| Code Formatting | Manual/inconsistent | Prettier with EditorConfig integration | Consistent code style across team |
| Root Scripts | Manual navigation | Proxy scripts from root to frontend_app | Simplified development workflow |
| CI/CD Pipeline | Basic verification | Enhanced verification with non-mutating checks | Reliable automated quality gates |
| API Client Architecture | Hard-coded URLs | Centralized API configuration with `apiUrl.ts`, `apiConstants.ts` | Maintainable API integration |
| Error Handling | Basic | Structured error handling with `fetchJsonStrict` | Better error diagnostics and UX |
| Development Scripts | Basic | `verify` (local) and `verify:ci` (CI) workflows | Comprehensive pre-commit validation |
| Test Organization | Limited | Enhanced unit tests with performance optimizations | Better code coverage and reliability |

## 9. Enhanced Authentication & Token Management
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| Token Caching | Basic | Advanced token caching with configurable cache size | Improved performance and reduced API calls |
| Background Refresh | Manual | Automated background token refresh with configurable intervals | Seamless user experience |
| Performance Monitoring | None | Built-in performance logging and metrics collection | Operational insights and optimization |
| Retry Logic | Basic | Configurable retry attempts with exponential backoff | Improved reliability under network issues |
| Legacy Fallback | Hard-coded | Configurable legacy token support for migration | Smooth transition during auth modernization |
| Environment Adaptation | Static | Dynamic configuration based on deployment environment | Optimized behavior per environment |

## 10. Documentation Improvements
| Area | Base | SRS Enhancement | Benefit |
|------|------|-----------------|---------|
| Redeployment Guidance | Sparse | Comprehensive `SRS-Redeployment-Guide.md` | Faster stand-ups |
| Config Comparison | Not available | `Configuration-Matrix.md` | Drift detection |
| Feature Deltas | Not tracked | This document | Transparency |
| Configuration Reference | Scattered | Centralized `CONFIGURATION.md` with canonical mapping | Single source of truth |
| Development Workflow | Basic README | Detailed development setup and tooling guide | Improved developer onboarding |
| Sample Configurations | Missing | `backend.tf.sample` with remote state guidance | Terraform best practices |

## 10. Implementation Status (Current Release)

| Enhancement | Description | Status |
|-------------|-------------|--------|
| Environment-driven CORS | `ALLOW_ORIGINS` variable with localhost fallback | ✅ Complete |
| Centralized logging control | `BACKEND_LOG_LEVEL` and `FUNCTIONS_LOG_LEVEL` variables | ✅ Complete |
| Debug endpoint gating | `ENABLE_DEBUG_ENDPOINTS` flag (default false) | ✅ Complete |
| Token redaction | Sanitize sensitive data in error messages | ✅ Complete |
| Configuration documentation | Canonical `CONFIGURATION.md` reference | ✅ Complete |
| Terraform samples | `backend.tf.sample` with remote state guidance | ✅ Complete |
| Error message sanitization | User-friendly error messages with security | ✅ Complete |
| Deployment utilities | PowerShell script for clean repo snapshots | ✅ Complete |
| Enhanced authentication | Advanced token management and performance monitoring | ✅ Complete |
| API client architecture | Centralized URL management and error handling | ✅ Complete |
| Frontend modernization | ESLint v9, Prettier, enhanced CI/CD workflows | ✅ Complete |

## 11. Upgrade Considerations
When rebasing from base:
* Preserve added Terraform variables (merge strategy: additive, avoid overwriting defaults).
* Ensure frontend auth handling does not regress to legacy‑only assumptions.
* Re-run parity audit (auth, retention, scopes) post-merge.
* Maintain environment variable configuration patterns (CORS, logging, debug flags).
* Preserve security hardening (debug endpoint gating, token redaction).

---

**Last Updated:** 2025-11-05 - Documented implemented features and current release status.
