/**
 * READ-ONLY Token Information Provider
 *
 * This provides token information for display purposes ONLY.
 * It never triggers authentication flows, token acquisition, or state updates.
 * Perfect for debug panels, status displays, etc.
 */

import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { useState, useEffect } from "react";
import { debugGroup, debugGroupEnd, debugError, debugLog } from './debug';
import { redactTokenPreview, shortHash } from '@/lib/tokenRedaction';

interface ReadOnlyTokenInfo {
  token: string | null;
  isAuthenticated: boolean;
  authMethod: 'msal' | 'legacy' | null;
  debugLogs: string[];
  displayInfo: {
    tokenLength: number;
    tokenParts: number;
    tokenHash: string;
    issuer: string | null;
    audience: string | null;
    issuedAt: Date | null;
    expiresAt: Date | null;
    timeToExpiry: number | null;
    ttlString: string;
    payload: any;
  } | null;
}

// Rate limiting to prevent excessive calls that might trigger auth flows
let lastCallTime = 0;
let cachedResult: ReadOnlyTokenInfo | null = null;
const RATE_LIMIT_MS = 2000; // Only allow calls every 2 seconds

/**
 * Get current token information without triggering any auth flows
 * This is a PURE READ operation - no side effects, no network calls, no state changes
 * RATE LIMITED to prevent excessive calls that might trigger auth manager activity
 */
