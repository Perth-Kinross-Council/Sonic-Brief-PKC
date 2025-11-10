# Release Checklist (SRS)

## Pre-Deployment
* [ ] Terraform plan clean (no unintended drift)
* [ ] OpenAI & Speech quota verified
* [ ] Entra app IDs & scope unchanged (or documented)
* [ ] AUTH_METHOD set to `entra`
* [ ] Retention flags correct (dry-run only in non-prod)

## Deployment
* [ ] Backend deployed (version tag noted)
* [ ] Functions deployed (zip hash recorded)
* [ ] Frontend built & SWA deployed

## Post-Deployment Verification
* [ ] Login works (token audience + scope)
* [ ] Audio upload → transcription → summary success
* [ ] Logs visible (App Service + Functions) in Log Analytics
* [ ] Retention job executed (expected log entries)
* [ ] No unexpected 5xx or throttling alerts

## Rollback Plan
* Last known good artifact references documented
* Terraform state snapshot (if infra changes) stored securely

## Sign-Off
| Role | Name | Date | Notes |
|------|------|------|-------|
| Dev Lead |  |  |  |
| Ops Lead |  |  |  |
| Security |  |  |  |
