/**
 * Utility functions to extract user information from authentication tokens and MSAL accounts
 */

// Simple JWT decode function
function jwtDecode(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Error decoding JWT token:', error);
    return null;
  }
}

export interface UserInfo {
  email: string | null;
  username: string | null;
  displayName: string | null;
  source: 'msal' | 'legacy' | 'none';
}

/**
 * Extract user information from MSAL account
 */
export function getUserInfoFromMsal(msalInstance: any): UserInfo {
  try {
    if (!msalInstance) {
      return { email: null, username: null, displayName: null, source: 'none' };
    }

    const accounts = msalInstance.getAllAccounts();
    if (accounts && accounts.length > 0) {
      const account = accounts[0]; // Use the first account
      
      return {
        email: account.username || account.name || null,
        username: account.username ? account.username.split('@')[0] : null,
        displayName: account.name || account.username || null,
        source: 'msal'
      };
    }
  } catch (error) {
    console.error('Error extracting user info from MSAL:', error);
  }

  return { email: null, username: null, displayName: null, source: 'none' };
}

/**
 * Extract user information from JWT token
 */
export function getUserInfoFromToken(token: string): UserInfo {
  try {
    const payload = jwtDecode(token);
    if (!payload) {
      return { email: null, username: null, displayName: null, source: 'none' };
    }

    // Try different JWT claims for email/username
    const email = payload.email || payload.upn || payload.preferred_username || payload.unique_name || null;
    const displayName = payload.name || payload.given_name || payload.family_name || email || null;
    const username = email ? email.split('@')[0] : null;

    return {
      email,
      username,
      displayName,
      source: 'legacy'
    };
  } catch (error) {
    console.error('Error extracting user info from token:', error);
    return { email: null, username: null, displayName: null, source: 'none' };
  }
}

/**
 * Extract user information from either MSAL account or token
 */
export function getUserInfo(msalInstance?: any, token?: string | null): UserInfo {
  // Try MSAL first if available
  if (msalInstance) {
    const msalUserInfo = getUserInfoFromMsal(msalInstance);
    if (msalUserInfo.source !== 'none') {
      return msalUserInfo;
    }
  }

  // Fallback to token
  if (token) {
    return getUserInfoFromToken(token);
  }

  // No user info available
  return { email: null, username: null, displayName: null, source: 'none' };
}

/**
 * Hook to get user information from the current authentication state
 */
export function useUserInfo(msalInstance?: any, token?: string | null): UserInfo {
  return getUserInfo(msalInstance, token);
}
