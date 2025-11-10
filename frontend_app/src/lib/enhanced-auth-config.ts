
/**
 * Enhanced Authentication Configuration for Phase 3 Frontend Optimization
 * Provides centralized configuration for the enhanced auth system
 */

export interface EnhancedAuthConfig {
  // Token management
  scopes: string[];
  preemptiveRefreshBuffer: number; // minutes before expiry to refresh
  backgroundRefreshInterval: number; // milliseconds
  maxCacheSize: number;
  // Performance monitoring
  enablePerformanceLogging: boolean;
  metricsUpdateInterval: number; // milliseconds
  // Error handling
  maxRetryAttempts: number;
  retryDelayMs: number;
  // Legacy support
  enableLegacyFallback: boolean;
  legacyTokenKey: string;
}

/**
 * Default configuration optimized for Azure Container Apps deployment
 */
export const defaultEnhancedAuthConfig: EnhancedAuthConfig = {
  // Token management
  scopes: ['User.Read'], // Will be overridden by environment config
  preemptiveRefreshBuffer: 15, // 15 minutes before expiry
  backgroundRefreshInterval: 120000, // 2 minutes
  maxCacheSize: 50,
  // Performance monitoring
  enablePerformanceLogging: true,
  metricsUpdateInterval: 5000, // 5 seconds
  // Error handling
  maxRetryAttempts: 3,
  retryDelayMs: 1000,
  // Legacy support
  enableLegacyFallback: true,
  legacyTokenKey: 'token'
};

/**
 * Environment-specific configuration
 */
export const getEnvironmentConfig = (): Partial<EnhancedAuthConfig> => {
  // Check if we're in development vs production
  const isDevelopment = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isDevelopment) {
    return {
      enablePerformanceLogging: true,
      metricsUpdateInterval: 2000, // More frequent updates in dev
      backgroundRefreshInterval: 60000, // More frequent refresh in dev
      preemptiveRefreshBuffer: 10 // Earlier refresh in dev
    };
  }
  return {
    enablePerformanceLogging: false, // Disable in production for performance
    metricsUpdateInterval: 10000, // Less frequent updates in production
    backgroundRefreshInterval: 120000, // Standard refresh interval
    preemptiveRefreshBuffer: 15 // Standard buffer
  };
};

/**
 * Get combined configuration with environment overrides
 */
export const getEnhancedAuthConfig = (overrides?: Partial<EnhancedAuthConfig>): EnhancedAuthConfig => {
  const envConfig = getEnvironmentConfig();
  return {
    ...defaultEnhancedAuthConfig,
    ...envConfig,
    ...overrides
  };
};

/**
 * Performance thresholds for monitoring alerts
 */
export const performanceThresholds = {
  // Cache performance
  minimumHitRate: 80, // Minimum acceptable cache hit rate percentage
  maximumCacheSize: 100, // Maximum cache size before warnings
  // Token refresh performance
  maximumRefreshTime: 500, // Maximum acceptable refresh time in ms
  maximumErrorRate: 5, // Maximum acceptable error count
  // Background refresh
  backgroundRefreshThreshold: 10, // Maximum background refreshes per minute
  preemptiveRefreshThreshold: 5 // Maximum preemptive refreshes per minute
};

/**
 * Monitoring configuration for different deployment scenarios
 */
export const monitoringConfig = {
  development: {
    enableDetailedLogging: true,
    enablePerformanceWarnings: true,
    enableMetricsDashboard: true,
    metricsRetentionMinutes: 30
  },
  staging: {
    enableDetailedLogging: true,
    enablePerformanceWarnings: true,
    enableMetricsDashboard: true,
    metricsRetentionMinutes: 60
  },
  production: {
    enableDetailedLogging: false,
    enablePerformanceWarnings: true,
    enableMetricsDashboard: false, // Disable in prod for performance
    metricsRetentionMinutes: 120
  }
};

/**
 * Get monitoring configuration based on environment
 */
export const getMonitoringConfig = () => {
  if (typeof window === 'undefined') return monitoringConfig.production;
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return monitoringConfig.development;
  }
  if (hostname.includes('staging') || hostname.includes('test')) {
    return monitoringConfig.staging;
  }
  return monitoringConfig.production;
};

/**
 * MSAL configuration with enhanced features
 */
export const getEnhancedMsalConfig = () => {
  // This would typically come from environment variables
  const clientId = typeof window !== 'undefined' ?
    (window as any).__ENV__?.VITE_AZURE_CLIENT_ID || 'your-client-id' : 'your-client-id';
  const tenantId = typeof window !== 'undefined' ?
    (window as any).__ENV__?.VITE_AZURE_TENANT_ID || 'your-tenant-id' : 'your-tenant-id';
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
      postLogoutRedirectUri: typeof window !== 'undefined' ? window.location.origin : ''
    },
    cache: {
      cacheLocation: 'localStorage' as const,
      storeAuthStateInCookie: false,
      secureCookies: true
    },
    system: {
      loggerOptions: {
    loggerCallback: (_level: any, _message: string) => {
          const config = getMonitoringConfig();
          if (config.enableDetailedLogging) {
      // Intentionally suppressed to avoid leaking auth data
          }
        },
        piiLoggingEnabled: false,
        logLevel: 1 // Info level
      },
      allowNativeBroker: false // Disable for web apps
    }
  };
};

/**
 * Login request configuration with enhanced scopes
 */
export const getEnhancedLoginRequest = () => {
  const backendScope = typeof window !== 'undefined' ?
    (window as any).__ENV__?.VITE_AZURE_BACKEND_SCOPE || '' : '';
  return {
    scopes: [backendScope, 'User.Read'].filter(Boolean),
    extraScopesToConsent: ['offline_access'], // For refresh tokens
    prompt: 'select_account' as const,
    loginHint: '', // Can be populated from user preferences
  };
};

/**
 * Configuration validation
 */
export const validateEnhancedAuthConfig = (config: EnhancedAuthConfig): string[] => {
  const errors: string[] = [];
  if (!config.scopes || config.scopes.length === 0) {
    errors.push('At least one scope must be configured');
  }
  if (config.preemptiveRefreshBuffer < 1) {
    errors.push('Preemptive refresh buffer must be at least 1 minute');
  }
  if (config.backgroundRefreshInterval < 30000) {
    errors.push('Background refresh interval must be at least 30 seconds');
  }
  if (config.maxCacheSize < 1) {
    errors.push('Max cache size must be at least 1');
  }
  if (config.maxRetryAttempts < 1) {
    errors.push('Max retry attempts must be at least 1');
  }
  return errors;
};

/**
 * Export commonly used configurations
 */
export default {
  defaultEnhancedAuthConfig,
  getEnhancedAuthConfig,
  getEnvironmentConfig,
  performanceThresholds,
  getMonitoringConfig,
  getEnhancedMsalConfig,
  getEnhancedLoginRequest,
  validateEnhancedAuthConfig
};
