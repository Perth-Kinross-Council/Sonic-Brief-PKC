import type { IPublicClientApplication, AccountInfo, SilentRequest } from '@azure/msal-browser';

// Simple JWT decode function to avoid dependency issues
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
    throw new Error('Invalid token format');
  }
}

interface TokenCache {
  token: string;
  expiresAt: number;
  type: 'msal' | 'legacy';
  refreshCount: number;
}

interface AuthMetrics {
  tokenRefreshCount: number;
  cacheHits: number;
  cacheMisses: number;
  errorCount: number;
  averageRefreshTime: number;
  backgroundRefreshes: number;
  preemptiveRefreshes: number;
  totalRefreshTime: number;
}

interface AuthConfig {
  scopes: string[];
  preemptiveRefreshBuffer: number; // minutes before expiry to refresh
  backgroundRefreshInterval: number; // milliseconds
  maxCacheSize: number;
  enablePerformanceLogging: boolean;
}

/**
 * Enhanced Authentication Manager for Phase 3 Frontend Optimization
 * Provides intelligent token caching, background refresh, and comprehensive monitoring
 */
export class EnhancedAuthManager {
  private msalInstance: IPublicClientApplication;
  private tokenCache: Map<string, TokenCache> = new Map();
  private refreshPromises: Map<string, Promise<string>> = new Map();
  private config: AuthConfig;
  private lastTokenRequestTime: number = 0; // Track last token request for aggressive caching
  private metrics: AuthMetrics = {
    tokenRefreshCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errorCount: 0,
    averageRefreshTime: 0,
    backgroundRefreshes: 0,
    preemptiveRefreshes: 0,
    totalRefreshTime: 0
  };
  private backgroundMonitoringInterval?: number;

  constructor(msalInstance: IPublicClientApplication, config: Partial<AuthConfig> = {}) {
    this.msalInstance = msalInstance;
    this.config = {
      scopes: config.scopes || ['User.Read'], // Will be configured externally
      preemptiveRefreshBuffer: config.preemptiveRefreshBuffer || 15, // 15 minutes
      backgroundRefreshInterval: config.backgroundRefreshInterval || 600000, // 10 minutes (reduced from 2 minutes to prevent performance issues)
      maxCacheSize: config.maxCacheSize || 50,
      enablePerformanceLogging: config.enablePerformanceLogging ?? true
    };

    // Start background token monitoring
    this.startBackgroundTokenMonitoring();

    // Cleanup on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.cleanup());
    }