export function getReadOnlyTokenInfo(msalInstance?: any, isMsalAuthenticated?: boolean, verbose: boolean = false): ReadOnlyTokenInfo {
  // Rate limiting to prevent triggering auth manager refresh
  const now = Date.now();
  if (cachedResult && (now - lastCallTime) < RATE_LIMIT_MS) {
    // Return cached result to avoid excessive calls
    return {
      ...cachedResult,
      debugLogs: [...cachedResult.debugLogs, `[ReadOnlyTokenInfo] Rate limited - returning cached result (${Math.round((now - lastCallTime) / 1000)}s ago)`]
    };
  }

  lastCallTime = now;
  let token: string | null = null;
  let authMethod: 'msal' | 'legacy' | null = null;
  let isAuthenticated = false;
  const debugLogs: string[] = [];

  if (typeof window === 'undefined') {
    return {
      token: null,
      isAuthenticated: false,
      authMethod: null,
      debugLogs: ['Server-side environment detected'],
      displayInfo: null
    };
  }

  debugLogs.push(`🔍 ReadOnlyTokenInfo ${verbose ? 'Debug - Token Detection Analysis' : 'Summary'} [${new Date().toLocaleTimeString()}]`);

  // CRITICAL: If we have access to the main auth system, try to use it read-only
  // WARNING: This MUST be truly read-only - no method calls that could trigger token refresh!
  try {
    // Try to access the EnhancedAuthManager singleton if it exists
    // The EnhancedAuthManager stores tokens in memory, not localStorage!

    // First try the known global name
    let authManager = (window as any).sonicBriefAuthManager;

    if (!authManager) {
      // Fallback: search for any auth manager
      const authManagerKey = Object.keys(window).find(key =>
        key.includes('authManager') || key.includes('AuthManager')
      );

      if (authManagerKey) {
        if (verbose) debugLogs.push(`[ReadOnlyTokenInfo] Found auth manager global: ${authManagerKey}`);
        authManager = (window as any)[authManagerKey];
      }
    } else {
      if (verbose) debugLogs.push(`[ReadOnlyTokenInfo] Found sonicBriefAuthManager global`);
    }

    if (authManager) {
      if (verbose) debugLogs.push(`[ReadOnlyTokenInfo] Auth manager found - examining cache read-only`);
      // CRITICAL: Only access properties, never call methods!
      // Any method call could trigger token refresh flows

      // Try to access the token cache if available - READ ONLY
      if (authManager.tokenCache) {
        try {
          if (verbose) debugLogs.push(`[ReadOnlyTokenInfo] Auth manager has tokenCache: ${typeof authManager.tokenCache}`);

          if (authManager.tokenCache.size !== undefined) {
            debugLogs.push(`✅ Token cache available (${authManager.tokenCache.size} entries)`);
          }

          if (verbose) debugLogs.push('[ReadOnlyTokenInfo] Token cache access available but skipping detailed access for TypeScript compatibility');

        } catch (cacheError) {
          debugLogs.push(`[ReadOnlyTokenInfo] Cache access error: ${cacheError}`);
        }
      } else {
        debugLogs.push('[ReadOnlyTokenInfo] No accessible token cache found');
      }
    } else {
      if (!authManager) {
        debugLogs.push('[ReadOnlyTokenInfo] No auth manager global found');
      } else {
        debugLogs.push('[ReadOnlyTokenInfo] Auth manager found but no getToken method');
      }
    }

    // ALTERNATIVE: Try to access the auth manager through React context or hooks
    // Since the main auth system shows authenticated: true, there must be an auth manager instance somewhere

    // Check if we can access the token cache directly via the MSAL instance
    if (msalInstance && isMsalAuthenticated) {
      debugLogs.push('[ReadOnlyTokenInfo] MSAL instance and authentication detected. Skipping direct cache access for compatibility.');
      // Only use public MSAL APIs and localStorage for token detection.
      // No direct internal cache access attempted.
    }
  } catch (e) {
    debugLogs.push(`[ReadOnlyTokenInfo] Auth manager access error: ${e}`);
  }

  // Log MSAL status if provided
  if (msalInstance && isMsalAuthenticated !== undefined) {
    debugLogs.push(`✅ MSAL Status: authenticated=${isMsalAuthenticated}`);

    // Try to get token from MSAL cache without triggering flows
    try {
      const accounts = msalInstance.getAllAccounts();
      debugLogs.push(`📋 MSAL accounts found: ${accounts.length}`);
      if (accounts.length > 0 && isMsalAuthenticated) {
        const account = accounts[0];
        if (verbose) debugLogs.push(`[ReadOnlyTokenInfo] MSAL primary account: ${account.username || account.localAccountId}`);
        // No direct cache access; rely on public MSAL APIs and localStorage only.
      }
    } catch (msalError) {
      debugLogs.push(`[ReadOnlyTokenInfo] MSAL access error: ${msalError}`);
    }
  } else {
    debugLogs.push('[ReadOnlyTokenInfo] No MSAL instance provided');
  }

  // Debug: Log all localStorage keys for inspection
  debugLogs.push('🗄️ Complete localStorage Analysis');
  try {
    const allKeys = Object.keys(localStorage);
    if (verbose) debugLogs.push(`[ReadOnlyTokenInfo] Total localStorage keys: ${allKeys.length}`);

    const authRelatedKeys = allKeys.filter(key =>
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('msal') ||
      key.toLowerCase().includes('auth') ||
      key.includes('41d9bfd4-9418-4abd-88eb-2a5b1e6330bf') || // Your client ID
      key.includes('71bea96c-7f27-4eae-9310-14aeb4ebd598')    // Your scope
    );

    debugLogs.push(`🔍 Auth-related storage entries: ${authRelatedKeys.length} of ${allKeys.length} total`);
    if (verbose && authRelatedKeys.length > 0) {
      authRelatedKeys.forEach((key, index) => {
        debugLogs.push(`  ${index + 1}. ${key.substring(0, 80)}${key.length > 80 ? '...' : ''}`);
      });
    }
  } catch (e) {
    debugLogs.push(`[ReadOnlyTokenInfo] Failed to list localStorage keys: ${e}`);
  }

  // First check for legacy token (localStorage directly)
  try {
    const legacyToken = localStorage.getItem('token');
    if (verbose) debugLogs.push(`[ReadOnlyTokenInfo] Legacy token check: ${legacyToken ? 'Found' : 'Not found'}`);

    if (legacyToken && legacyToken.includes('.')) {
      const parts = legacyToken.split('.');
      debugLogs.push(`[ReadOnlyTokenInfo] Legacy token parts: ${parts.length}`);

      if (parts.length === 3) {
        const [, payloadBase64] = parts;
        try {
          const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
          const nowSecLegacy = Math.floor(Date.now() / 1000);
          debugLogs.push(`[ReadOnlyTokenInfo] Legacy token exp: ${payload.exp}, now: ${nowSecLegacy}, valid: ${payload.exp && payload.exp > nowSecLegacy}`);

          if (payload.exp && payload.exp > nowSecLegacy) {
            token = legacyToken;
            authMethod = 'legacy';
            isAuthenticated = true;
            debugLogs.push('[ReadOnlyTokenInfo] ✅ Using valid legacy token');
          } else {
            debugLogs.push('[ReadOnlyTokenInfo] ❌ Legacy token expired');
          }
        } catch (parseError) {
          debugLogs.push(`[ReadOnlyTokenInfo] Failed to parse legacy token: ${parseError}`);
        }
      }
    }
  } catch (e) {
    debugLogs.push(`[ReadOnlyTokenInfo] Legacy token error: ${e instanceof Error ? e.message : 'Unknown'}`);
  }

  // If no legacy token, check MSAL tokens (localStorage directly - no MSAL API calls)
  if (!token) {
    try {
      debugLogs.push('[ReadOnlyTokenInfo] Searching for MSAL tokens...');

      const allKeys = Object.keys(localStorage);

      // First, look for ANY MSAL token patterns (be very permissive)
      const anyMsalKeys = allKeys.filter(key =>
        key.includes('accesstoken') ||
        key.includes('idtoken') ||
        key.includes('msal.') ||
        key.includes('41d9bfd4-9418-4abd-88eb-2a5b1e6330bf') || // Your client ID
        key.includes('71bea96c-7f27-4eae-9310-14aeb4ebd598') || // Your scope
        key.includes('User.Read') ||
        key.includes('.default') ||
        key.includes('microsoftonline.com') ||
        key.includes('azure')
      );

      debugLogs.push(`[ReadOnlyTokenInfo] MSAL-like keys found: ${anyMsalKeys.length}`);
      anyMsalKeys.forEach((key, index) => {
        debugLogs.push(`  ${index + 1}. ${key.substring(0, 60)}${key.length > 60 ? '...' : ''}`);
      });

      // If no specific MSAL keys found, search ALL localStorage values for JWT patterns
      if (anyMsalKeys.length === 0) {
        debugLogs.push('[ReadOnlyTokenInfo] No specific MSAL keys found, searching ALL localStorage for JWT patterns...');

        allKeys.forEach((key) => {
          try {
            const value = localStorage.getItem(key);
            if (value && typeof value === 'string') {
              // Check if the value itself looks like a JWT
              if (value.includes('.') && value.split('.').length === 3) {
                debugLogs.push(`[ReadOnlyTokenInfo] Found JWT-like value in key: ${key.substring(0, 40)}...`);
                anyMsalKeys.push(key);
              }
              // Check if the value is JSON containing a JWT
              else if (value.startsWith('{') || value.startsWith('[')) {
                try {
                  const parsed = JSON.parse(value);
                  if (typeof parsed === 'object' && parsed !== null) {
                    // Recursively search for JWT-like strings in the object
                    const searchForJWTs = (obj: any, path = ''): void => {
                      if (typeof obj === 'string' && obj.includes('.') && obj.split('.').length === 3) {
                        debugLogs.push(`[ReadOnlyTokenInfo] Found JWT-like value at ${key}${path}: ${redactTokenPreview(obj)}`);
                        anyMsalKeys.push(key);
                      } else if (typeof obj === 'object' && obj !== null) {
                        Object.keys(obj).forEach(prop => {
                          searchForJWTs(obj[prop], `${path}.${prop}`);
                        });
                      }
                    };
                    searchForJWTs(parsed);
                  }
                } catch (e) {
                  // Not valid JSON, ignore
                }
              }
            }
          } catch (e) {
            // Error accessing this key, ignore
          }
        });

        debugLogs.push(`[ReadOnlyTokenInfo] After JWT pattern search, total candidates: ${anyMsalKeys.length}`);
      }

      for (const key of anyMsalKeys) {
        try {
          const tokenData = localStorage.getItem(key);
          if (tokenData) {
            debugLogs.push(`[ReadOnlyTokenInfo] Examining key: ${key.substring(0, 40)}...`);

            // First check if the value itself is a JWT
            if (tokenData.includes('.') && tokenData.split('.').length === 3) {
              debugLogs.push(`[ReadOnlyTokenInfo] Value is directly a JWT token`);

              try {
                const [, payloadBase64] = tokenData.split('.');
                const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
                const nowSecDirect = Math.floor(Date.now() / 1000);
                debugLogs.push(`[ReadOnlyTokenInfo] Direct JWT - exp: ${payload.exp}, now: ${nowSecDirect}, issuer: ${payload.iss}`);

                if (payload.exp && payload.exp > nowSecDirect) {
                  token = tokenData;
                  authMethod = 'msal';
                  isAuthenticated = true;
                  debugLogs.push('[ReadOnlyTokenInfo] ✅ Using valid direct JWT token');
                  break;
                } else {
                  debugLogs.push('[ReadOnlyTokenInfo] ❌ Direct JWT token expired');
                }
              } catch (parseError) {
                debugLogs.push(`[ReadOnlyTokenInfo] Failed to parse direct JWT payload: ${parseError}`);
              }
              continue;
            }

            // Try to parse as JSON and look for tokens
            let parsed;
            try {
              parsed = JSON.parse(tokenData);
              debugLogs.push(`[ReadOnlyTokenInfo] Parsed structure: ${Object.keys(parsed).join(', ')}`);
            } catch (parseError) {
              debugLogs.push(`[ReadOnlyTokenInfo] Not JSON data in key: ${key.substring(0, 40)}...`);
              continue;
            }

            // Check for token in various possible locations
            let candidateToken = null;
            if (parsed.secret && typeof parsed.secret === 'string' && parsed.secret.includes('.')) {
              candidateToken = parsed.secret;
              debugLogs.push(`[ReadOnlyTokenInfo] Found token in 'secret' field`);
            } else if (parsed.accessToken && typeof parsed.accessToken === 'string' && parsed.accessToken.includes('.')) {
              candidateToken = parsed.accessToken;
              debugLogs.push(`[ReadOnlyTokenInfo] Found token in 'accessToken' field`);
            } else if (parsed.access_token && typeof parsed.access_token === 'string' && parsed.access_token.includes('.')) {
              candidateToken = parsed.access_token;
              debugLogs.push(`[ReadOnlyTokenInfo] Found token in 'access_token' field`);
            } else if (parsed.idToken && typeof parsed.idToken === 'string' && parsed.idToken.includes('.')) {
              candidateToken = parsed.idToken;
              debugLogs.push(`[ReadOnlyTokenInfo] Found token in 'idToken' field`);
            } else if (typeof parsed === 'string' && parsed.includes('.')) {
              candidateToken = parsed;
              debugLogs.push(`[ReadOnlyTokenInfo] Token data is string itself`);
            }

            if (candidateToken && candidateToken.includes('.')) {
              const parts = candidateToken.split('.');
              debugLogs.push(`[ReadOnlyTokenInfo] Candidate token parts: ${parts.length}`);

              if (parts.length === 3) {
                const [, payloadBase64] = parts;
                try {
                  const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
                  const nowSecParsed = Math.floor(Date.now() / 1000);
                  debugLogs.push(`[ReadOnlyTokenInfo] Token exp: ${payload.exp}, now: ${nowSecParsed}, issuer: ${payload.iss}`);

                  if (payload.exp && payload.exp > nowSecParsed) {
                    token = candidateToken;
                    authMethod = 'msal';
                    isAuthenticated = true;
                    debugLogs.push('[ReadOnlyTokenInfo] ✅ Using valid MSAL token');
                    break; // Use the first valid token found
                  } else {
                    debugLogs.push('[ReadOnlyTokenInfo] ❌ MSAL token expired');
                  }
                } catch (parseError) {
                  debugLogs.push(`[ReadOnlyTokenInfo] Failed to parse token payload: ${parseError}`);
                }
              }
            } else {
              debugLogs.push(`[ReadOnlyTokenInfo] No valid token found in key ${key.substring(0, 30)}...`);
            }
          }
        } catch (e) {
          debugLogs.push(`[ReadOnlyTokenInfo] Error checking key ${key.substring(0, 30)}...: ${e instanceof Error ? e.message : 'Unknown'}`);
        }
      }
    } catch (e) {
      debugLogs.push(`[ReadOnlyTokenInfo] MSAL search error: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }

  // Generate display info
  let displayInfo = null;
  if (token) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const [, payloadBase64] = parts;
        const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));

  const nowSec = Math.floor(Date.now() / 1000);
  const issuedAt = payload.iat ? new Date(payload.iat * 1000) : null;
  const expiresAt = payload.exp ? new Date(payload.exp * 1000) : null;
  const timeToExpiry = payload.exp ? Math.max(0, payload.exp - nowSec) : null;

        displayInfo = {
          tokenLength: token.length,
          tokenParts: parts.length,
          tokenHash: shortHash(token),
          issuer: payload.iss || null,
          audience: payload.aud || null,
          issuedAt,
          expiresAt,
          timeToExpiry,
          ttlString: timeToExpiry ? `${timeToExpiry}s` : 'Unknown',
          payload
        };

        debugLogs.push(`[ReadOnlyTokenInfo] Generated display info: ${JSON.stringify({
          tokenLength: displayInfo.tokenLength,
          issuer: displayInfo.issuer,
          timeToExpiry: displayInfo.timeToExpiry
        })}`);
      }
    } catch (e) {
      debugLogs.push(`[ReadOnlyTokenInfo] Failed to generate display info: ${e}`);
    }
  }

  // Log final result
  debugLogs.push(`[ReadOnlyTokenInfo] Final result: auth=${isAuthenticated}, method=${authMethod}, tokenLength=${token?.length || 0}`);

  // Output debug logs to console if debug is enabled (also force output for debugging)
  debugGroup('🔍 ReadOnlyTokenInfo Debug - Token Detection Analysis');
  debugGroupEnd();

  // Also force console output of ALL localStorage keys for manual inspection
  if (typeof window !== 'undefined') {
  debugGroup('🗄️ Complete localStorage Analysis');
    try {
      // Deliberately omitting detailed key listing for security cleanliness
    } catch (e) {
      debugError('Failed to list all localStorage keys:', e);
    }
  debugGroupEnd();
  }

  const result = {
    token,
    isAuthenticated,
    authMethod,
    debugLogs,
    displayInfo
  };

  // Cache the result to reduce calls
  cachedResult = result;
  return result;
}

/**
 * React hook for read-only token information
 * Updates every 5 seconds for live TTL calculation to avoid triggering auth flows
 */
export function useReadOnlyTokenInfo(): ReadOnlyTokenInfo {
  // Get MSAL info using hooks at the top level
  let msalInstance = null;
  let isMsalAuthenticated = false;

  try {
    const { instance } = useMsal();
    const isAuth = useIsAuthenticated();

    msalInstance = instance;
    isMsalAuthenticated = isAuth;
  } catch (error) {
    // If MSAL hooks fail, continue with localStorage-only detection
  debugLog('[ReadOnlyTokenInfo] MSAL hooks not available, using localStorage only');
  }

  const [tokenInfo, setTokenInfo] = useState<ReadOnlyTokenInfo>(() => {
    // Initial call with MSAL data - use non-verbose mode for better performance
    return getReadOnlyTokenInfo(msalInstance, isMsalAuthenticated, false);
  });

  useEffect(() => {
    const updateTokenInfo = () => {
      // Use non-verbose mode for periodic updates to reduce console noise
      const newInfo = getReadOnlyTokenInfo(msalInstance, isMsalAuthenticated, false);
      setTokenInfo(newInfo);
    };

    // Set up interval for updates every 5 seconds to avoid triggering auth manager too frequently
    const interval = setInterval(updateTokenInfo, 5000);

    return () => clearInterval(interval);
  }, [msalInstance, isMsalAuthenticated]); // Depend on MSAL state

  return tokenInfo;
}
