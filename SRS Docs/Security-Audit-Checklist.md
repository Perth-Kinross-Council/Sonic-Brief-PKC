# Security Audit Checklist (SRS)

## Production Security Verification

### Authentication & Authorization
- [ ] `AUTH_METHOD` is set to `entra` (not `both` or `legacy`)
- [ ] Entra ID app registrations use single-tenant configuration
- [ ] Backend API scope `user_impersonation` is properly configured
- [ ] Frontend redirects only include production and localhost URLs
- [ ] No JWT secrets visible in logs or configuration UI

### Debug & Development Features
- [ ] `ENABLE_DEBUG_ENDPOINTS` is set to `false` in production
- [ ] `ENABLE_SWAGGER_OAUTH` is set to `false` in production
- [ ] Debug endpoints return 404 when disabled (not 403 or error messages)
- [ ] No verbose logging in production (`BACKEND_LOG_LEVEL` != `DEBUG`)
- [ ] No verbose logging in functions (`FUNCTIONS_LOG_LEVEL` != `DEBUG`)

### CORS & Network Security
- [ ] `ALLOW_ORIGINS` contains only authorized domains (no wildcards)
- [ ] Static Web App URL is included in CORS origins
- [ ] No `http://` origins in production CORS settings
- [ ] HTTPS redirects are properly configured

### Data Protection
- [ ] Error messages are sanitized (no token exposure)
- [ ] Audit logs contain no sensitive user data
- [ ] Retention policies are appropriate for data classification
- [ ] Blob storage has proper access controls

### Environment Configuration
- [ ] All secrets are in App Settings (not committed code)
- [ ] Key Vault migration plan exists for API keys (PLANNED - currently using App Settings)
- [ ] Environment variables follow principle of least privilege
- [ ] No hardcoded production values in Terraform code
- [ ] `SERVICE_PRINCIPAL_UPLOAD_ROLE` is properly configured for ingestion endpoints

### Monitoring & Observability
- [ ] Structured logging is properly configured
- [ ] No PII in application logs
- [ ] Security events are logged appropriately
- [ ] Log Analytics workspace has proper retention

## Quarterly Security Review Items
- [ ] Review and rotate JWT secrets (if still in use)
- [ ] Audit managed identity role assignments
- [ ] Review CORS origins for changes
- [ ] Validate debug endpoints remain disabled
- [ ] Check for new environment variables requiring security review
- [ ] Verify `FUNCTIONS_LOG_LEVEL` settings across environments
- [ ] Review service principal upload role configuration

## Incident Response Readiness
- [ ] Debug endpoints can be quickly disabled
- [ ] Logging levels can be adjusted without deployment
- [ ] Token revocation procedures are documented
- [ ] Rollback procedures are tested and documented

---
**Last Updated:** November 10, 2025 - Updated to reflect current deployment status and added FUNCTIONS_LOG_LEVEL and SERVICE_PRINCIPAL_UPLOAD_ROLE checks