  // Removed commented debug logging: initialization details
  }

  /**
   * Check if token is expiring soon based on buffer time
   */
  private isTokenExpiringSoon(token: string, bufferMinutes?: number): boolean {
    try {
      const decoded: any = jwtDecode(token);
      const now = Math.floor(Date.now() / 1000);
      const buffer = bufferMinutes || this.config.preemptiveRefreshBuffer;
      const bufferSeconds = buffer * 60;

      return decoded.exp <= (now + bufferSeconds);
  } catch (error) {
      this.metrics.errorCount++;
      return true; // Assume expired if we can't decode
    }
  }

  /**
   * Generate cache key for account
   */
  private getCacheKey(account?: AccountInfo): string {
    return account ? `token_${account.homeAccountId}` : 'anonymous_token';
  }

  /**
   * Get token from cache with intelligent refresh triggering
   */
  private async getTokenFromCache(cacheKey: string): Promise<string | null> {
    const cached = this.tokenCache.get(cacheKey);

    if (!cached) {
      this.metrics.cacheMisses++;
      return null;
    }

    // Check if token is still valid
    if (Date.now() >= cached.expiresAt) {
      this.tokenCache.delete(cacheKey);
      this.metrics.cacheMisses++;
  // Removed commented debug logging: token expired
      return null;
    }

    // Check if token is expiring soon and trigger background refresh
    if (this.isTokenExpiringSoon(cached.token, 10)) {
      this.backgroundRefreshToken(cacheKey).catch(() => {
        // Removed commented debug logging: background refresh failure
      });
    }

    this.metrics.cacheHits++;
  // Removed commented debug logging: cache hit
    return cached.token;
  }

  /**
   * Cache token with expiration tracking
   */
  private setTokenCache(cacheKey: string, token: string, type: 'msal' | 'legacy'): void {
    try {
      const decoded: any = jwtDecode(token);
      const expiresAt = decoded.exp * 1000; // Convert to milliseconds

      // Enforce cache size limit (LRU eviction)
      if (this.tokenCache.size >= this.config.maxCacheSize) {
        const oldestKey = this.tokenCache.keys().next().value;
        if (oldestKey) {
          this.tokenCache.delete(oldestKey);
          // Removed commented debug logging: cache size eviction
        }
      }

      const existingCache = this.tokenCache.get(cacheKey);
      this.tokenCache.set(cacheKey, {
        token,
        expiresAt,
        type,
        refreshCount: existingCache ? existingCache.refreshCount + 1 : 1
      });

  // Removed commented debug logging: token cached successfully
  } catch (error) {
      this.metrics.errorCount++;
    }
  }

  /**
   * Background token refresh without blocking user operations
   */
  private async backgroundRefreshToken(cacheKey: string): Promise<void> {
    try {
      const accounts = this.msalInstance.getAllAccounts();
      if (accounts.length === 0) return;

      const account = accounts[0];
      const silentRequest: SilentRequest = {
        scopes: this.config.scopes,
        account: account
      };

      const startTime = performance.now();
      const response = await this.msalInstance.acquireTokenSilent(silentRequest);
      const refreshTime = performance.now() - startTime;

      if (response.accessToken) {
        this.setTokenCache(cacheKey, response.accessToken, 'msal');
        this.metrics.backgroundRefreshes++;
        this.metrics.totalRefreshTime += refreshTime;

        // Update average refresh time across all refresh types
        const totalRefreshes = this.metrics.tokenRefreshCount + this.metrics.backgroundRefreshes + this.metrics.preemptiveRefreshes;
        if (totalRefreshes > 0) {
          this.metrics.averageRefreshTime = this.metrics.totalRefreshTime / totalRefreshes;
        }

  // Removed commented debug logging: background token refresh successful
      }
  } catch (error) {
      this.metrics.errorCount++;
    }
  }

  /**
   * Start background monitoring for token expiration and cleanup
   */
  private startBackgroundTokenMonitoring(): void {
    if (typeof window === 'undefined') return;

    this.backgroundMonitoringInterval = window.setInterval(() => {
      this.cleanupExpiredTokens();
      this.preemptivelyRefreshTokens();
    }, this.config.backgroundRefreshInterval);

  // Removed commented debug logging: background monitoring started
  }

  /**
   * Clean up expired tokens from cache
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    this.tokenCache.forEach((cached, key) => {
      if (now >= cached.expiresAt) {
        expiredKeys.push(key);
      }
    });

    expiredKeys.forEach(key => this.tokenCache.delete(key));

  // Removed commented debug logging: cleaned up expired tokens
  }

  /**
   * Preemptively refresh tokens that are expiring soon
   */
  private preemptivelyRefreshTokens(): void {
    this.tokenCache.forEach((cached, key) => {
      if (this.isTokenExpiringSoon(cached.token, this.config.preemptiveRefreshBuffer) &&
          cached.type === 'msal') {
        this.preemptiveRefreshToken(key).catch(() => {
          // Removed commented debug logging: preemptive refresh failed
        });
      }
    });
  }

  /**
   * Preemptive token refresh with metrics tracking
   */
  private async preemptiveRefreshToken(cacheKey: string): Promise<void> {
    try {
      const startTime = performance.now();
      await this.backgroundRefreshToken(cacheKey);
      const refreshTime = performance.now() - startTime;

      this.metrics.preemptiveRefreshes++;
      this.metrics.totalRefreshTime += refreshTime;

      // Update average refresh time across all refresh types
      const totalRefreshes = this.metrics.tokenRefreshCount + this.metrics.backgroundRefreshes + this.metrics.preemptiveRefreshes;
      if (totalRefreshes > 0) {
        this.metrics.averageRefreshTime = this.metrics.totalRefreshTime / totalRefreshes;
      }

  // Removed commented debug logging: preemptive token refresh completed
  } catch (error) {
      this.metrics.errorCount++;
    }
  }

  /**
   * Main method to get access token with caching and refresh logic
   */
  async getToken(): Promise<string> {
    const startTime = performance.now();

    try {
      const accounts = this.msalInstance.getAllAccounts();
      const cacheKey = this.getCacheKey(accounts[0]);

  // Removed commented debug logging: getToken invoked

      // SUPER AGGRESSIVE: Try our internal cache first with VERY relaxed expiry check for debug panel usage
      const cachedToken = await this.getTokenFromCache(cacheKey);
      if (cachedToken) {
        // For debug panel usage, be MUCH more aggressive about using cached tokens
        // Double-check token isn't expiring in the next 5 minutes to be extra safe
        if (!this.isTokenExpiringSoon(cachedToken, 5)) {
          // Removed commented debug logging: served from cache >5min
          return cachedToken;
        } else {
          // Token is expiring soon, but let's still use it if expiring in >2 minutes
          // This prevents constant refreshes from the debug panel
          if (!this.isTokenExpiringSoon(cachedToken, 2)) {
            // Removed commented debug logging: served from cache >2min
            return cachedToken;
          } else {
            // Only refresh if expiring in <2 minutes
            this.tokenCache.delete(cacheKey);
            // Removed commented debug logging: token expiring removed
          }
        }
      }

      // ADDITIONAL PROTECTION: Check if we made a token request very recently (within last 30 seconds)
      // If so, try to use MSAL's cache more aggressively
      const lastRequestTime = this.lastTokenRequestTime || 0;
      const timeSinceLastRequest = Date.now() - lastRequestTime;

      if (timeSinceLastRequest < 30000) { // Less than 30 seconds ago
  // Removed commented debug logging: aggressive cache strategy

        // Try to force MSAL to use cache by using a very recent account context
        if (accounts[0]) {
          try {
            const silentRequest = {
              scopes: this.config.scopes,
              account: accounts[0],
              forceRefresh: false, // Force use of cache
              cacheLookupPolicy: 1 // Force cache lookup first
            };

            const quickResponse = await this.msalInstance.acquireTokenSilent(silentRequest as any);
            if (quickResponse.accessToken) {
              this.setTokenCache(cacheKey, quickResponse.accessToken, 'msal');
              // Removed commented debug logging: aggressive cache succeeded
              return quickResponse.accessToken;
            }
          } catch (e) {
            // Removed commented debug logging: aggressive cache failed
          }
        }
      }

      // Update last request time
      this.lastTokenRequestTime = Date.now();

      // Internal cache miss - increment counter
  // Removed commented debug logging: cache miss

      // NEW APPROACH: Check MSAL's token cache directly before making any requests
      if (accounts[0]) {
        try {
          // First, try to get a token from MSAL's cache without any network request
          // Use a very short cache lookup to minimize network calls
          const silentRequest: SilentRequest = {
            scopes: this.config.scopes,
            account: accounts[0],
            forceRefresh: false // Use MSAL's cache if available
          };

          // Removed commented debug logging: attempting MSAL silent acquisition

          // Track if this causes a network request by checking token content
          const responseBefore = performance.now();
          const response = await this.msalInstance.acquireTokenSilent(silentRequest);
          const responseTime = performance.now() - responseBefore;

          if (response.accessToken) {
            // Decode token to check its issued time
            const decoded = jwtDecode(response.accessToken);
            const tokenIssuedAt = decoded.iat * 1000; // Convert to milliseconds
            const now = Date.now();
            const tokenAge = now - tokenIssuedAt;

            // More intelligent cache detection:
            // 1. If token is very fresh (< 10 seconds old), it's likely from network
            // 2. If response was very fast (< 50ms) and token is not brand new, likely from cache
            // 3. If token age is reasonable (30s-30min) and response was fast, likely from cache
            const isVeryFresh = tokenAge < 10000; // Less than 10 seconds old
            const isFastResponse = responseTime < 50; // Very fast response
            const isReasonableAge = tokenAge >= 10000 && tokenAge < 1800000; // 10s to 30min old

            const likelyFromCache = !isVeryFresh && (isFastResponse || (isReasonableAge && responseTime < 200));

            // Removed commented debug logging: MSAL token analysis

            if (likelyFromCache) {
              // Removed commented debug logging: token from MSAL cache
            } else {
              // Removed commented debug logging: token appears fresh from network
              this.metrics.tokenRefreshCount++;

              const endTime = performance.now();
              const refreshTime = endTime - startTime;
              this.metrics.totalRefreshTime += refreshTime;
              this.metrics.averageRefreshTime = this.metrics.totalRefreshTime / this.metrics.tokenRefreshCount;
            }

            // Cache the token in our system for future use
            this.setTokenCache(cacheKey, response.accessToken, 'msal');
            return response.accessToken;
          }
        } catch (msalCacheError) {
          // Removed commented debug logging: MSAL silent request failed
          this.metrics.errorCount++;
        }
      }

  // Removed commented debug logging: complete cache miss

      // Prevent multiple concurrent refresh attempts for same account
      const refreshKey = accounts[0]?.homeAccountId || 'anonymous';
      if (this.refreshPromises.has(refreshKey)) {
  // Removed commented debug logging: using existing refresh promise
        return await this.refreshPromises.get(refreshKey)!;
      }

      // Create new refresh promise
      const refreshPromise = this.refreshToken(accounts[0], cacheKey);
      this.refreshPromises.set(refreshKey, refreshPromise);

      try {
        const token = await refreshPromise;

        // Track the refresh metrics
        const endTime = performance.now();
        const refreshTime = endTime - startTime;

        this.metrics.tokenRefreshCount++;
        this.metrics.totalRefreshTime += refreshTime;
        this.metrics.averageRefreshTime = this.metrics.totalRefreshTime / this.metrics.tokenRefreshCount;

  // Removed commented debug logging: token acquisition completed

        return token;
      } finally {
        this.refreshPromises.delete(refreshKey);
      }
  } catch (error) {
      this.metrics.errorCount++;
      throw error;
    }
  }

  /**
   * Refresh token logic with MSAL cache check and fallback to interactive auth
   * Note: This method does NOT increment tokenRefreshCount - that's handled by the caller
   */
  private async refreshToken(account?: AccountInfo, cacheKey?: string): Promise<string> {
    if (!account) {
      throw new Error('No authenticated account found');
    }

    try {
      // First, check if MSAL already has a valid cached token
      // This is more efficient than always calling acquireTokenSilent
      const silentRequest: SilentRequest = {
        scopes: this.config.scopes,
        account: account,
        forceRefresh: false // Don't force refresh - use cache if available
      };

  // Removed commented debug logging: attempting silent acquisition (refreshToken)

      const response = await this.msalInstance.acquireTokenSilent(silentRequest);

      if (response.accessToken) {
  // Removed commented debug logging: MSAL token acquired (refreshToken)

        if (cacheKey) {
          this.setTokenCache(cacheKey, response.accessToken, 'msal');
        }

        return response.accessToken;
      } else {
        throw new Error('No access token in MSAL response');
      }
  } catch (silentError) {
      this.metrics.errorCount++;

      try {
        // Fallback to interactive authentication
        const interactiveResponse = await this.msalInstance.acquireTokenPopup({
          scopes: this.config.scopes,
          account: account
        });

        if (interactiveResponse.accessToken && cacheKey) {
          this.setTokenCache(cacheKey, interactiveResponse.accessToken, 'msal');
        }

        return interactiveResponse.accessToken;
      } catch (interactiveError) {
  // Removed commented debug logging: interactive token acquisition failed
        this.metrics.errorCount++;
        throw interactiveError;
      }
    }
  }

  // Note: removed unused private token payload helper to avoid TS6133

  /**
   * Handle legacy token for backward compatibility with proper caching
   */
  async getLegacyToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null;

    const cacheKey = 'legacy_token';

    // Check cache first
    const cachedToken = await this.getTokenFromCache(cacheKey);
    if (cachedToken) {
  // Removed commented debug logging: legacy token from cache
      this.metrics.cacheHits++;
      return cachedToken;
    }

    // Cache miss - get from localStorage
    const token = window.localStorage.getItem('token');
    if (!token) {
      this.metrics.cacheMisses++;
      return null;
    }

    // Validate legacy token
    try {
      const decoded: any = jwtDecode(token);
      const now = Math.floor(Date.now() / 1000);

      if (decoded.exp <= now) {
        window.localStorage.removeItem('token');
        this.tokenCache.delete(cacheKey); // Clear cache too
        this.metrics.cacheMisses++;
        return null;
      }

      // Cache legacy token for future requests
      this.setTokenCache(cacheKey, token, 'legacy');
      this.metrics.cacheMisses++; // This was a cache miss

  // Removed commented debug logging: legacy token cached

      return token;
  } catch (error) {
      window.localStorage.removeItem('token');
      this.tokenCache.delete(cacheKey); // Clear cache too
      this.metrics.cacheMisses++;
      return null;
    }
  }

  /**
   * Get comprehensive authentication metrics
   */
  getMetrics(): AuthMetrics & { cacheSize: number; hitRate: number } {
    const totalRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
    const hitRate = totalRequests > 0 ? (this.metrics.cacheHits / totalRequests) * 100 : 0;

    const metrics = {
      ...this.metrics,
      cacheSize: this.tokenCache.size,
      hitRate: Math.round(hitRate * 100) / 100
    };

  // Removed commented debug logging: metrics snapshot

    return metrics;
  }

  /**
   * Clear all cached tokens (logout scenario)
   */
  clearCache(): void {
    this.tokenCache.clear();
  // Removed commented debug logging: cache cleared
  }

  /**
   * Reset metrics (admin operation)
   */
  resetMetrics(): void {
    this.metrics = {
      tokenRefreshCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errorCount: 0,
      averageRefreshTime: 0,
      backgroundRefreshes: 0,
      preemptiveRefreshes: 0,
      totalRefreshTime: 0
    };

  // Removed commented debug logging: metrics reset
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.backgroundMonitoringInterval) {
      clearInterval(this.backgroundMonitoringInterval);
      this.backgroundMonitoringInterval = undefined;
    }

    this.refreshPromises.clear();

  // Removed commented debug logging: cleanup completed
  }

  /**
   * Check if user is authenticated (either MSAL or legacy)
   */
  isAuthenticated(): boolean {
    const accounts = this.msalInstance.getAllAccounts();
    const hasValidMsalToken = accounts.length > 0;

    if (hasValidMsalToken) return true;

    // Check legacy token
    if (typeof window !== 'undefined') {
      const legacyToken = window.localStorage.getItem('token');
      if (legacyToken) {
        try {
          const decoded: any = jwtDecode(legacyToken);
          const now = Math.floor(Date.now() / 1000);
          return decoded.exp > now;
        } catch {
          return false;
        }
      }
    }

    return false;
  }
}
