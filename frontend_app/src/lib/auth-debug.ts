// ENTIRE FILE COMMENTED OUT FOR SECURITY - CONTAINS EXTENSIVE AUTHENTICATION DEBUGGING
// THAT COULD EXPOSE SENSITIVE INFORMATION INCLUDING TOKENS AND AUTH STATE

/*
All original authentication debugging functions have been commented out
to prevent sensitive data exposure in production environments.

Original functions included extensive console logging that could expose:
- JWT tokens and token content
- Account IDs and user information
- MSAL cache keys and authentication state
- Token expiration times and scopes
- Authentication metrics and timing data
*/

// Placeholder exports to maintain TypeScript compatibility
export async function inspectMsalTokens() {
  // COMMENTED OUT FOR SECURITY
  return { error: 'Function disabled for security' };
}

export async function checkAuthenticationStatus() {
  // COMMENTED OUT FOR SECURITY
  const { debug } = await import('./debug');
  debug.log('Authentication debugging disabled for security');
}

export function explainTokenSecurity() {
  // COMMENTED OUT FOR SECURITY
  import('./debug').then(({ debug }) => debug.log('Token security explanation disabled for security'));
}

export function clearLegacyAuth() {
  // COMMENTED OUT FOR SECURITY
  import('./debug').then(({ debug }) => debug.log('Legacy auth clearing disabled for security'));
}

export function clearMsalAuth() {
  // COMMENTED OUT FOR SECURITY
  import('./debug').then(({ debug }) => debug.log('MSAL auth clearing disabled for security'));
}

export function clearAllAuth() {
  // COMMENTED OUT FOR SECURITY
  import('./debug').then(({ debug }) => debug.log('Auth clearing disabled for security'));
}

export function debugAuthStorage() {
  // COMMENTED OUT FOR SECURITY
  return { hasLegacyToken: false, msalKeyCount: 0, allAuthKeyCount: 0 };
}
