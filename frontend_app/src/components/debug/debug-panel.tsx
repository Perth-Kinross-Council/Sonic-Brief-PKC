import { authConfig, env, debugConfig, azureConfig } from "@/env";
import { debugLog, debugError, debug } from "@/lib/debug";
import { useUnifiedAuthParity } from "@/lib/useUnifiedAuthParity";
import { useReadOnlyTokenInfo } from "@/lib/read-only-token-info";
import { redactTokenPreview, shortHash } from '@/lib/tokenRedaction';
import { useSimpleTokenInfo } from "@/lib/simple-token-info";
import { useReadOnlyAuthMetrics } from "@/lib/read-only-auth-metrics";
import { clearLegacyAuth, clearMsalAuth, clearAllAuth, debugAuthStorage } from "@/lib/auth-debug";
import { findTokensEverywhere, debugAllTokens } from "@/lib/aggressive-token-finder";
import { useState, useEffect } from "react";

interface DebugPanelProps {
  title?: string;
  location?: string;
  showAuthInfo?: boolean;
  showPerformanceInfo?: boolean;
  additionalInfo?: Record<string, any>;
}

export function DebugPanel({
  title = "Debug Info",
  location = "Unknown",
  showAuthInfo = true,
  showPerformanceInfo = false,
  additionalInfo = {}
}: DebugPanelProps) {
  // Only render if debug is enabled
  if (!debugConfig.isEnabled()) {
    return null;
  }

  // READ-ONLY metrics that never trigger auth flows
  const metrics = useReadOnlyAuthMetrics() || {};

  return (
    <div className="bg-blue-50 border border-blue-300 rounded-md p-3 mb-4 text-xs">
      <div className="text-blue-800 font-semibold text-sm mb-2">
        🐛 {title} ({location})
      </div>

      <div className="text-blue-700 space-y-1">
        {/* Environment Info */}
        <div className="border-b border-blue-200 pb-1 mb-1">
          <strong>Environment:</strong>
        </div>
        <div><strong>VITE_DEBUG:</strong> {env.VITE_DEBUG ? '🟢 TRUE' : '🔴 FALSE'}</div>
        <div><strong>DEV Mode:</strong> {import.meta.env.DEV ? '🟢 TRUE' : '🔴 FALSE'}</div>
        <div><strong>Location:</strong> {location}</div>

        {/* Auth Info */}
        {showAuthInfo && (
          <>
            <div className="border-b border-blue-200 pb-1 mb-1 mt-2">
              <strong>Authentication:</strong>
            </div>
            <div><strong>VITE_AUTH_METHOD:</strong> "{env.VITE_AUTH_METHOD}"</div>
            <div><strong>Raw env:</strong> "{import.meta.env.VITE_AUTH_METHOD}"</div>
            <div><strong>Legacy:</strong> {authConfig.isLegacyEnabled() ? '✅ ON' : '❌ OFF'}</div>
            <div><strong>Entra:</strong> {authConfig.isEntraEnabled() ? '✅ ON' : '❌ OFF'}</div>
            <div><strong>Mode:</strong> {
              authConfig.isLegacyOnly() ? 'Legacy Only' :
              authConfig.isEntraOnly() ? 'Entra Only' : 'Both'
            }</div>

            {/* Azure Configuration Info */}
            <div className="border-b border-blue-200 pb-1 mb-1 mt-2">
              <strong>Azure Configuration:</strong>
            </div>
            <div><strong>MSAL Configured:</strong> {azureConfig.isConfigured() ? '🟢 YES' : '🔴 NO'}</div>
            {azureConfig.isMissingConfig() && (
              <div className="text-red-600"><strong>Missing:</strong> {azureConfig.getMissingVars().join(', ')}</div>
            )}
            <div><strong>Client ID:</strong> {env.VITE_AZURE_CLIENT_ID ? `${env.VITE_AZURE_CLIENT_ID.substring(0, 8)}...` : '❌ Not Set'}</div>
            <div><strong>Tenant ID:</strong> {env.VITE_AZURE_TENANT_ID ? `${env.VITE_AZURE_TENANT_ID.substring(0, 8)}...` : '❌ Not Set'}</div>
            <div><strong>Backend Scope:</strong> {env.VITE_AZURE_BACKEND_SCOPE ? '✅ Set' : '❌ Not Set'}</div>
          </>
        )}

        {/* Performance Info */}
        {showPerformanceInfo && Object.keys(metrics).length > 0 && (
          <>
            <div className="border-b border-blue-200 pb-1 mb-1 mt-2">
              <strong>Performance:</strong>
            </div>
            <div><strong>Cache Hits:</strong> {(metrics as any).cacheHits || 0}</div>
            <div><strong>Cache Misses:</strong> {(metrics as any).cacheMisses || 0}</div>
            <div><strong>Hit Rate:</strong> {(metrics as any).hitRate || 0}%</div>
            <div><strong>Token Refreshes:</strong> {(metrics as any).tokenRefreshCount || 0}</div>
          </>
        )}

        {/* Additional Info */}
        {Object.keys(additionalInfo).length > 0 && (
          <>
            <div className="border-b border-blue-200 pb-1 mb-1 mt-2">
              <strong>Additional:</strong>
            </div>
            {Object.entries(additionalInfo).map(([key, value]) => (
              <div key={key}>
                <strong>{key}:</strong> {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </div>
            ))}
          </>
        )}

        {/* Timestamp */}
        <div className="border-t border-blue-200 pt-1 mt-2 text-xs text-blue-600">
          <strong>Generated:</strong> {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

/**
 * CRITICAL EXPORT: AuthDebugPanel component used by login.tsx
 * This is a READ-ONLY debug panel that NEVER triggers auth flows
 */
export function AuthDebugPanel() {
  // Minimal, safe login debug panel. No token reads, no performance, no sensitive values.
  if (!debugConfig.isEnabled()) return null;

  const authMode = authConfig.isLegacyOnly()
    ? "Legacy Only"
    : authConfig.isEntraOnly()
    ? "Entra Only"
    : authConfig.isLegacyEnabled() && authConfig.isEntraEnabled()
    ? "Both"
    : "Unknown";

  const azureConfigured = azureConfig.isConfigured();
  const missing = azureConfig.isMissingConfig() ? azureConfig.getMissingVars() : [];

  return (
    <div className="bg-blue-50 border border-blue-300 rounded-md p-3 mb-4 text-xs">
      <div className="text-blue-800 font-semibold text-sm mb-2">🐛 Login Debug (read-only)</div>
      <div className="text-blue-700 space-y-1">
        <div><strong>VITE_DEBUG:</strong> {env.VITE_DEBUG ? "🟢 TRUE" : "🔴 FALSE"}</div>
        <div><strong>Auth Method:</strong> {String(env.VITE_AUTH_METHOD || "not set")}</div>
        <div>
          <strong>Auth Mode:</strong> {authMode} ({authConfig.isLegacyEnabled() ? "Legacy ✅" : "Legacy ❌"} | {authConfig.isEntraEnabled() ? "Entra ✅" : "Entra ❌"})
        </div>
        <div className="border-b border-blue-200 pb-1 mb-1 mt-2"><strong>Azure Config</strong></div>
        <div><strong>Configured:</strong> {azureConfigured ? "🟢 YES" : "🔴 NO"}</div>
        {!azureConfigured && missing.length > 0 && (
          <div className="text-red-700"><strong>Missing:</strong> {missing.join(", ")}</div>
        )}
        <div><strong>Backend Scope Set:</strong> {env.VITE_AZURE_BACKEND_SCOPE ? "✅" : "❌"}</div>
        <div className="border-t border-blue-200 pt-1 mt-2 text-xs text-blue-600">
          <strong>Generated:</strong> {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

interface UnifiedDebugDashboardProps {
  location?: string;
  refreshInterval?: number;
}

export function UnifiedDebugDashboard({
  location = "Application",
  refreshInterval = 5000
}: UnifiedDebugDashboardProps) {
  // Only render if debug is enabled
  if (!debugConfig.isEnabled()) {
    return null;
  }

  // ARCHITECTURAL FIX: Use the ACTUAL auth state from the main auth hook
  const {
    isAuthenticated: authenticated,
    isLoading: pending,
    authMethod
  } = useUnifiedAuthParity();

  // Also get read-only info as fallback/comparison
  const readOnlyTokenInfo = useReadOnlyTokenInfo(); // Pure read operation - no side effects
  const simpleTokenInfo = useSimpleTokenInfo(); // Alternative simpler approach
  const readOnlyMetrics = useReadOnlyAuthMetrics(refreshInterval); // Pure read operation

  // Extract token from read-only info for backward compatibility
  const baseToken = readOnlyTokenInfo?.token || simpleTokenInfo?.token || null;

  // Fallback: if no token is detected by normal methods, try aggressive search
  const [fallbackToken, setFallbackToken] = useState<string | null>(null);
  const [fallbackSource, setFallbackSource] = useState<string>('');

  useEffect(() => {
  if (!baseToken) {
      // Only run aggressive search if no token is found by normal methods
      const result = findTokensEverywhere();
      if (result.token) {
        setFallbackToken(result.token);
        setFallbackSource(result.source);
      }
    }
  }, [baseToken]);

  // Use the best available token
  const displayToken = baseToken || fallbackToken;

  // Real-time token scanning - runs every 3 seconds
  // Track tokens found during scans
  const [, setRealtimeTokens] = useState<{[key: string]: string}>({});

  useEffect(() => {
    const scanForTokens = () => {
      const tokens: {[key: string]: string} = {};

      // PRIORITY: Check sessionStorage first (where tokens are stored!)
      const tokenKeys = [
        'token', 'access_token', 'accessToken', 'auth_token', 'authToken',
        'jwt', 'JWT', 'bearer_token', 'bearerToken'
      ];

      // HIGHEST PRIORITY: Look for the specific MSAL access token pattern
      const msalAccessTokenPattern = /.*accesstoken.*api:\/\/71bea96c-7f27-4eae-9310-14aeb4ebd598.*--$/;
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && msalAccessTokenPattern.test(key)) {
          const value = sessionStorage.getItem(key ?? "");
          if (value && typeof value === 'string' && value.includes('.') && value.split('.').length === 3) {
            tokens[`sessionStorage.${key}`] = value;
            debugLog('🎯 FOUND MSAL ACCESS TOKEN:', key);
          }
        }
      }

      // Check sessionStorage for common token keys
      tokenKeys.forEach(key => {
        const value = sessionStorage.getItem(key);
        if (value && typeof value === 'string' && value.includes('.') && value.split('.').length === 3) {
          tokens[`sessionStorage.${key}`] = value;
        }
      });

      // Check all sessionStorage keys
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          const value = sessionStorage.getItem(key);
          if (value && typeof value === 'string') {
            // Direct token check
            if (value.includes('.') && value.split('.').length === 3) {
              tokens[`sessionStorage.${key}`] = value;
            }
            // JSON nested token check
            try {
              const parsed = JSON.parse(value);
              if (parsed && typeof parsed === 'object') {
                Object.keys(parsed).forEach(subKey => {
                  const subValue = parsed[subKey];
                  if (typeof subValue === 'string' && subValue.includes('.') && subValue.split('.').length === 3) {
                    tokens[`sessionStorage.${key}.${subKey}`] = subValue;
                  }
                });
              }
            } catch {}
          }
        }
      }

      // Also check localStorage (secondary)
      tokenKeys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value && typeof value === 'string' && value.includes('.') && value.split('.').length === 3) {
          tokens[`localStorage.${key}`] = value;
        }
      });

      // Check MSAL-specific keys
      Object.keys(localStorage).forEach(key => {
        if (key.includes('msal') || key.includes('41d9bfd4-9418-4abd-88eb-2a5b1e6330bf')) {
          try {
            const value = localStorage.getItem(key);
            if (value) {
              // Try to parse and find nested tokens
              const parsed = JSON.parse(value);
              if (parsed && typeof parsed === 'object') {
                if (parsed.access_token && typeof parsed.access_token === 'string' && parsed.access_token.includes('.')) {
                  tokens[`${key}.access_token`] = parsed.access_token;
                }
                if (parsed.idToken && typeof parsed.idToken === 'string' && parsed.idToken.includes('.')) {
                  tokens[`${key}.idToken`] = parsed.idToken;
                }
              }
            }
          } catch {}
        }
      });

      setRealtimeTokens(tokens);

      // Call aggressive token finder for comprehensive scan
      const aggressiveResults = findTokensEverywhere();
      setScanResults(aggressiveResults);

      // Debug log if tokens found
      if (Object.keys(tokens).length > 0) {
        debugLog('🔄 Real-time scan found tokens:', Object.keys(tokens));
      }
    };

    // Initial scan
    scanForTokens();

    // Set up interval
    const interval = setInterval(scanForTokens, 3000);

    return () => clearInterval(interval);
  }, []);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [previousToken, setPreviousToken] = useState<string | null>(null);
  const [tokenChangeCount, setTokenChangeCount] = useState(0);
  const [lastTokenChange, setLastTokenChange] = useState<Date | null>(null);
  const [showRawToken, setShowRawToken] = useState(false);
  const [showDecodedPayload, setShowDecodedPayload] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'token' | 'performance' | 'logs'>('overview');
  const [manualToken, setManualToken] = useState<string>('');
  const [scanResults, setScanResults] = useState<any>(null);
  const [emergencyTokens, setEmergencyTokens] = useState<{[key: string]: string}>({});

  // Emergency token detection - runs immediately and frequently
  useEffect(() => {
    const emergencyTokenScan = () => {
      const emergency: {[key: string]: string} = {};

      // Brute force search everything
      try {
        // HIGHEST PRIORITY: Look for MSAL access tokens for our API
        const msalAccessTokenPattern = /.*accesstoken.*api:\/\/71bea96c-7f27-4eae-9310-14aeb4ebd598.*--$/;

        // Check sessionStorage for the specific MSAL access token pattern
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && msalAccessTokenPattern.test(key)) {
            const value = sessionStorage.getItem(key);
            if (value && typeof value === 'string' && value.includes('.') && value.split('.').length === 3) {
              emergency[`🎯PRIORITY: sessionStorage.${key}`] = value;
              debugLog('🎯 FOUND PRIORITY MSAL ACCESS TOKEN:', key);
            }
          }
        }
        // Check localStorage completely
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            const value = localStorage.getItem(key);
            if (value && typeof value === 'string') {
              // Check if it looks like a JWT token
              if (value.includes('.') && value.split('.').length === 3) {
                emergency[`localStorage.${key}`] = value;
              }
              // Check if it's JSON with a token inside
              try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === 'object') {
                  Object.keys(parsed).forEach(subKey => {
                    const subValue = parsed[subKey];
                    if (typeof subValue === 'string' && subValue.includes('.') && subValue.split('.').length === 3) {
                      emergency[`localStorage.${key}.${subKey}`] = subValue;
                    }
                  });
                }
              } catch {}
            }
          }
        }

        // Check sessionStorage (PRIORITY - tokens are stored here!)
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) {
            const value = sessionStorage.getItem(key);
            if (value && typeof value === 'string') {
              // Check if it looks like a JWT token directly
              if (value.includes('.') && value.split('.').length === 3) {
                emergency[`sessionStorage.${key}`] = value;
              }
              // Check if it's JSON with a token inside
              try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === 'object') {
                  Object.keys(parsed).forEach(subKey => {
                    const subValue = parsed[subKey];
                    if (typeof subValue === 'string' && subValue.includes('.') && subValue.split('.').length === 3) {
                      emergency[`sessionStorage.${key}.${subKey}`] = subValue;
                    }
                  });
                }
              } catch {}
            }
          }
        }

        // Check global window object for tokens
        if (typeof window !== 'undefined') {
          const globalKeys = ['token', 'accessToken', 'authToken', 'bearerToken'];
          globalKeys.forEach(key => {
            // @ts-ignore
            if (window[key] && typeof window[key] === 'string' && window[key].includes('.')) {
              // @ts-ignore
              emergency[`window.${key}`] = window[key];
            }
          });
        }

      } catch (error) {
        debugError('🚨 Emergency scan error:', error);
      }

      setEmergencyTokens(emergency);

      // Log findings
      if (Object.keys(emergency).length > 0) {
        debugLog('🚨 EMERGENCY TOKENS FOUND:', Object.keys(emergency));
      } else {
        debugLog('🚨 EMERGENCY SCAN: No tokens found anywhere');
      }
    };

    // Run immediately
    emergencyTokenScan();

    // Run every 2 seconds
    const interval = setInterval(emergencyTokenScan, 2000);

    return () => clearInterval(interval);
  }, []);

  // Get metrics from the actual auth manager if available
  const metrics = readOnlyMetrics;
  // Since we're using the parity hook, we'll rely on read-only metrics

  // Track actual token changes (not just re-renders)
  useEffect(() => {
    if (displayToken !== previousToken) {
      if (debugConfig.isEnabled()) {
        debugLog('[Debug Panel] Token actually changed! (READ-ONLY MODE)', {
          previous: previousToken ? `[redacted len=${previousToken.length}]` : 'null',
          new: displayToken ? `[redacted len=${displayToken.length}]` : 'null',
          changeCount: tokenChangeCount + 1,
          source: displayToken === baseToken ? 'normal' : fallbackSource
        });
      }
      setPreviousToken(displayToken);
      setTokenChangeCount(prev => prev + 1);
      setLastTokenChange(new Date());
    }
  }, [displayToken, previousToken, tokenChangeCount, fallbackSource]);

  // Update current time every second for countdown (for live TTL updates)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now()); // Update current time for live TTL calculation
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Get comprehensive token information with live TTL calculation
  const getDetailedTokenInfo = () => {
    if (!displayToken) {
      return {
        hasToken: false,
        rawToken: null,
        tokenParts: 0,
        header: null,
        payload: null,
        signature: null,
        expiry: null,
        ttlSeconds: null,
        timeToExpiry: 'No token',
        issuedAt: null,
        tokenType: 'No Token',
        issuer: null,
        audience: null,
        subject: null,
        uniqueId: null,
        scopes: null,
        debugInfo: 'No token available',
        isExpired: false,
        isExpiringSoon: false
      };
    }

    try {
      const parts = displayToken.split('.');
      if (parts.length !== 3) {
        return {
          hasToken: true,
          rawToken: displayToken,
          tokenParts: parts.length,
          header: null,
          payload: null,
          signature: null,
          expiry: null,
          ttlSeconds: null,
          timeToExpiry: 'Invalid format',
          issuedAt: null,
          tokenType: 'Invalid JWT',
          issuer: null,
          audience: null,
          subject: null,
          uniqueId: null,
          scopes: null,
          debugInfo: `Invalid JWT format. Expected 3 parts, got ${parts.length}`,
          isExpired: false,
          isExpiringSoon: false
        };
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Decode header
      const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));

      // Decode payload
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      // Calculate expiry info with live updates
      const now = Math.floor(currentTime / 1000);
      const issuedAt = payload.iat ? new Date(payload.iat * 1000) : null;
      const expiry = payload.exp ? new Date(payload.exp * 1000) : null;
      const ttlSeconds = payload.exp ? Math.max(0, payload.exp - now) : null;
      const isExpired = ttlSeconds !== null && ttlSeconds <= 0;
      const isExpiringSoon = ttlSeconds !== null && ttlSeconds > 0 && ttlSeconds <= 300; // 5 minutes

      // Format time to expiry
      let timeToExpiry = 'Unknown';
      if (ttlSeconds !== null) {
        if (isExpired) {
          timeToExpiry = 'EXPIRED';
        } else {
          const hours = Math.floor(ttlSeconds / 3600);
          const minutes = Math.floor((ttlSeconds % 3600) / 60);
          const seconds = ttlSeconds % 60;

          if (ttlSeconds < 60) {
            timeToExpiry = `${seconds}s`;
          } else if (ttlSeconds < 3600) {
            timeToExpiry = `${minutes}m ${seconds}s`;
          } else {
            timeToExpiry = `${hours}h ${minutes}m ${seconds}s`;
          }
        }
      }

      // Determine token type
      let tokenType = 'Unknown JWT';
      if (payload.iss) {
        if (payload.iss.includes('microsoftonline.com')) {
          tokenType = 'Microsoft Entra ID';
        } else if (payload.iss.includes('sonicbrief-backend')) {
          tokenType = 'SonicBrief Backend';
        } else if (payload.iss.includes('localhost')) {
          tokenType = 'Local Development';
        } else {
          tokenType = `Custom JWT (${payload.iss})`;
        }
      } else if (payload.sub && !payload.iss) {
        tokenType = 'Legacy JWT (No Issuer)';
      }

      return {
        hasToken: true,
        rawToken: displayToken,
        tokenParts: 3,
        header,
        payload,
        signature: signatureB64,
        expiry,
        ttlSeconds,
        timeToExpiry,
        issuedAt,
        tokenType,
        issuer: payload.iss || null,
        audience: payload.aud || null,
        subject: payload.sub || null,
        uniqueId: payload.uti || payload.jti || `${payload.iat}-${payload.exp}`,
        scopes: payload.scp || payload.scope || payload.scopes || null,
        debugInfo: `Valid JWT. TTL: ${ttlSeconds || 0}s. Type: ${tokenType}`,
        isExpired,
        isExpiringSoon
      };
    } catch (error) {
      return {
        hasToken: true,
        rawToken: displayToken,
        tokenParts: displayToken.split('.').length,
        header: null,
        payload: null,
        signature: null,
        expiry: null,
        ttlSeconds: null,
        timeToExpiry: 'Parse Error',
        issuedAt: null,
        tokenType: 'Invalid Token',
        issuer: null,
        audience: null,
        subject: null,
        uniqueId: null,
        scopes: null,
        debugInfo: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isExpired: false,
        isExpiringSoon: false
      };
    }
  };

  const detailedTokenInfo = getDetailedTokenInfo();

  // Helper function to determine authentication method with clear labeling
  const getAuthMethodDisplay = () => {
    if (!authenticated) {
      return { type: 'None', color: 'text-red-600', badge: '❌ Not Authenticated' };
    }

    if (authMethod === 'msal') {
      return {
        type: 'Microsoft Entra ID (MSAL)',
        color: 'text-blue-600',
        badge: '🔵 MSAL',
        description: 'Modern Azure AD authentication'
      };
    }

    if (authMethod === 'legacy') {
      return {
        type: 'Legacy Authentication',
        color: 'text-orange-600',
        badge: '🟠 LEGACY',
        description: 'Traditional JWT-based auth'
      };
    }

    return {
      type: 'Unknown',
      color: 'text-gray-600',
      badge: '❓ UNKNOWN',
      description: 'Authentication method not determined'
    };
  };

  const authMethodInfo = getAuthMethodDisplay();

  const getStatusColor = (value: number, type: 'hitRate' | 'errors' | 'refreshTime') => {
    switch (type) {
      case 'hitRate':
        if (value >= 80) return 'text-green-600';
        if (value >= 60) return 'text-yellow-600';
        return 'text-red-600';
      case 'errors':
        if (value === 0) return 'text-green-600';
        if (value <= 5) return 'text-yellow-600';
        return 'text-red-600';
      case 'refreshTime':
        if (value <= 200) return 'text-green-600';
        if (value <= 500) return 'text-yellow-600';
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
      <div
        className="px-4 py-3 bg-gray-50 border-b border-gray-200 cursor-pointer flex justify-between items-center"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h3 className="text-sm font-medium text-gray-900">
          🔒 Authentication Monitor Dashboard ({location})
        </h3>
        <div className="flex items-center space-x-2">
          {/* Auth Method Badge */}
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            authMethod === 'msal' ? 'bg-blue-100 text-blue-800' :
            authMethod === 'legacy' ? 'bg-orange-100 text-orange-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {authMethodInfo.badge}
          </span>
          {/* Performance Badge */}
          {metrics && (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              (metrics.hitRate || 0) >= 80 ? 'bg-green-100 text-green-800' :
              (metrics.hitRate || 0) >= 60 ? 'bg-yellow-100 text-yellow-800' :
              'bg-red-100 text-red-800'
            }`}>
              {(metrics.hitRate || 0).toFixed(1)}% Cache
            </span>
          )}
          <span className="text-gray-400">{isCollapsed ? '▼' : '▲'}</span>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-4">
          {/* Emergency Token Detection - ALWAYS VISIBLE FIRST */}
          <div className={`p-4 rounded-lg border mb-4 ${
            Object.keys(emergencyTokens).length > 0
              ? 'bg-green-50 border-green-300'
              : 'bg-red-50 border-red-300'
          }`}>
            <h4 className={`text-sm font-semibold mb-3 ${
              Object.keys(emergencyTokens).length > 0
                ? 'text-green-800'
                : 'text-red-800'
            }`}>
              🚨 Emergency Token Scanner
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Total Tokens Found:</span>
                <span className={`font-mono font-bold ${
                  Object.keys(emergencyTokens).length > 0 ? 'text-green-700' : 'text-red-700'
                }`}>
                  {Object.keys(emergencyTokens).length}
                </span>
              </div>
              {Object.keys(emergencyTokens).length > 0 ? (
                <div className="mt-3 p-3 bg-green-100 rounded border">
                  <div className="text-green-800 font-semibold mb-2">✅ TOKENS FOUND:</div>
                  <ul className="space-y-1 text-xs">
                    {Object.entries(emergencyTokens).map(([key, value]) => (
                      <li key={key} className="font-mono">
                        📍 <span className="text-green-700 font-bold">{key}</span>
                        <br />
                        <span className="text-green-600 ml-4 break-all">
                          [redacted preview] len={value.length}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        const firstToken = Object.values(emergencyTokens)[0];
                        navigator.clipboard.writeText(firstToken);
                        alert('✅ Token copied to clipboard!');
                      }}
                      className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      📋 Copy First Token
                    </button>
                    <button
                      onClick={() => {
                        debug.clear();
                        debugLog('🚨 EMERGENCY TOKENS:', emergencyTokens);
                        alert('✅ All tokens logged to console!');
                      }}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      📊 Log All to Console
                    </button>
                    <button
                      onClick={() => {
                        debug.clear();
                        debugLog('🔍 DEBUGGING sessionStorage...');
                        debugLog('sessionStorage.length:', sessionStorage.length);
                        for (let i = 0; i < sessionStorage.length; i++) {
                          const key = sessionStorage.key(i);
                          const value = sessionStorage.getItem(key ?? "");
                          debugLog(`📝 ${key}:`, value ? value.substring(0, 100) + '...' : 'null');
                          if (value && value.includes('.') && value.split('.').length === 3) {
                            debugLog('🎯 ^^^^ THIS IS A JWT TOKEN! ^^^^');
                          }
                        }

                        // Run aggressive scan
                        const results = findTokensEverywhere();
                        debugLog('🚨 Aggressive scan results:', results);
                        alert('✅ SessionStorage debug info logged to console!');
                      }}
                      className="px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                    >
                      🔍 Debug SessionStorage
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 p-3 bg-red-100 rounded border border-red-200">
                  <div className="text-red-800 font-semibold mb-2">❌ NO TOKENS DETECTED</div>
                  <div className="text-xs text-red-700">
                    No JWT tokens found in localStorage, sessionStorage, or global scope.
                    <br />
                    Try logging in first, or check the browser developer tools.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Simple Token Display - Bypass Complex Logic */}
          <div className="p-4 bg-blue-100 rounded-lg border border-blue-300">
            <h4 className="text-sm font-semibold text-blue-800 mb-3">🔧 Simple Token Check</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>localStorage['token']:</span>
                <span className="font-mono text-xs">
                  {localStorage.getItem('token') ?
                    redactTokenPreview(localStorage.getItem('token')!) :
                    '❌ Not found'
                  }
                </span>
              </div>
              <div className="flex justify-between">
                <span>ReadOnly Detection:</span>
                <span className="font-mono text-xs">
                  {readOnlyTokenInfo?.token ?
                    redactTokenPreview(readOnlyTokenInfo.token) :
                    '❌ Not found'
                  }
                </span>
              </div>
              <div className="flex justify-between">
                <span>Simple Detection:</span>
                <span className="font-mono text-xs">
                  {simpleTokenInfo?.token ?
                    redactTokenPreview(simpleTokenInfo.token) :
                    '❌ Not found'
                  }
                </span>
              </div>
              <div className="flex justify-between">
                <span>Fallback Token:</span>
                <span className="font-mono text-xs">
                  {fallbackToken ?
                    redactTokenPreview(fallbackToken) :
                    '❌ Not found'
                  }
                </span>
              </div>
              <div className="flex justify-between">
                <span>Final Display Token:</span>
                <span className="font-mono text-xs">
                  {displayToken ?
                    redactTokenPreview(displayToken) :
                    '❌ Not found'
                  }
                </span>
              </div>
              {displayToken && (
                <div className="mt-3 p-3 bg-green-50 rounded border border-green-200">
                  <div className="text-xs text-green-800 font-semibold mb-1">✅ Current Active Token:</div>
                  <div className="font-mono text-xs break-all bg-white p-2 rounded border max-h-32 overflow-y-auto">
                    {displayToken}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(displayToken);
                        alert('✅ Token copied to clipboard!');
                      }}
                      className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      📋 Copy Token
                    </button>
                    <button
                      onClick={() => {
                        debug.clear();
                        debugLog('🎯 FULL TOKEN:', displayToken);
                        debugLog('🎯 LENGTH:', displayToken.length);
                        try {
                          const parts = displayToken.split('.');
                          if (parts.length === 3) {
                            debugLog('🎯 HEADER:', JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))));
                            debugLog('🎯 PAYLOAD:', JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))));
                            debugLog('🎯 SIGNATURE:', parts[2]);
                          }
                        } catch (error) {
                          debugLog('🎯 PARSE ERROR:', error);
                        }
                        alert('✅ Token details logged to console!');
                      }}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      📊 Analyze in Console
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Real-time Scan Results */}
          {scanResults && (
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-300">
              <h4 className="text-sm font-semibold text-amber-800 mb-3">🔍 Real-time Token Scan Results</h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span>Last Scan:</span>
                  <span className="font-mono">{new Date().toLocaleTimeString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Tokens Found:</span>
                  <span className="font-mono text-amber-800 font-bold">
                    {scanResults.foundTokens?.length || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Valid JWT Tokens:</span>
                  <span className="font-mono text-green-700 font-bold">
                    {scanResults.validTokens?.length || 0}
                  </span>
                </div>
                {scanResults.foundTokens && scanResults.foundTokens.length > 0 && (
                  <div className="mt-2 p-2 bg-amber-100 rounded">
                    <div className="text-amber-800 font-semibold mb-1">Discovered Token Sources:</div>
                    <ul className="space-y-1">
                      {scanResults.foundTokens.map((tokenInfo: any, index: number) => (
                        <li key={index} className="text-xs">
                          📍 <span className="font-mono text-amber-700">{tokenInfo.source}</span>
                          {tokenInfo.key && (
                            <span className="text-amber-600"> → {tokenInfo.key}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Manual Token Testing */}
          <div className="p-4 bg-purple-100 rounded-lg border border-purple-300">
            <h4 className="text-sm font-semibold text-purple-800 mb-3">🧪 Manual Token Testing</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-purple-700 mb-1">
                  Paste JWT Token for Testing:
                </label>
                <textarea
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6..."
                  className="w-full h-20 px-3 py-2 text-xs font-mono border border-purple-300 rounded resize-none"
                />
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    if (manualToken) {
                      try {
                        const parts = manualToken.split('.');
                        if (parts.length === 3) {
                          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                          debugLog('🧪 Manual Token Analysis:', {
                            header: JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))),
                            payload,
                            signature: `[redacted sig len=${parts[2].length} sha=${shortHash(parts[2])}]`,
                            expires: payload.exp ? new Date(payload.exp * 1000).toLocaleString() : 'No expiry',
                            valid: payload.exp ? payload.exp > Math.floor(Date.now() / 1000) : 'Unknown'
                          });
                          alert('✅ Token analyzed! Check console for details.');
                        } else {
                          alert('❌ Invalid JWT format (must have 3 parts separated by dots)');
                        }
                      } catch (error) {
                        console.error('Token analysis error:', error);
                        alert('❌ Failed to parse token: ' + error);
                      }
                    } else {
                      alert('Please paste a token first');
                    }
                  }}
                  className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                >
                  🔍 Analyze
                </button>
                <button
                  onClick={() => {
                    if (manualToken) {
                      localStorage.setItem('debug_manual_token', manualToken);
                      alert('Token saved to localStorage["debug_manual_token"]. Refresh page to see if it\'s detected.');
                    }
                  }}
                  className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                >
                  💾 Test Save
                </button>
                <button
                  onClick={() => setManualToken('')}
                  className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  🗑️ Clear
                </button>
              </div>
            </div>
          </div>

          {/* Emergency Token Display - Always Visible */}
          <div className="p-4 bg-red-100 rounded-lg border-2 border-red-300">
            <h4 className="text-sm font-semibold text-red-800 mb-3">🚨 Emergency Token Finder</h4>
            <div className="space-y-3">
              <button
                onClick={() => {
                  debug.clear();
                  debugLog('🚨 EMERGENCY TOKEN SEARCH - Starting comprehensive scan...');

                  // Method 1: Check localStorage directly
                  debugLog('📦 Method 1: localStorage scan');
                  const allKeys = Object.keys(localStorage);
                  const potentialTokens: string[] = [];

                  allKeys.forEach(key => {
                    try {
                      const value = localStorage.getItem(key);
                      if (value && typeof value === 'string') {
                        // Direct JWT check
                        if (value.includes('.') && value.split('.').length === 3) {
                          debugLog(`🎯 Direct JWT found in localStorage['${key}'] length=`, value.length);
                          potentialTokens.push(`localStorage.${key}: ${value}`);
                        }

                        // JSON parsing check
                        try {
                          const parsed = JSON.parse(value);
                          if (parsed && typeof parsed === 'object') {
                            Object.entries(parsed).forEach(([subKey, subValue]) => {
                              if (typeof subValue === 'string' && subValue.includes('.') && subValue.split('.').length === 3) {
                                debugLog(`🎯 Nested JWT found in localStorage['${key}'].${subKey} length=`, (subValue as string).length);
                                potentialTokens.push(`localStorage.${key}.${subKey}: ${subValue}`);
                              }
                            });
                          }
                        } catch {}
                      }
                    } catch (error) {
                      debugLog(`❌ Error checking ${key}:`, error);
                    }
                  });

                  // Method 2: Check sessionStorage
                  debugLog('📦 Method 2: sessionStorage scan');
                  Object.keys(sessionStorage).forEach(key => {
                    try {
                      const value = sessionStorage.getItem(key);
                      if (value && value.includes('.') && value.split('.').length === 3) {
                        debugLog(`🎯 JWT found in sessionStorage['${key}'] length=`, value.length);
                        potentialTokens.push(`sessionStorage.${key}: ${value}`);
                      }
                    } catch {}
                  });

                  // Method 3: Check global variables
                  debugLog('🌍 Method 3: Global variables scan');
                  Object.keys(window).forEach(key => {
                    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('auth') || key.toLowerCase().includes('msal')) {
                      try {
                        const value = (window as any)[key];
                        debugLog(`🔍 Found auth-related global: ${key}`, typeof value, value);
                      } catch {}
                    }
                  });

                  debugLog(`📊 TOTAL TOKENS FOUND: ${potentialTokens.length}`);
                  potentialTokens.forEach((token, index) => {
                    debugLog(`${index + 1}. ${token.split(':')[0]}`);
                    debugLog(`   Preview: ${token.split(':')[1]?.substring(0, 100)}...`);
                  });

                  if (potentialTokens.length === 0) {
                    debugLog('❌ NO TOKENS FOUND - Authentication may not be working');
                    alert('❌ No tokens found anywhere! Check console for details.');
                  } else {
                    alert(`✅ Found ${potentialTokens.length} potential tokens! Check console for details.`);
                  }
                }}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold"
              >
                🔍 SCAN ALL STORAGE FOR TOKENS
              </button>

              <div className="text-xs text-red-700">
                <p><strong>Use this if no token is detected above.</strong></p>
                <p>This will scan localStorage, sessionStorage, and global variables for any JWT tokens.</p>
                <p>Results will be logged to the browser console.</p>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="border-b border-gray-200 mb-4">
            <nav className="flex space-x-4">
              {[
                { id: 'overview', label: '📋 Overview', count: '' },
                { id: 'token', label: '🎫 Token Details', count: displayToken ? '✓' : '' },
                { id: 'performance', label: '📊 Performance', count: metrics?.tokenRefreshCount || 0 },
                { id: 'logs', label: '🔍 Debug Logs', count: (readOnlyTokenInfo.debugLogs?.length || 0) + (simpleTokenInfo.debugLogs?.length || 0) }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label} {tab.count && `(${tab.count})`}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Authentication Status */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-4 rounded-lg border-l-4 ${
                  authenticated
                    ? 'bg-green-50 border-green-400'
                    : 'bg-red-50 border-red-400'
                }`}>
                  <h4 className="text-sm font-semibold mb-2">🔐 Authentication Status</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className={authenticated ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                        {pending ? '🔄 Checking...' : authenticated ? '✅ Authenticated' : '❌ Not Authenticated'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Method:</span>
                      <span className={authMethodInfo.color}>
                        {authMethodInfo.type}
                      </span>
                    </div>
                    {authMethodInfo.description && (
                      <div className="text-xs text-gray-600 mt-1">
                        {authMethodInfo.description}
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-blue-50 rounded-lg border-l-4 border-blue-400">
                  <h4 className="text-sm font-semibold mb-2">⚙️ Configuration</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Environment:</span>
                      <span>{import.meta.env.DEV ? '🔧 Development' : '🚀 Production'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Debug Mode:</span>
                      <span>{env.VITE_DEBUG ? '🟢 Enabled' : '🔴 Disabled'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Auth Method Config:</span>
                      <span>"{env.VITE_AUTH_METHOD}"</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-2">
                      Legacy: {authConfig.isLegacyEnabled() ? '✅' : '❌'} |
                      Entra: {authConfig.isEntraEnabled() ? '✅' : '❌'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Token Summary */}
              {displayToken && (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-semibold mb-2">🎫 Token Summary</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Length:</span>
                      <span className="ml-2 font-mono">{displayToken.length} chars</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Type:</span>
                      <span className="ml-2">{detailedTokenInfo.tokenType}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">TTL:</span>
                      <span className={`ml-2 ${
                        detailedTokenInfo.isExpired ? 'text-red-600 font-bold' :
                        detailedTokenInfo.isExpiringSoon ? 'text-yellow-600 font-semibold' :
                        'text-green-600'
                      }`}>
                        {detailedTokenInfo.timeToExpiry}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Auth Debug Actions */}
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h4 className="text-sm font-semibold mb-3 text-yellow-800">🔧 Authentication Debug Actions</h4>
                <div className="space-y-2">
                  <div className="text-xs text-yellow-700 mb-3">
                    Use these tools to troubleshoot authentication issues. These actions will clear stored tokens and may require re-login.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        debugAuthStorage();
                        alert('Check browser console for auth storage details');
                      }}
                      className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      📊 Debug Storage
                    </button>
                    <button
                      onClick={() => {
                        clearLegacyAuth();
                        alert('Legacy tokens cleared. Refresh page to see effect.');
                      }}
                      className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
                    >
                      🧹 Clear Legacy
                    </button>
                    <button
                      onClick={() => {
                        clearMsalAuth();
                        alert('MSAL tokens cleared. Refresh page to see effect.');
                      }}
                      className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
                    >
                      🧹 Clear MSAL
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('This will clear ALL authentication data. Continue?')) {
                          clearAllAuth();
                          alert('All auth data cleared. Refreshing page...');
                          setTimeout(() => window.location.reload(), 1000);
                        }
                      }}
                      className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      💥 Clear All Auth
                    </button>
                  </div>
                  <div className="text-xs text-yellow-600 mt-2">
                    Current issue: If you're seeing "legacy" auth but want MSAL, try "Clear Legacy" then refresh and login again.
                  </div>
                </div>
              </div>

              {/* Method Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="text-sm font-semibold text-blue-800 mb-2">
                    🔵 MSAL (Microsoft Entra ID)
                  </h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Active:</span>
                      <span className={authMethod === 'msal' ? 'text-green-600' : 'text-gray-500'}>
                        {authMethod === 'msal' ? '✅ Current' : '⏸️ Inactive'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Enabled:</span>
                      <span>{authConfig.isEntraEnabled() ? '✅ Yes' : '❌ No'}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-2">
                      Modern Azure AD authentication with automatic token refresh
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <h4 className="text-sm font-semibold text-orange-800 mb-2">
                    🟠 LEGACY Authentication
                  </h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Active:</span>
                      <span className={authMethod === 'legacy' ? 'text-green-600' : 'text-gray-500'}>
                        {authMethod === 'legacy' ? '✅ Current' : '⏸️ Inactive'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Enabled:</span>
                      <span>{authConfig.isLegacyEnabled() ? '✅ Yes' : '❌ No'}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-2">
                      Traditional JWT-based authentication system
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'token' && !displayToken && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <h4 className="text-sm font-semibold text-red-800 mb-2">❌ No Token Detected</h4>
                <div className="space-y-2 text-sm text-red-700">
                  <p>The debug panel cannot detect a current authentication token.</p>
                  <div className="space-y-1 text-xs">
                    <div><strong>Possible causes:</strong></div>
                    <ul className="list-disc list-inside pl-2 space-y-1">
                      <li>User is not authenticated</li>
                      <li>Token has expired</li>
                      <li>Token is stored in a different location</li>
                      <li>MSAL token cache is not accessible</li>
                    </ul>
                  </div>
                  <div className="pt-2 space-x-2">
                    <button
                      onClick={() => {
                        debugLog('🔍 Attempting aggressive token search...');
                        const result = findTokensEverywhere();
                        debugLog('🎯 Aggressive search results:', result);

                        if (result.token) {
                          alert(`✅ Found token from: ${result.source}\nToken length: ${result.token.length}\n(Preview redacted)`);
                        } else {
                          alert('❌ No valid tokens found. Check console for search details.');
                        }
                      }}
                      className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      🔍 Aggressive Token Search
                    </button>
                    <button
                      onClick={() => {
                        debugAllTokens();
                        alert('🔧 Complete token analysis logged to console. Check browser developer tools.');
                      }}
                      className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
                    >
                      � Debug All Tokens
                    </button>
                    <button
                      onClick={() => window.location.reload()}
                      className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      🔄 Refresh Page
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'token' && displayToken && (
            <div className="space-y-4">
              <div className="flex space-x-2 mb-4">
                <button
                  onClick={() => setShowRawToken(!showRawToken)}
                  className={`px-3 py-1 text-sm rounded ${
                    showRawToken ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  }`}
                >
                  Raw Token
                </button>
                <button
                  onClick={() => setShowDecodedPayload(!showDecodedPayload)}
                  className={`px-3 py-1 text-sm rounded ${
                    showDecodedPayload ? 'bg-green-500 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  Decoded Payload
                </button>
                <button
                  onClick={() => {
                    // Force refresh by calling the read-only function directly
                    debugLog('🔄 Manual token refresh requested');
                    window.location.reload();
                  }}
                  className="px-3 py-1 text-sm rounded bg-orange-100 text-orange-700 hover:bg-orange-200"
                >
                  🔄 Refresh Token
                </button>
              </div>

              {/* Token Information Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700">Token Properties</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Type:</span>
                      <span className="font-mono">{detailedTokenInfo.tokenType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Method:</span>
                      <span className={authMethodInfo.color}>{authMethod}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Length:</span>
                      <span className="font-mono">{displayToken?.length || 0} chars</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Parts:</span>
                      <span className="font-mono">{detailedTokenInfo.tokenParts}/3</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Unique ID:</span>
                      <span className="font-mono text-xs">{detailedTokenInfo.uniqueId || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700">Timing Information</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Issued At:</span>
                      <span className="text-xs">{detailedTokenInfo.issuedAt ? detailedTokenInfo.issuedAt.toLocaleString() : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Expires At:</span>
                      <span className="text-xs">{detailedTokenInfo.expiry ? detailedTokenInfo.expiry.toLocaleString() : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Time to Expiry:</span>
                      <span className={`font-mono ${
                        detailedTokenInfo.isExpired ? 'text-red-600 font-bold' :
                        detailedTokenInfo.isExpiringSoon ? 'text-yellow-600 font-semibold' :
                        'text-green-600'
                      }`}>
                        {detailedTokenInfo.timeToExpiry}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>TTL Seconds:</span>
                      <span className="font-mono">{detailedTokenInfo.ttlSeconds || 'N/A'}</span>
                    </div>
                    {lastTokenChange && (
                      <div className="flex justify-between">
                        <span>Last Change:</span>
                        <span className="text-xs">{lastTokenChange.toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* JWT Claims */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">JWT Claims</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <div><strong>Issuer:</strong> <span className="font-mono text-xs break-all">{detailedTokenInfo.issuer || 'N/A'}</span></div>
                    <div><strong>Audience:</strong> <span className="font-mono text-xs break-all">{detailedTokenInfo.audience || 'N/A'}</span></div>
                  </div>
                  <div className="space-y-1">
                    <div><strong>Subject:</strong> <span className="font-mono text-xs break-all">{detailedTokenInfo.subject || 'N/A'}</span></div>
                    <div><strong>Scopes:</strong> <span className="font-mono text-xs break-all">{detailedTokenInfo.scopes || 'N/A'}</span></div>
                  </div>
                </div>
              </div>

              {/* Raw Token Display */}
              {showRawToken && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">🔑 Current Raw JWT Token</h4>
                  <div className="bg-gray-100 p-3 rounded text-xs font-mono break-all max-h-32 overflow-y-auto border">
                    {displayToken || 'No token available'}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Token length: {displayToken ? displayToken.length : 0} characters |
                    Last updated: {new Date().toLocaleTimeString()}
                    {fallbackToken && displayToken === fallbackToken && (
                      <span className="text-orange-600 font-semibold"> | Source: Aggressive Search ({fallbackSource})</span>
                    )}
                  </div>
                </div>
              )}

              {/* Always Visible Token Summary */}
              <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <h4 className="text-sm font-semibold text-yellow-800 mb-2">🎫 Current Token Status</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Token Present:</span>
                    <span className={displayToken ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                      {displayToken ? '✅ YES' : '❌ NO'}
                    </span>
                  </div>
                  {displayToken && (
                    <>
                      <div className="flex justify-between">
                        <span>Token Preview (redacted):</span>
                        <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                          [redacted] (len={displayToken.length}, sha8={
                            (() => {
                              try {
                                return btoa(displayToken).replace(/[^A-Za-z0-9]/g, '').substring(0,8);
                              } catch { return 'na'; }
                            })()
                          })
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Full Length:</span>
                        <span className="font-mono">{displayToken.length} chars</span>
                      </div>
                      {fallbackToken && displayToken === fallbackToken && (
                        <div className="flex justify-between">
                          <span>Source:</span>
                          <span className="text-orange-600 font-semibold">Aggressive Search</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="text-xs text-gray-600 pt-1 border-t border-yellow-200">
                    Click "Raw Token" button above to view complete token
                  </div>
                </div>
              </div>

              {/* Decoded Token Parts */}
              {showDecodedPayload && (
                <div className="space-y-3">
                  {detailedTokenInfo.header && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">JWT Header</h4>
                      <div className="bg-blue-50 p-3 rounded text-xs font-mono max-h-32 overflow-y-auto">
                        <pre>{JSON.stringify(detailedTokenInfo.header, null, 2)}</pre>
                      </div>
                    </div>
                  )}

                  {detailedTokenInfo.payload && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">JWT Payload</h4>
                      <div className="bg-green-50 p-3 rounded text-xs font-mono max-h-48 overflow-y-auto">
                        <pre>{JSON.stringify(detailedTokenInfo.payload, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'performance' && metrics && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-green-50 rounded-lg">
                  <h4 className="text-sm font-semibold text-green-800 mb-2">Cache Performance</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Hits:</span>
                      <span className="font-mono">{metrics.cacheHits || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Misses:</span>
                      <span className="font-mono">{metrics.cacheMisses || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Hit Rate:</span>
                      <span className={`font-mono ${getStatusColor(metrics.hitRate || 0, 'hitRate')}`}>
                        {(metrics.hitRate || 0).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 rounded-lg">
                  <h4 className="text-sm font-semibold text-blue-800 mb-2">Token Operations</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Refreshes:</span>
                      <span className="font-mono">{metrics.tokenRefreshCount || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Background:</span>
                      <span className="font-mono">{metrics.backgroundRefreshes || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Preemptive:</span>
                      <span className="font-mono">{metrics.preemptiveRefreshes || 0}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-yellow-50 rounded-lg">
                  <h4 className="text-sm font-semibold text-yellow-800 mb-2">System Health</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Errors:</span>
                      <span className={`font-mono ${getStatusColor(metrics.errorCount || 0, 'errors')}`}>
                        {metrics.errorCount || 0}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Time:</span>
                      <span className={`font-mono ${getStatusColor(metrics.averageRefreshTime || 0, 'refreshTime')}`}>
                        {metrics.averageRefreshTime || 0}ms
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cache Size:</span>
                      <span className="font-mono">{metrics.cacheSize || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-4">
              {/* MSAL vs Legacy Detection Logs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="text-sm font-semibold text-blue-800 mb-2">🔵 MSAL Detection Logs</h4>
                  <div className="bg-white p-2 rounded text-xs font-mono max-h-64 overflow-y-auto">
                    {readOnlyTokenInfo.debugLogs?.filter(log =>
                      log.includes('MSAL') || log.includes('microsoft') || log.includes('msal')
                    ).map((log, index) => (
                      <div key={`msal-${index}`} className={
                        log.includes('✅') ? 'text-green-600' :
                        log.includes('❌') ? 'text-red-600' :
                        log.includes('⚠️') ? 'text-yellow-600' :
                        'text-gray-700'
                      }>
                        {log}
                      </div>
                    )) || <div className="text-gray-500">No MSAL-specific logs</div>}
                  </div>
                </div>

                <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <h4 className="text-sm font-semibold text-orange-800 mb-2">🟠 Legacy Detection Logs</h4>
                  <div className="bg-white p-2 rounded text-xs font-mono max-h-64 overflow-y-auto">
                    {readOnlyTokenInfo.debugLogs?.filter(log =>
                      log.includes('legacy') || log.includes('Legacy') || log.includes('localStorage')
                    ).map((log, index) => (
                      <div key={`legacy-${index}`} className={
                        log.includes('✅') ? 'text-green-600' :
                        log.includes('❌') ? 'text-red-600' :
                        log.includes('⚠️') ? 'text-yellow-600' :
                        'text-gray-700'
                      }>
                        {log}
                      </div>
                    )) || <div className="text-gray-500">No Legacy-specific logs</div>}
                  </div>
                </div>
              </div>

              {/* All Debug Logs */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Complete Debug Log</h4>
                <div className="bg-gray-100 p-3 rounded text-xs font-mono max-h-64 overflow-y-auto">
                  {readOnlyTokenInfo.debugLogs?.map((log, index) => (
                    <div key={`all-${index}`} className={
                      log.includes('✅') ? 'text-green-600' :
                      log.includes('❌') ? 'text-red-600' :
                      log.includes('⚠️') ? 'text-yellow-600' :
                      'text-gray-700'
                    }>
                      {log}
                    </div>
                  ))}

                  {simpleTokenInfo.debugLogs?.map((log, index) => (
                    <div key={`simple-${index}`} className={
                      log.includes('✅') ? 'text-green-600' :
                      log.includes('❌') ? 'text-red-600' :
                      log.includes('⚠️') ? 'text-yellow-600' :
                      'text-gray-700'
                    }>
                      {log}
                    </div>
                  ))}

                  {(!readOnlyTokenInfo.debugLogs?.length && !simpleTokenInfo.debugLogs?.length) && (
                    <div className="text-gray-500">No debug logs available</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-gray-200 pt-3 mt-4 flex justify-between items-center text-xs text-gray-500">
            <span>Generated: {new Date().toLocaleTimeString()}</span>
            <span>Active: {authMethodInfo.type} | Changes: {tokenChangeCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default UnifiedDebugDashboard;
