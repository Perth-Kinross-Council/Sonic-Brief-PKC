import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { EnhancedAuthManager } from "./EnhancedAuthManager";
import { debugLog, debugWarn, debugError } from './debug';
import { loginRequest } from "./authConfig";
import { authMonitor } from "./frontend-auth-monitor";
import { env } from "@/env";

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  error: string | null;
  authMethod: 'msal' | 'legacy' | null;
}

interface AuthMetrics {
  tokenRefreshCount: number;
  cacheHits: number;
  cacheMisses: number;
  errorCount: number;
  averageRefreshTime: number;
  backgroundRefreshes: number;
  preemptiveRefreshes: number;
  cacheSize: number;
  hitRate: number;
}

/**
 * Enhanced unified authentication hook for Phase 3 Frontend Optimization
 * Provides intelligent token management, caching, and comprehensive monitoring
 */
export function useEnhancedUnifiedAuth() {
  const { instance: msalInstance } = useMsal();
  const isMsalAuthenticated = useIsAuthenticated();

  // Removed legacy DEBUG block for msalInstance exposure (cleanup)

  // Enhanced auth manager singleton
  const authManagerRef = useRef<EnhancedAuthManager | null>(null);

  // Auth state
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    token: null,
    error: null,
    authMethod: null
  });

  // Initialize auth manager
  useEffect(() => {
    if (!authManagerRef.current && msalInstance && typeof msalInstance.getAllAccounts === 'function') {
      authManagerRef.current = new EnhancedAuthManager(msalInstance, {
        scopes: loginRequest.scopes,
        preemptiveRefreshBuffer: 15, // 15 minutes
        backgroundRefreshInterval: 120000, // 2 minutes
        maxCacheSize: 50,
        enablePerformanceLogging: true
      });

      // Expose auth manager globally for debug purposes
      if (typeof window !== 'undefined') {
        (window as any).sonicBriefAuthManager = authManagerRef.current;
      }
    }
  }, [msalInstance]);

  // Check legacy token validity
  const isValidLegacyToken = useCallback((token: string | null): boolean => {
    if (!token) return false;
    try {
      const [, payloadBase64] = token.split(".");
      if (!payloadBase64) return false;
      const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload.exp) return false;
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    } catch (e) {
      return false;
    }
  }, []);

  // Get current authentication token
  const getToken = useCallback(async (): Promise<string | null> => {
    if (!authManagerRef.current) return null;

    const startTime = performance.now();
    try {
      setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

      // Try MSAL first if user is authenticated
      if (isMsalAuthenticated) {
        const token = await authManagerRef.current.getToken();
        const duration = performance.now() - startTime;
        authMonitor.recordTokenAcquisition(duration, false); // Assume network call for MSAL
        return token;
      }

      // Fallback to legacy token
      const legacyToken = await authManagerRef.current.getLegacyToken();
      const duration = performance.now() - startTime;
      authMonitor.recordTokenAcquisition(duration, true); // Legacy tokens are typically cached
      return legacyToken;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Token acquisition failed';
      console.error('[useEnhancedUnifiedAuth] Token acquisition failed:', error);
      authMonitor.recordError(errorMessage);
      setAuthState(prev => ({ ...prev, error: errorMessage }));
      return null;
    } finally {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, [isMsalAuthenticated]);

  // Track initial MSAL authentication state to prevent unnecessary re-runs
  const initialMsalAuthRef = useRef<boolean | null>(null);

  // Update auth state when authentication status changes (with improved debouncing)
  useEffect(() => {
    // CRITICAL FIX: Add debouncing to prevent infinite loops
    let timeoutId: number;

    const debouncedUpdateAuthState = () => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(updateAuthState, 100); // 100ms debounce
    };

    const updateAuthState = async () => {
      if (!authManagerRef.current || !msalInstance || typeof msalInstance.getAllAccounts !== 'function') {
        return;
      }

      // CRITICAL FIX: More aggressive skip logic to prevent infinite loops
      if (initialMsalAuthRef.current === isMsalAuthenticated && authState.token && authState.isAuthenticated) {
        // For MSAL tokens, check if still valid for at least 15 minutes
        if (authState.authMethod === 'msal') {
          try {
            const decoded = JSON.parse(atob(authState.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const now = Math.floor(Date.now() / 1000);
            const timeToExpiry = decoded.exp - now;

            if (timeToExpiry > 900) { // Valid for at least 15 more minutes
              return; // Skip update completely
            }
          } catch (e) {
            // If we can't decode, fall through to normal flow
          }
        }

        // For legacy tokens, check if still valid for at least 15 minutes
        if (authState.authMethod === 'legacy' && isValidLegacyToken(authState.token)) {
          try {
            const decoded = JSON.parse(atob(authState.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const now = Math.floor(Date.now() / 1000);
            const timeToExpiry = decoded.exp - now;

            if (timeToExpiry > 900) { // Valid for at least 15 more minutes
              return; // Skip update completely
            }
          } catch (e) {
            // If we can't decode, fall through
          }
        }
      }

      // Skip update if we already have a valid token for the current auth method
      // This prevents unnecessary token refreshes when components mount/unmount
      if (authState.token && authState.isAuthenticated) {
        if (authState.authMethod === 'msal' && isMsalAuthenticated) {
          // Double-check MSAL token is still valid by trying to decode it
          try {
            const decoded = JSON.parse(atob(authState.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const now = Math.floor(Date.now() / 1000);
            const timeToExpiry = decoded.exp - now;
        debugLog('[useEnhancedUnifiedAuth] MSAL token validation:', {
              exp: decoded.exp,
              now,
              timeToExpiry,
              validFor5Minutes: timeToExpiry > 300
            });

            if (timeToExpiry > 300) { // Valid for at least 5 more minutes
              debugLog('[useEnhancedUnifiedAuth] ✅ Skipping MSAL token refresh - token still valid for 5+ minutes');
              initialMsalAuthRef.current = isMsalAuthenticated;
              return;
            } else {
              debugWarn('[useEnhancedUnifiedAuth] ⚠️ MSAL token expires soon, allowing refresh');
            }
          } catch (e) {
            debugWarn('[useEnhancedUnifiedAuth] Failed to validate existing MSAL token:', e);
          }
        }
        if (authState.authMethod === 'legacy' && !isMsalAuthenticated) {
          // Double-check legacy token is still valid
          if (isValidLegacyToken(authState.token)) {
            debugLog('[useEnhancedUnifiedAuth] ✅ Skipping legacy token refresh - still valid');
            initialMsalAuthRef.current = isMsalAuthenticated;
            return;
          } else {
            debugWarn('[useEnhancedUnifiedAuth] ⚠️ Legacy token invalid, allowing refresh');
          }
        }
      }

  // Removed noisy auth state update debug log

      try {
        setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

        let token: string | null = null;
        let authMethod: 'msal' | 'legacy' | null = null;
        let isAuthenticated = false;

        // Check MSAL authentication first
        if (isMsalAuthenticated) {
          try {
            token = await authManagerRef.current.getToken();
            if (token) {
              authMethod = 'msal';
              isAuthenticated = true;
            }
          } catch (error) {
            debugWarn('[useEnhancedUnifiedAuth] ❌ MSAL token acquisition failed:', error);
          }
        }

        // Fallback to legacy authentication
        if (!isAuthenticated) {
          const legacyToken = await authManagerRef.current.getLegacyToken();
          if (legacyToken && isValidLegacyToken(legacyToken)) {
            token = legacyToken;
            authMethod = 'legacy';
            isAuthenticated = true;
          }
        }

  // Removed token length debug log (cleanup)

        setAuthState({
          isAuthenticated,
          isLoading: false,
          token,
          error: null,
          authMethod
        });

        // Update the ref to track this auth state
        initialMsalAuthRef.current = isMsalAuthenticated;

        // Dispatch auth change event for other components
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('enhanced-auth-changed', {
            detail: { isAuthenticated, authMethod, token }
          }));

          // Track authentication success in monitor
          if (isAuthenticated && authMethod) {
            authMonitor.recordLogin(true);
          }
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Authentication check failed';
  debugError('[useEnhancedUnifiedAuth] Auth state update failed:', error);
        setAuthState({
          isAuthenticated: false,
          isLoading: false,
          token: null,
          error: errorMessage,
          authMethod: null
        });
        initialMsalAuthRef.current = isMsalAuthenticated;
      }
    };

    // Call debounced function instead of direct call
    debouncedUpdateAuthState();

    // Cleanup timeout on unmount
    return () => {
      clearTimeout(timeoutId);
    };
  }, [isMsalAuthenticated, msalInstance]); // CRITICAL FIX: Remove authState dependencies to prevent infinite loops

  // Listen for legacy token changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleAuthChanged = () => {
      // Re-check auth state when legacy auth changes
      const legacyToken = window.localStorage.getItem("token");
      if (legacyToken && isValidLegacyToken(legacyToken)) {
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: true,
          token: legacyToken,
          authMethod: 'legacy'
        }));
      } else if (!isMsalAuthenticated) {
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: false,
          token: null,
          authMethod: null
        }));
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "token") {
        handleAuthChanged();
      }
    };

    window.addEventListener("auth-changed", handleAuthChanged);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("auth-changed", handleAuthChanged);
      window.removeEventListener("storage", handleStorage);
    };
  }, []); // CRITICAL FIX: Remove dependencies to prevent event listener re-registration loops

  // Get authentication metrics
  const getMetrics = useCallback((): AuthMetrics | null => {
    return authManagerRef.current?.getMetrics() || null;
  }, []);

  // Clear authentication cache
  const clearCache = useCallback(() => {
    authManagerRef.current?.clearCache();
  }, []);

  // Reset metrics
  const resetMetrics = useCallback(() => {
    authManagerRef.current?.resetMetrics();
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    try {
      // Set a global flag to prevent components from calling /auth/me during logout
      if (typeof window !== 'undefined') {
        (window as any).__sbLogoutInProgress = true;
        window.dispatchEvent(new CustomEvent('sb-logout-started'));
      }
      // Track logout in monitor
      authMonitor.recordLogout();

      // Attempt to notify backend to record LOGOUT before clearing tokens
      try {
        // Build a robust backend base URL with fallbacks
        const isAbsolute = (u: string | undefined) => !!u && /^https?:\/\//i.test(u);
        const candidate1 = env.VITE_API_URL;
        const candidate2 = isAbsolute(env.VITE_BASE_URL) ? env.VITE_BASE_URL : undefined;
  // Avoid hard-coding environment-specific defaults; keep empty if not configured
  const fallbackDev = '';
        const backendBase = (candidate1 && candidate1.trim()) || (candidate2 && candidate2.trim()) || fallbackDev;
        const backendUrl = backendBase.replace(/\/$/, "");

        if (backendUrl && isAbsolute(backendUrl)) {
          // Try to get an access token; fall back to legacy token if present
          let token: string | null = null;
          try {
            token = await getToken();
          } catch {}

          if (!token && typeof window !== 'undefined') {
            token = window.localStorage.getItem('token');
          }

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;

          // Fire-and-forget POST to backend logout; then try GET as a fallback
          try {
            await fetch(`${backendUrl}/auth/logout`, {
              method: 'POST',
              headers
            });
          } catch {
            // Fallback to GET if POST fails (CORS/method issues)
            await fetch(`${backendUrl}/auth/logout`, {
              method: 'GET',
              headers
            }).catch(() => {});
          }
        }
      } catch {
        // Swallow backend logout errors; continue with client-side cleanup
      }

      // Clear auth manager cache
      authManagerRef.current?.clearCache();

      // Only clear MSAL tokens from storage, do not force Microsoft account logout
      // (If you want to force full account logout, uncomment the next line)
      // if (isMsalAuthenticated) {
      //   await msalInstance.logoutPopup();
      // }
      // Remove MSAL tokens from storage
      if (typeof window !== 'undefined') {
        Object.keys(window.sessionStorage).forEach((key) => {
          if (key.startsWith('msal.')) window.sessionStorage.removeItem(key);
        });
        Object.keys(window.localStorage).forEach((key) => {
          if (key.startsWith('msal.')) window.localStorage.removeItem(key);
        });
  }

      // Clear legacy token
      if (typeof window !== 'undefined') {
  // Clear the once-per-session login audit flag so next login can emit LOGIN again
  try { sessionStorage.removeItem('sb_login_audit_done'); } catch {}
        window.localStorage.removeItem('token');
        window.dispatchEvent(new CustomEvent('auth-changed'));
      }

      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        token: null,
        error: null,
        authMethod: null
      });

      // Force navigation to login page after logout
      if (typeof window !== 'undefined') {
  // Removed logout redirect debug log
        setTimeout(() => {
          window.location.href = '/login';
        }, 100);
      }

    } catch (error) {
  debugError('[useEnhancedUnifiedAuth] Logout failed:', error);
      authMonitor.recordError(error instanceof Error ? error.message : 'Logout failed');
      setAuthState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Logout failed'
      }));
    }
  }, [isMsalAuthenticated, msalInstance, getToken]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      authManagerRef.current?.cleanup();
    };
  }, []);

  return {
    // Auth state
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading,
    token: authState.token,
    error: authState.error,
    authMethod: authState.authMethod,

    // Functions
    getToken,
    logout,

    // Monitoring
    getMetrics,
    clearCache,
    resetMetrics,

    // Legacy compatibility
    pending: authState.isLoading,
    authenticated: authState.isAuthenticated
  };
}

