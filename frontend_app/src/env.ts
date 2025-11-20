// Environment variables configuration for the frontend
export const env = {
  VITE_BASE_URL: import.meta.env.VITE_BASE_URL || "/",
  VITE_AUTH_METHOD: import.meta.env.VITE_AUTH_METHOD || "both",
  VITE_DEBUG: import.meta.env.VITE_DEBUG === "true" || import.meta.env.DEV === true,
  VITE_API_URL: import.meta.env.VITE_API_URL || "http://localhost:8000",
  // App branding
  VITE_APP_TITLE: import.meta.env.VITE_APP_TITLE || "Perth and Kinross Council",
  VITE_APP_SUBTITLE: import.meta.env.VITE_APP_SUBTITLE || "Sonic Brief",
  // Azure AD/Entra ID Configuration
  VITE_AZURE_CLIENT_ID: import.meta.env.VITE_AZURE_CLIENT_ID,
  VITE_AZURE_TENANT_ID: import.meta.env.VITE_AZURE_TENANT_ID,
  VITE_AZURE_BACKEND_SCOPE: import.meta.env.VITE_AZURE_BACKEND_SCOPE,
  VITE_AZURE_AUDIENCE: import.meta.env.VITE_AZURE_AUDIENCE,
} as const;

// Type-safe auth method check
export const authConfig = {
  isLegacyEnabled: () => env.VITE_AUTH_METHOD === "legacy" || env.VITE_AUTH_METHOD === "both",
  isEntraEnabled: () => env.VITE_AUTH_METHOD === "entra" || env.VITE_AUTH_METHOD === "both",
  isEntraOnly: () => env.VITE_AUTH_METHOD === "entra",
  isLegacyOnly: () => env.VITE_AUTH_METHOD === "legacy",
} as const;

// Azure configuration check
export const azureConfig = {
  isConfigured: () => !!(env.VITE_AZURE_CLIENT_ID && env.VITE_AZURE_TENANT_ID && env.VITE_AZURE_BACKEND_SCOPE),
  isMissingConfig: () => !env.VITE_AZURE_CLIENT_ID || !env.VITE_AZURE_TENANT_ID || !env.VITE_AZURE_BACKEND_SCOPE,
  getMissingVars: () => {
    const missing = [];
    if (!env.VITE_AZURE_CLIENT_ID) missing.push('VITE_AZURE_CLIENT_ID');
    if (!env.VITE_AZURE_TENANT_ID) missing.push('VITE_AZURE_TENANT_ID');
    if (!env.VITE_AZURE_BACKEND_SCOPE) missing.push('VITE_AZURE_BACKEND_SCOPE');
    return missing;
  },
} as const;

// Debug configuration
export const debugConfig = {
  isEnabled: () => env.VITE_DEBUG,
  showAuthDebug: () => env.VITE_DEBUG,
  showPerformanceMetrics: () => env.VITE_DEBUG,
  showErrorDetails: () => env.VITE_DEBUG,
} as const;