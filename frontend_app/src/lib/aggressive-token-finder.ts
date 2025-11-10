/**
 * Aggressive Token Finder - searches all possible locations for authentication tokens
 * This is for debugging purposes only and should not be used in production
 */

import { debug } from './debug';

interface TokenSearchResult {
  token: string | null;
  source: string;
  debugLogs: string[];
  allTokensFound: Array<{
    token: string;
    source: string;
    isValid: boolean;
    expiresAt: Date | null;
  }>;
}

/**
 * Aggressively search for tokens in all possible locations
 */
export function findTokensEverywhere(): TokenSearchResult {
  const debugLogs: string[] = [];
  const allTokensFound: TokenSearchResult['allTokensFound'] = [];
  let bestToken: string | null = null;
  let bestSource = 'none';

  debugLogs.push(`🔍 Starting aggressive token search at ${new Date().toLocaleTimeString()}`);

  // PRIORITY: Search sessionStorage comprehensively (where tokens are stored!)
  try {
    const sessionKeys = Object.keys(sessionStorage);
    debugLogs.push(`📦 PRIORITY: Checking ${sessionKeys.length} sessionStorage keys`);

    for (const key of sessionKeys) {
      try {
        const value = sessionStorage.getItem(key);
        if (!value) continue;

        // Check if the value itself is a JWT
        if (value.includes('.') && value.split('.').length === 3) {
          const isValid = validateToken(value);
          const expiresAt = getTokenExpiry(value);

          allTokensFound.push({
            token: value,
            source: `sessionStorage.${key}`,
            isValid,
            expiresAt
          });

          if (isValid && (!bestToken || isTokenBetter(value, bestToken))) {
            bestToken = value;
            bestSource = `sessionStorage.${key}`;
          }

          debugLogs.push(`✅ Direct JWT found in sessionStorage.${key} - Valid: ${isValid}`);
          continue;
        }

        // Try to parse as JSON and look for nested tokens
        try {
          const parsed = JSON.parse(value);
          const nestedTokens = extractTokensFromObject(parsed, `sessionStorage.${key}`);

          for (const nested of nestedTokens) {
            const isValid = validateToken(nested.token);
            const expiresAt = getTokenExpiry(nested.token);

            allTokensFound.push({
              token: nested.token,
              source: nested.source,
              isValid,
              expiresAt
            });

            if (isValid && (!bestToken || isTokenBetter(nested.token, bestToken))) {
              bestToken = nested.token;
              bestSource = nested.source;
            }

            debugLogs.push(`✅ Nested JWT found in ${nested.source} - Valid: ${isValid}`);
          }
        } catch (parseError) {
          // Not JSON, check if it might be a partial token or encoded
          if (value.length > 50 && (value.includes('eyJ') || value.includes('Bearer'))) {
            debugLogs.push(`🔍 Potential token data in sessionStorage.${key} (length: ${value.length})`);
          }
        }
      } catch (error) {
        debugLogs.push(`❌ Error checking sessionStorage key ${key}: ${error}`);
      }
    }
  } catch (error) {
    debugLogs.push(`❌ Error accessing sessionStorage: ${error}`);
  }

  // Also search localStorage (secondary)
  try {
    const allKeys = Object.keys(localStorage);
    debugLogs.push(`📦 Secondary: Checking ${allKeys.length} localStorage keys`);

    const tokenKeys = allKeys.filter(key =>
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('msal') ||
      key.toLowerCase().includes('auth') ||
      key.includes('41d9bfd4-9418-4abd-88eb-2a5b1e6330bf') || // Client ID
      key.includes('71bea96c-7f27-4eae-9310-14aeb4ebd598')    // Scope ID
    );

    debugLogs.push(`🎯 Found ${tokenKeys.length} potential auth-related keys`);

    for (const key of tokenKeys) {
      try {
        const value = localStorage.getItem(key);
        if (!value) continue;

        // Check if the value itself is a JWT
        if (value.includes('.') && value.split('.').length === 3) {
          const isValid = validateToken(value);
          const expiresAt = getTokenExpiry(value);

          allTokensFound.push({
            token: value,
            source: `localStorage.${key}`,
            isValid,
            expiresAt
          });

          if (isValid && (!bestToken || isTokenBetter(value, bestToken))) {
            bestToken = value;
            bestSource = `localStorage.${key}`;
          }

          debugLogs.push(`✅ Direct JWT found in ${key.substring(0, 40)}... - Valid: ${isValid}`);
          continue;
        }

        // Try to parse as JSON and look for nested tokens
        try {
          const parsed = JSON.parse(value);
          const nestedTokens = extractTokensFromObject(parsed, key);

          for (const nested of nestedTokens) {
            const isValid = validateToken(nested.token);
            const expiresAt = getTokenExpiry(nested.token);

            allTokensFound.push({
              token: nested.token,
              source: nested.source,
              isValid,
              expiresAt
            });

            if (isValid && (!bestToken || isTokenBetter(nested.token, bestToken))) {
              bestToken = nested.token;
              bestSource = nested.source;
            }

            debugLogs.push(`✅ Nested JWT found in ${nested.source} - Valid: ${isValid}`);
          }
        } catch (parseError) {
          // Not JSON, skip
        }
      } catch (error) {
        debugLogs.push(`❌ Error checking key ${key}: ${error}`);
      }
    }
  } catch (error) {
    debugLogs.push(`❌ Error accessing localStorage: ${error}`);
  }

  // Search for MSAL instances in global scope
  try {
    const msalKeys = Object.keys(window).filter(key =>
      key.toLowerCase().includes('msal') ||
      key.toLowerCase().includes('auth')
    );

    for (const key of msalKeys) {
      try {
        const msalInstance = (window as any)[key];
        if (msalInstance && typeof msalInstance === 'object') {
          debugLogs.push(`🔍 Examining global MSAL object: ${key}`);
          // Try to extract tokens from MSAL cache if accessible
          // This is read-only examination
        }
      } catch (error) {
        debugLogs.push(`❌ Error examining global ${key}: ${error}`);
      }
    }
  } catch (error) {
    debugLogs.push(`❌ Error searching global scope: ${error}`);
  }

  debugLogs.push(`🏁 Search complete. Best token source: ${bestSource}`);
  debugLogs.push(`📊 Total tokens found: ${allTokensFound.length}`);
  debugLogs.push(`✅ Valid tokens: ${allTokensFound.filter(t => t.isValid).length}`);

  return {
    token: bestToken,
    source: bestSource,
    debugLogs,
    allTokensFound
  };
}

