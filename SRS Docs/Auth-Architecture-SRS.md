# Authentication Architecture (SRS)

## Overview
SRS standardizes on Entra ID (Azure AD) for all interactive and API access. Legacy JWT flows remain only until decommission flag is implemented. The system includes enhanced token management with performance monitoring and advanced caching capabilities.

## Components
* Backend API App Registration (exposes scope)
* Frontend SPA App Registration (requests scope via MSAL)
* System Assigned Managed Identities (backend + functions) for data services
* Enhanced token caching and performance monitoring

## Token Flow

1. Frontend acquires access token for scope `api://<backend-id>/user_impersonation`.
2. Backend validates signature, issuer, and audience.
3. Functions rely on storage / cosmos via MSI (no user tokens).
4. Advanced token management with background refresh and performance tracking.

## Enhanced Authentication Features

### Token Management
* **Background Refresh**: Configurable automatic token renewal with 15-minute buffer
* **Performance Monitoring**: Built-in metrics collection for auth operations
* **Advanced Caching**: Configurable cache with up to 50 token entries
* **Retry Logic**: Exponential backoff with configurable retry attempts
* **Legacy Fallback**: Seamless transition support during migration

### Configuration Options
```typescript
interface EnhancedAuthConfig {
  preemptiveRefreshBuffer: number; // 15 minutes default
  backgroundRefreshInterval: number; // 2 minutes default
  maxCacheSize: number; // 50 entries default
  enablePerformanceLogging: boolean; // true default
  maxRetryAttempts: number; // 3 default
  enableLegacyFallback: boolean; // true during migration
}
```

### Environment Adaptation
* **Development**: Enhanced logging, longer cache periods
* **Production**: Optimized performance, minimal logging
* **Staging**: Balanced configuration for testing

## Security Enhancements

### Debug Endpoint Protection
* **ENABLE_DEBUG_ENDPOINTS**: Gates diagnostic endpoints in production
* **Default**: `false` for security-first approach
* **Impact**: Returns 404 for debug routes when disabled

### Swagger OAuth Control
* **ENABLE_SWAGGER_OAUTH**: Controls OAuth integration in Swagger UI
* **Default**: `false` to prevent unintended token exposure
* **Use Case**: Enable only in secure development environments

### Token Sanitization

* **Error Message Redaction**: Prevents token leakage in error responses
* **Structured Logging**: Sanitized audit trail for compliance
* **Performance Impact**: Minimal overhead for security benefit

## Implementation Status

### Completed Features

* ✅ **Enhanced Token Management**: Background refresh with 15-minute buffer
* ✅ **Performance Monitoring**: Built-in metrics collection for auth operations
* ✅ **Advanced Caching**: Configurable cache with up to 50 token entries
* ✅ **Retry Logic**: Exponential backoff with configurable retry attempts
* ✅ **Environment Adaptation**: Optimized configuration per deployment environment
* ✅ **Debug Endpoint Security**: Production-safe debug controls
* ✅ **Swagger OAuth Security**: Secure OAuth integration gating
* ✅ **Dual Authentication Support**: Entra ID and legacy JWT with graceful fallback

### Current Capabilities

* Both Entra ID and legacy JWT authentication methods supported
* Graceful fallback for existing token integrations
* Comprehensive performance monitoring for both auth methods
* Enhanced error handling and user messaging
* Detailed audit logging for compliance requirements

---


