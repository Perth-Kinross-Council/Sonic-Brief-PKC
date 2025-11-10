# Environment Comparison Guide (SRS)

## Purpose
Quick reference for comparing configuration across development, staging, and production environments to identify drift and ensure consistency.

## Configuration Comparison Matrix

### Authentication Configuration
| Setting | Development | Staging | Production | Notes |
|---------|-------------|---------|------------|-------|
| AUTH_METHOD | `both` (testing) | `entra` | `entra` | Legacy should be disabled in higher envs |
| ENABLE_DEBUG_ENDPOINTS | `true` | `false` | `false` | Debug only in dev |
| ENABLE_SWAGGER_OAUTH | `true` | `false` | `false` | OAuth testing in dev only |

### Logging & Monitoring
| Setting | Development | Staging | Production | Notes |
|---------|-------------|---------|------------|-------|
| BACKEND_LOG_LEVEL | `DEBUG` | `INFO` | `WARNING` | Verbose dev, minimal prod |
| FUNCTIONS_LOG_LEVEL | `DEBUG` | `INFO` | `INFO` | Function debugging in dev |

### CORS & Network
| Setting | Development | Staging | Production | Notes |
|---------|-------------|---------|------------|-------|
| ALLOW_ORIGINS | `localhost:*` | `staging.domain.com` | `prod.domain.com` | Environment-specific |

### Data & Retention
| Setting | Development | Staging | Production | Notes |
|---------|-------------|---------|------------|-------|
| job_retention_days | `7` | `15` | `30` | Shorter retention in dev |
| retention_dry_run | `true` | `true` | `false` | Safe deletion in prod only |

### Resource Sizing
| Component | Development | Staging | Production | Notes |
|-----------|-------------|---------|------------|-------|
| App Service Plan | B1 (Basic) | S1 (Standard) | P1V2 (Premium) | Scale with environment |
| Cosmos RU/s | 400 | 1000 | Auto-scale | Cost vs performance |
| Function Plan | Consumption | Premium | Premium | Cold start considerations |

## Environment-Specific Checks

### Development Environment
- [ ] Debug endpoints accessible
- [ ] Verbose logging enabled
- [ ] Both auth methods available for testing
- [ ] Short retention periods
- [ ] Local development CORS enabled

### Staging Environment
- [ ] Production-like configuration
- [ ] Debug endpoints disabled
- [ ] Entra-only authentication
- [ ] Dry-run retention enabled for safety
- [ ] Staging domain in CORS

### Production Environment
- [ ] Security hardening complete
- [ ] All debug features disabled
- [ ] Optimal logging levels
- [ ] Real retention policies active
- [ ] Only production domains in CORS

## Configuration Drift Detection

### Monthly Checks

1. Compare App Service application settings across environments
2. Verify Terraform variables match deployed configuration
3. Check for manual changes not reflected in IaC
4. Validate security settings remain consistent

## Common Drift Scenarios
| Drift Type | Symptom | Resolution |
|------------|---------|------------|
| Debug enabled in prod | Security concern | Immediately disable via App Settings |
| Wrong log level | Performance/noise | Adjust via Terraform or App Settings |
| CORS mismatch | Frontend auth failures | Update origins and restart service |
| Auth method regression | Legacy tokens accepted | Verify AUTH_METHOD setting |

---

