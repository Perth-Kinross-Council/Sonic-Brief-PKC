/**
 * SIMPLIFIED READ-ONLY Token Information Provider
 * 
 * This creates a MINIMAL read-only version that tries to get tokens
 * using the same methods as the main auth system, but without side effects.
 */

import { useMsal, useIsAuthenticated } from "@azure/msal-react";

interface SimpleTokenInfo {
  token: string | null;
  isAuthenticated: boolean;
  authMethod: 'msal' | 'legacy' | null;
  debugLogs: string[];
  source: string;
}

/**
 * Simple function to get current token WITHOUT triggering any auth flows
 * This tries the most direct approaches first
 */
export function getSimpleTokenInfo(): SimpleTokenInfo {
  const debugLogs: string[] = [];
  let token: string | null = null;
  let authMethod: 'msal' | 'legacy' | null = null;
  let isAuthenticated = false;
  let source = 'none';

  debugLogs.push('[SimpleTokenInfo] Starting simplified token detection...');

  // Method 1: Check localStorage for legacy token first (fastest)
  try {
    const legacyToken = localStorage.getItem('token');
    if (legacyToken && legacyToken.includes('.')) {
      const parts = legacyToken.split('.');
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          const now = Math.floor(Date.now() / 1000);
          
          if (payload.exp && payload.exp > now) {
            token = legacyToken;
            authMethod = 'legacy';
            isAuthenticated = true;
            source = 'localStorage-legacy';
            debugLogs.push('[SimpleTokenInfo] ✅ Found valid legacy token');
            
            return { token, isAuthenticated, authMethod, debugLogs, source };
          } else {
            debugLogs.push('[SimpleTokenInfo] ❌ Legacy token expired');
          }
        } catch (e) {
          debugLogs.push(`[SimpleTokenInfo] Legacy token parse error: ${e}`);
        }
      }
    } else {
      debugLogs.push('[SimpleTokenInfo] No legacy token found');
    }
  } catch (e) {
    debugLogs.push(`[SimpleTokenInfo] Legacy token access error: ${e}`);
  }

  // Method 2: Try to access MSAL cache directly if available
  try {
    if (typeof window !== 'undefined' && (window as any).msal) {
      debugLogs.push('[SimpleTokenInfo] Found MSAL on window.msal');
      const msalInstance = (window as any).msal;
      
      const accounts = msalInstance.getAllAccounts();
      debugLogs.push(`[SimpleTokenInfo] MSAL accounts: ${accounts.length}`);
      
      if (accounts.length > 0) {
        const account = accounts[0];
        debugLogs.push(`[SimpleTokenInfo] Primary account: ${account.username}`);
        
        try {
          const cache = msalInstance.getTokenCache();
          if (cache && cache.getKVStore) {
            const kvStore = cache.getKVStore();
            const cacheKeys = Object.keys(kvStore);
            debugLogs.push(`[SimpleTokenInfo] Cache keys: ${cacheKeys.length}`);
            
            // Look for access tokens for this account
            const accountId = account.homeAccountId || account.localAccountId;
            const tokenKeys = cacheKeys.filter(key => 
              key.includes('accesstoken') && 
              key.includes(accountId)
            );
            
            debugLogs.push(`[SimpleTokenInfo] Token keys for account: ${tokenKeys.length}`);
            
            for (const key of tokenKeys) {
              const entry = kvStore[key];
              if (entry && entry.secret) {
                try {
                  const parts = entry.secret.split('.');
                  if (parts.length === 3) {
                    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                    const now = Math.floor(Date.now() / 1000);
                    
                    if (payload.exp && payload.exp > now) {
                      token = entry.secret;
                      authMethod = 'msal';
                      isAuthenticated = true;
                      source = 'msal-cache-direct';
                      debugLogs.push('[SimpleTokenInfo] ✅ Found valid MSAL token in cache');
                      
                      return { token, isAuthenticated, authMethod, debugLogs, source };
                    } else {
                      debugLogs.push('[SimpleTokenInfo] ❌ MSAL token expired');
                    }
                  }
                } catch (e) {
                  debugLogs.push(`[SimpleTokenInfo] Token parse error: ${e}`);
                }
              }
            }
          }
        } catch (e) {
          debugLogs.push(`[SimpleTokenInfo] MSAL cache access error: ${e}`);
        }
      }
    } else {
      debugLogs.push('[SimpleTokenInfo] No MSAL found on window.msal');
    }
  } catch (e) {
    debugLogs.push(`[SimpleTokenInfo] MSAL access error: ${e}`);
  }

  // Method 3: Comprehensive localStorage search for any JWT patterns
  try {
    debugLogs.push('[SimpleTokenInfo] Searching all localStorage for JWT patterns...');
    const allKeys = Object.keys(localStorage);
    
    for (const key of allKeys) {
      try {
        const value = localStorage.getItem(key);
        if (!value) continue;
        
        // Direct JWT check
        if (value.includes('.') && value.split('.').length === 3) {
          try {
            const payload = JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const now = Math.floor(Date.now() / 1000);
            
            if (payload.exp && payload.exp > now) {
              token = value;
              authMethod = payload.iss?.includes('microsoftonline.com') ? 'msal' : 'legacy';
              isAuthenticated = true;
              source = `localStorage-direct-${key}`;
              debugLogs.push(`[SimpleTokenInfo] ✅ Found valid JWT in ${key}`);
              
              return { token, isAuthenticated, authMethod, debugLogs, source };
            }
          } catch (e) {
            // Not a valid JWT, continue
          }
        }
        
        // JSON with nested JWT check
        if ((value.startsWith('{') || value.startsWith('['))) {
          try {
            const parsed = JSON.parse(value);
            const findToken = (obj: any, path = ''): string | null => {
              if (typeof obj === 'string' && obj.includes('.') && obj.split('.').length === 3) {
                try {
                  const payload = JSON.parse(atob(obj.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                  const now = Math.floor(Date.now() / 1000);
                  
                  if (payload.exp && payload.exp > now) {
                    debugLogs.push(`[SimpleTokenInfo] ✅ Found valid nested JWT in ${key}${path}`);
                    return obj;
                  }
                } catch (e) {
                  // Not a valid JWT
                }
              } else if (typeof obj === 'object' && obj !== null) {
                for (const prop of Object.keys(obj)) {
                  const result = findToken(obj[prop], `${path}.${prop}`);
                  if (result) return result;
                }
              }
              return null;
            };
            
            const foundToken = findToken(parsed);
            if (foundToken) {
              const payload = JSON.parse(atob(foundToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
              token = foundToken;
              authMethod = payload.iss?.includes('microsoftonline.com') ? 'msal' : 'legacy';
              isAuthenticated = true;
              source = `localStorage-nested-${key}`;
              
              return { token, isAuthenticated, authMethod, debugLogs, source };
            }
          } catch (e) {
            // Not valid JSON
          }
        }
      } catch (e) {
        // Error accessing key, continue
      }
    }
    
    debugLogs.push('[SimpleTokenInfo] No valid tokens found in localStorage');
  } catch (e) {
    debugLogs.push(`[SimpleTokenInfo] localStorage search error: ${e}`);
  }

  debugLogs.push('[SimpleTokenInfo] ❌ No valid tokens found anywhere');
  
  return { token, isAuthenticated, authMethod, debugLogs, source };
}

/**
 * React hook version that tries MSAL hooks if available
 */
export function useSimpleTokenInfo(): SimpleTokenInfo {
  // First try direct token detection
  const directResult = getSimpleTokenInfo();
  
  // If we found a token directly, return it
  if (directResult.token) {
    return directResult;
  }
  
  // If no direct token found, try MSAL hooks as a fallback
  try {
    const { instance } = useMsal();
    const isAuthenticated = useIsAuthenticated();
    
    if (isAuthenticated && instance) {
      const accounts = instance.getAllAccounts();
      if (accounts.length > 0) {
        // We know MSAL says we're authenticated, but we couldn't find the token
        // This indicates the token is in MSAL's internal cache but not accessible
        return {
          token: null,
          isAuthenticated: false, // We can't verify without the actual token
          authMethod: null,
          debugLogs: [...directResult.debugLogs, '[SimpleTokenInfo] MSAL says authenticated but token not accessible'],
          source: 'msal-inaccessible'
        };
      }
    }
  } catch (error) {
    // MSAL hooks not available
  }
  
  return directResult;
}
