/**
 * READ-ONLY Token Information Provider
 *
 * This provides token information for display purposes ONLY.
 * It never triggers authentication flows, token acquisition, or state updates.
 * Perfect for debug panels, status displays, etc.
 */

import { useMsal, useIsAuthenticated } from "@azure/msal-react";
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

/**
 * Get current token information without triggering any auth flows
 * This is a PURE READ operation - no side effects, no network calls, no state changes
 */
export function getReadOnlyTokenInfo(msalInstance?: any, isMsalAuthenticated?: boolean): ReadOnlyTokenInfo {
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

  debugLogs.push('[ReadOnlyTokenInfo] Starting token detection...');

  // Method 1: Try to get token from Enhanced Auth Manager global (if available)
  try {
    const globalKeys = Object.keys(window).filter(key => key.includes('authManager') || key.includes('enhancedAuth'));
    if (globalKeys.length > 0) {
      for (const authManagerKey of globalKeys) {
        try {
          const authManager = (window as any)[authManagerKey];
          if (authManager && typeof authManager.getToken === 'function') {
            const currentToken = authManager.getToken();
            if (currentToken && typeof currentToken === 'string') {
              debugLogs.push(`[ReadOnlyTokenInfo] Auth manager returned token: ${redactTokenPreview(currentToken)}`);

              // Validate this token quickly
              try {
                const parts = currentToken.split('.');
                if (parts.length === 3) {
                  const [, payloadBase64] = parts;
                  const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
                  const now = Math.floor(Date.now() / 1000);

                  if (payload.exp && payload.exp > now) {
                    token = currentToken;
                    authMethod = 'msal'; // Assume auth manager provides MSAL tokens
                    isAuthenticated = true;
                    debugLogs.push('[ReadOnlyTokenInfo] ✅ Using auth manager token');
                    break;
                  }
                }
              } catch (validateError) {
                debugLogs.push(`[ReadOnlyTokenInfo] Auth manager token validation failed: ${validateError}`);
              }
            }
          }
        } catch (e) {
          debugLogs.push(`[ReadOnlyTokenInfo] Auth manager error: ${e}`);
        }
      }
    } else {
      debugLogs.push('[ReadOnlyTokenInfo] No auth manager global found');
    }
  } catch (e) {
    debugLogs.push(`[ReadOnlyTokenInfo] Auth manager access error: ${e}`);
  }

  // Method 2: Try MSAL approach (simplified version without getKVStore)
  if (msalInstance && isMsalAuthenticated !== undefined) {
    debugLogs.push(`[ReadOnlyTokenInfo] MSAL Status: authenticated=${isMsalAuthenticated}`);

    try {
      const accounts = msalInstance.getAllAccounts();
      debugLogs.push(`[ReadOnlyTokenInfo] MSAL accounts found: ${accounts.length}`);

      if (accounts.length > 0 && isMsalAuthenticated) {
        const account = accounts[0];
        debugLogs.push(`[ReadOnlyTokenInfo] MSAL primary account: ${account.username || account.localAccountId}`);

        // Note: Direct cache access with getKVStore() is not reliable across MSAL versions
        // We'll rely on localStorage and other methods instead
        debugLogs.push('[ReadOnlyTokenInfo] Skipping direct MSAL cache access (compatibility issues)');
      }
    } catch (msalError) {
      debugLogs.push(`[ReadOnlyTokenInfo] MSAL access error: ${msalError}`);
    }
  } else {
    debugLogs.push('[ReadOnlyTokenInfo] No MSAL instance or auth status provided');
  }

  // Method 3: Check localStorage for legacy tokens
  if (!isAuthenticated) {
    debugLogs.push('[ReadOnlyTokenInfo] Checking localStorage for legacy token...');
    try {
      const legacyToken = window.localStorage.getItem('token');
  if (legacyToken) {
	debugLogs.push(`[ReadOnlyTokenInfo] Found legacy token: ${redactTokenPreview(legacyToken)}`);

        // Validate legacy token
        try {
          const parts = legacyToken.split('.');
          if (parts.length === 3) {
            const [, payloadBase64] = parts;
            const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
            const now = Math.floor(Date.now() / 1000);

            debugLogs.push(`[ReadOnlyTokenInfo] Legacy token exp: ${payload.exp}, now: ${now}`);

            if (payload.exp && payload.exp > now) {
              token = legacyToken;
              authMethod = 'legacy';
              isAuthenticated = true;
              debugLogs.push('[ReadOnlyTokenInfo] ✅ Using valid legacy token');
            } else {
              debugLogs.push('[ReadOnlyTokenInfo] ❌ Legacy token expired');
            }
          }
        } catch (parseError) {
          debugLogs.push(`[ReadOnlyTokenInfo] Legacy token parse error: ${parseError}`);
        }
      } else {
        debugLogs.push('[ReadOnlyTokenInfo] No legacy token found in localStorage');
      }
    } catch (storageError) {
      debugLogs.push(`[ReadOnlyTokenInfo] localStorage access error: ${storageError}`);
    }
  }

  // Method 4: Search localStorage for MSAL-like keys
  if (!isAuthenticated) {
    debugLogs.push('[ReadOnlyTokenInfo] Searching for MSAL tokens...');
    try {
      const keys = Object.keys(localStorage).filter(key => key.toLowerCase().includes('msal'));
      debugLogs.push(`[ReadOnlyTokenInfo] MSAL-like keys found: ${keys.length}`);
      keys.slice(0, 10).forEach((key, index) => debugLogs.push(`${index + 1}. ${key}`));

      for (const key of keys) {
  debugLogs.push(`[ReadOnlyTokenInfo] Examining key: ${key.substring(0, 25)}…`);
        try {
          const value = localStorage.getItem(key);
          if (value && value.includes('.') && value.split('.').length === 3) {
            // Looks like a JWT
            const parts = value.split('.');
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            const now = Math.floor(Date.now() / 1000);

            if (payload.exp && payload.exp > now) {
              token = value;
              authMethod = 'msal';
              isAuthenticated = true;
              debugLogs.push('[ReadOnlyTokenInfo] ✅ Found valid MSAL token in localStorage');
              break;
            }
          } else {
            debugLogs.push(`[ReadOnlyTokenInfo] No valid token found in key ${key.substring(0, 30)}...`);
          }
        } catch (parseError) {
          // Silent fail for non-token values
        }
      }
    } catch (searchError) {
      debugLogs.push(`[ReadOnlyTokenInfo] MSAL token search error: ${searchError}`);
    }
  }

  // Generate display information if we have a token
  let displayInfo = null;
  if (token) {
    try {
      const parts = token.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      const issuedAt = payload.iat ? new Date(payload.iat * 1000) : null;
      const expiresAt = payload.exp ? new Date(payload.exp * 1000) : null;
      const timeToExpiry = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : null;

      displayInfo = {
        tokenLength: token.length,
        tokenParts: parts.length,
  tokenHash: shortHash(token),
        issuer: payload.iss || null,
        audience: payload.aud || null,
        issuedAt,
        expiresAt,
        timeToExpiry,
        ttlString: timeToExpiry ? `${Math.floor(timeToExpiry / 60)}m ${timeToExpiry % 60}s` : 'Unknown',
        payload
      };
    } catch (displayError) {
      debugLogs.push(`[ReadOnlyTokenInfo] Display info generation error: ${displayError}`);
    }
  }

  debugLogs.push(`[ReadOnlyTokenInfo] Final result: authenticated=${isAuthenticated}, method=${authMethod}, tokenLength=${token?.length || 0}`);

  return {
    token,
    isAuthenticated,
    authMethod,
    debugLogs,
    displayInfo
  };
}

/**
 * React hook version of getReadOnlyTokenInfo
 */
export function useReadOnlyTokenInfo(): ReadOnlyTokenInfo {
  const { instance } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  return getReadOnlyTokenInfo(instance, isAuthenticated);
}