/**
 * Validate if a token is a valid JWT and not expired
 */
function validateToken(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const now = Math.floor(Date.now() / 1000);

    return payload.exp && payload.exp > now;
  } catch (error) {
    return false;
  }
}

/**
 * Get token expiry date
 */
function getTokenExpiry(token: string): Date | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp ? new Date(payload.exp * 1000) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Determine if token A is better than token B (longer TTL, valid vs invalid, etc.)
 */
function isTokenBetter(tokenA: string, tokenB: string): boolean {
  const expiryA = getTokenExpiry(tokenA);
  const expiryB = getTokenExpiry(tokenB);

  if (!expiryA && !expiryB) return false;
  if (!expiryB) return true;
  if (!expiryA) return false;

  return expiryA.getTime() > expiryB.getTime();
}

/**
 * Recursively extract JWT tokens from an object
 */
function extractTokensFromObject(obj: any, basePath: string): Array<{token: string, source: string}> {
  const tokens: Array<{token: string, source: string}> = [];

  function recurse(current: any, path: string) {
    if (typeof current === 'string' && current.includes('.') && current.split('.').length === 3) {
      tokens.push({ token: current, source: path });
    } else if (typeof current === 'object' && current !== null) {
      for (const [key, value] of Object.entries(current)) {
        if (key.toLowerCase().includes('token') ||
            key.toLowerCase().includes('access') ||
            key.toLowerCase().includes('id')) {
          recurse(value, `${path}.${key}`);
        }
      }
    }
  }

  recurse(obj, basePath);
  return tokens;
}

/**
 * Console log all found tokens for debugging (be careful with sensitive data)
 */
export function debugAllTokens(): void {
  // Intentionally disabled to avoid token exposure
  debug.log('🔐 Token debugging disabled for security');
}
