import { useEffect } from 'react';
import { debugConfig } from '@/env';
import { debugLog } from '@/lib/debug';

/**
 * Debug component to inspect JWT token structure
 * This will help us understand the exact token format your system uses
 */
export const TokenInspector = () => {
  useEffect(() => {
    if (!debugConfig.isEnabled()) return; // no-op when debug disabled
  debugLog('=== ENHANCED TOKEN ANALYSIS (debug enabled) ===');

    // Get the auth manager directly
    const authManager = (window as any).sonicBriefAuthManager;
    if (authManager) {
  debugLog('✅ Auth manager found:', authManager);

      // Try to get token from auth manager
      authManager.getToken().then((token: string) => {
        if (token) {
          debugLog('✅ Token retrieved (length only):', token.length);

          // Decode the JWT token manually
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              const header = JSON.parse(atob(parts[0]));
              const payload = JSON.parse(atob(parts[1]));

              debugLog('🔍 JWT HEADER:');
              debugLog(JSON.stringify(header, null, 2));
              debugLog('🔍 JWT PAYLOAD:');
              debugLog(JSON.stringify(payload, null, 2));
              debugLog('🔍 ROLE ANALYSIS:');
              debugLog('payload.role:', payload.role);
              debugLog('payload.roles:', payload.roles);
              debugLog('payload.isAdmin:', payload.isAdmin);
              debugLog('payload.admin:', payload.admin);
              debugLog('payload.user_role:', payload.user_role);
              debugLog('payload.authorities:', payload.authorities);
              debugLog('payload.permissions:', payload.permissions);
              debugLog('payload.groups:', payload.groups);
              debugLog('payload.app_roles:', payload.app_roles);
              debugLog('payload.extension_UserRole:', payload.extension_UserRole);
              debugLog('payload.scp:', payload.scp);
              debugLog('payload.aud:', payload.aud);
              debugLog('payload.sub:', payload.sub);
              debugLog('payload.email:', payload.email);
              debugLog('payload.preferred_username:', payload.preferred_username);
              debugLog('payload.name:', payload.name);
              debugLog('🔍 ALL PAYLOAD PROPERTIES:');
              Object.keys(payload).forEach(key => debugLog(`${key}:`, payload[key]));
            } else {
              debugLog('❌ Invalid JWT format - expected 3 parts, got:', parts.length);
            }
          } catch (error) {
            debugLog('❌ Failed to decode JWT:', error);
          }
        } else {
          debugLog('❌ No token returned from auth manager');
        }
      }).catch((error: any) => {
        debugLog('❌ Error getting token from auth manager:', error);
      });
    } else {
      debugLog('❌ No auth manager found on window');
    }
    debugLog('=== STORAGE LOCATION DEBUG ===');
    debugLog('All localStorage keys:', Object.keys(localStorage));
    debugLog('--- CHECKING MSAL SPECIFIC PATTERNS ---');
    const allLocalStorageKeys = Object.keys(localStorage);
    const msalKeys = allLocalStorageKeys.filter(key =>
      key.includes('msal') ||
      key.includes('authority') ||
      key.includes('client') ||
      key.includes('account') ||
      key.includes('cache') ||
      key.includes('token')
    );

    debugLog('MSAL-related localStorage keys:', msalKeys);
    msalKeys.forEach(key => {
      const value = localStorage.getItem(key);
      debugLog(`MSAL key "${key}":`, value?.substring(0, 100) + '...');
    });
    debugLog('--- CHECKING INDEXEDDB ---');
    if ('indexedDB' in window) {
      indexedDB.databases().then(databases => {
        debugLog('Available IndexedDB databases:', databases);
        databases.forEach(db => {
          debugLog(`Database: ${db.name}, Version: ${db.version}`);
        });
      }).catch(err => {
        debugLog('Could not list IndexedDB databases:', err);
      });
    }
    debugLog('--- CHECKING GLOBAL MSAL OBJECTS ---');
    debugLog('window.msal:', (window as any).msal);
    debugLog('window.msalInstance:', (window as any).msalInstance);
    debugLog('window.sonicBriefAuthManager:', (window as any).sonicBriefAuthManager);
    debugLog('--- CHECKING WINDOW PROPERTIES ---');
    const authRelatedProps = Object.keys(window).filter(key =>
      key.toLowerCase().includes('auth') ||
      key.toLowerCase().includes('msal') ||
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('user')
    );
    debugLog('Auth-related window properties:', authRelatedProps);
    debugLog('--- CHECKING POSSIBLE TOKEN KEYS ---');
    const possibleTokenKeys = [
      'token',
      'accessToken',
      'access_token',
      'authToken',
      'auth_token',
      'jwt',
      'jwtToken',
      'bearerToken',
      'userToken',
      'msalToken',
      'msal.token',
      'azure_token',
      'sonic_brief_token'
    ];

    possibleTokenKeys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) {
  debugLog(`✅ Found token at key "${key}" length=`, value.length);
        if (value.includes('.')) {
          try {
            const payload = JSON.parse(atob(value.split('.')[1]));
      debugLog(`📋 Decoded payload for "${key}":`, payload);
      debugLog(`🔑 Role fields in "${key}":`, {
        role: payload.role,
        roles: payload.roles,
        isAdmin: payload.isAdmin,
        admin: payload.admin,
        groups: payload.groups,
        app_roles: payload.app_roles
      });
          } catch (err) {
      debugLog(`❌ Failed to decode "${key}" as JWT:`, err);
          }
        }
      } else {
    debugLog(`❌ No token found at key "${key}"`);
      }
    });
  debugLog('--- CHECKING SESSION STORAGE ---');
  debugLog('All sessionStorage keys:', Object.keys(sessionStorage));
    possibleTokenKeys.forEach(key => {
      const value = sessionStorage.getItem(key);
      if (value) {
  debugLog(`✅ Found token in sessionStorage at key "${key}" length=`, value.length);
      }
    });
  debugLog('--- CHECKING COOKIES ---');
  debugLog('Document cookies:', document.cookie);
  debugLog('=== END TOKEN LOCATION DEBUG ===');
  }, []);

  return null; // This component doesn't render anything
};