/**
 * Hook for getting authentication metrics for monitoring dashboards
 * Temporarily disabled due to PublicClientApplication import issues
 */
export function useAuthMetrics() {
  const [metrics] = useState<AuthMetrics | null>(null);

  /* Disabled temporarily
  useEffect(() => {
    // Create a simple auth manager instance just for metrics
    const msalInstance = new PublicClientApplication({
      auth: {
        clientId: 'temp', // Won't be used for metrics
        authority: 'temp'
      }
    });

    const authManager = new EnhancedAuthManager(msalInstance, {
      enablePerformanceLogging: false
    });

    const interval = setInterval(() => {
      const currentMetrics = authManager.getMetrics();
      setMetrics(currentMetrics);
    }, 5000); // Update every 5 seconds

    return () => {
      clearInterval(interval);
      authManager.cleanup();
    };
  }, []);

  */
  return metrics;
}

/**
 * Simple function to check if user is authenticated (for server-side rendering)
 */
export function isUserAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;

  // Check legacy token
  const legacyToken = window.localStorage.getItem('token');
  if (legacyToken) {
    try {
      const [, payloadBase64] = legacyToken.split(".");
      if (!payloadBase64) return false;
      const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload.exp) return false;
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    } catch {
      return false;
    }
  }

  return false;
}
