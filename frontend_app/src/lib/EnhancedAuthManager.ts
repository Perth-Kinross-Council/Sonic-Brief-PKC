import type { IPublicClientApplication, AccountInfo, SilentRequest } from '@azure/msal-browser';
import { authMonitor } from './frontend-auth-monitor';
import { debugLog, debugWarn } from './debug';

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
  private recentTokenRequests: number[] = []; // Track request frequency to detect debug panel usage
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

  // Performance logging initialization message removed (noise cleanup)
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
   * Track token request frequency to detect debug panel usage
   */
  private getTokenRequestFrequency(): number {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean old requests
    this.recentTokenRequests = this.recentTokenRequests.filter(time => time > oneMinuteAgo);

    // Add current request
    this.recentTokenRequests.push(now);

    return this.recentTokenRequests.length;
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
  // Removed expired token debug log (cleanup)
      return null;
    }

    // Check if token is expiring soon and trigger background refresh
    if (this.isTokenExpiringSoon(cached.token, 10)) {
      this.backgroundRefreshToken(cacheKey).catch(() => {
        // Silent failure for background refresh - prevents console noise
      });
    }

    this.metrics.cacheHits++;
    // Update frontend monitor with current cache performance
    const totalRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
    const hitRate = totalRequests > 0 ? (this.metrics.cacheHits / totalRequests) * 100 : 0;
    authMonitor.updateCacheHitRate(hitRate);
  // Cache hit debug log removed (cleanup)
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
          // Eviction debug log removed (cleanup)
        }
      }

      const existingCache = this.tokenCache.get(cacheKey);
      this.tokenCache.set(cacheKey, {
        token,
        expiresAt,
        type,
        refreshCount: existingCache ? existingCache.refreshCount + 1 : 1
      });

  // Token cached debug details removed (cleanup)
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

        // Report to frontend monitor
        authMonitor.recordTokenAcquisition(refreshTime, false);
        authMonitor.recordTokenRefresh();

        // Update average refresh time across all refresh types
        const totalRefreshes = this.metrics.tokenRefreshCount + this.metrics.backgroundRefreshes + this.metrics.preemptiveRefreshes;
        if (totalRefreshes > 0) {
          this.metrics.averageRefreshTime = this.metrics.totalRefreshTime / totalRefreshes;
        }

  // Background refresh success debug removed (cleanup)
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

  // Background monitoring start log removed (cleanup)
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

  // Expired token cleanup log removed (cleanup)
  }

  /**
   * Preemptively refresh tokens that are expiring soon
   */
  private preemptivelyRefreshTokens(): void {
    this.tokenCache.forEach((cached, key) => {
      if (this.isTokenExpiringSoon(cached.token, this.config.preemptiveRefreshBuffer) &&
          cached.type === 'msal') {
        this.preemptiveRefreshToken(key).catch(() => {
          // Silent failure for preemptive refresh - prevents console noise
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

  // Preemptive refresh debug removed (cleanup)
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

  // getToken call verbose debug removed (cleanup)

      // Check internal cache first
      const cachedToken = await this.getTokenFromCache(cacheKey);
      if (cachedToken) {
        if (!this.isTokenExpiringSoon(cachedToken, 5)) {
          // Served from internal cache (>5min) debug removed
          return cachedToken;
        } else {
          if (!this.isTokenExpiringSoon(cachedToken, 2)) {
            // Served from internal cache (>2min) debug removed
            return cachedToken;
          } else {
            this.tokenCache.delete(cacheKey);
            // Removed expiring token debug
          }
        }
      }

      // Check if we made a token request very recently
      const lastRequestTime = this.lastTokenRequestTime || 0;
      const timeSinceLastRequest = Date.now() - lastRequestTime;

      if (timeSinceLastRequest < 30000) {
        if (this.config.enablePerformanceLogging) {
          // Removed aggressive cache strategy debug (cleanup)
        }

        if (accounts[0]) {
          try {
            const silentRequest = {
              scopes: this.config.scopes,
              account: accounts[0],
              forceRefresh: false,
              cacheLookupPolicy: 1
            };

            const quickResponse = await this.msalInstance.acquireTokenSilent(silentRequest as any);
            if (quickResponse.accessToken) {
              this.setTokenCache(cacheKey, quickResponse.accessToken, 'msal');
              if (this.config.enablePerformanceLogging) {
                // Removed aggressive strategy success debug
              }
              return quickResponse.accessToken;
            }
          } catch (e) {
            if (this.config.enablePerformanceLogging) {
              // Removed aggressive strategy failure debug
            }
          }
        }
      }

      this.lastTokenRequestTime = Date.now();

  // Internal cache miss debug removed

      // Check MSAL's token cache directly
      if (accounts[0]) {
        try {
          const silentRequest: SilentRequest = {
            scopes: this.config.scopes,
            account: accounts[0],
            forceRefresh: false
          };

          // Attempting MSAL silent acquisition debug removed

          // Track frequency of token requests to detect debug panel usage
          const now = Date.now();
          const requestFrequency = this.getTokenRequestFrequency();

          // If requests are very frequent (>2 per minute), be extremely conservative about refreshes
          if (requestFrequency > 2) {
            silentRequest.forceRefresh = false;
            // High request frequency warning removed
          }

          const responseBefore = performance.now();
          const response = await this.msalInstance.acquireTokenSilent(silentRequest);
          const responseTime = performance.now() - responseBefore;

          if (response.accessToken) {
            const decoded = jwtDecode(response.accessToken);
            const tokenIssuedAt = decoded.iat * 1000;
            const tokenAge = now - tokenIssuedAt;

            // Be more aggressive about considering tokens as "from cache" to reduce warnings
            const isVeryFresh = tokenAge < 5000; // Reduced from 10000
            const isFastResponse = responseTime < 100; // Increased from 50
            const isReasonableAge = tokenAge >= 5000 && tokenAge < 1800000;

            const likelyFromCache = !isVeryFresh && (isFastResponse || (isReasonableAge && responseTime < 300));

            // Detailed token analysis debug removed

            if (likelyFromCache) {
              // Report cached token acquisition to frontend monitor
              authMonitor.recordTokenAcquisition(responseTime, true);
            } else {
              // Fresh token network warnings removed
              this.metrics.tokenRefreshCount++;

              const endTime = performance.now();
              const refreshTime = endTime - startTime;
              this.metrics.totalRefreshTime += refreshTime;
              this.metrics.averageRefreshTime = this.metrics.totalRefreshTime / this.metrics.tokenRefreshCount;

              // Report to frontend monitor
              authMonitor.recordTokenAcquisition(refreshTime, false);
              authMonitor.recordTokenRefresh();
            }

            this.setTokenCache(cacheKey, response.accessToken, 'msal');
            return response.accessToken;
          }
        } catch (msalCacheError) {
          // MSAL silent request failure debug removed
          this.metrics.errorCount++;
          // Report error to frontend monitor
          authMonitor.recordError(msalCacheError instanceof Error ? msalCacheError.message : 'MSAL silent request failed');
        }
      }

  // Complete cache miss warning removed

      // Prevent multiple concurrent refresh attempts
      const refreshKey = accounts[0]?.homeAccountId || 'anonymous';
  if (this.refreshPromises.has(refreshKey)) {
        return await this.refreshPromises.get(refreshKey)!;
      }

      const refreshPromise = this.refreshToken(accounts[0], cacheKey);
      this.refreshPromises.set(refreshKey, refreshPromise);

      try {
        const token = await refreshPromise;

        const endTime = performance.now();
        const refreshTime = endTime - startTime;

        this.metrics.tokenRefreshCount++;
        this.metrics.totalRefreshTime += refreshTime;
        this.metrics.averageRefreshTime = this.metrics.totalRefreshTime / this.metrics.tokenRefreshCount;

        // Report to frontend monitor
        authMonitor.recordTokenAcquisition(refreshTime, false);
        authMonitor.recordTokenRefresh();

  // Token acquisition completion debug removed

        return token;
      } finally {
        this.refreshPromises.delete(refreshKey);
      }
    } catch (error) {
      console.error('[EnhancedAuthManager] ❌ Token acquisition failed:', error);
      this.metrics.errorCount++;
      // Report error to frontend monitor
      authMonitor.recordError(error instanceof Error ? error.message : 'Token acquisition failed');
      throw error;
    }
  }

  /**
   * Refresh token logic with MSAL cache check and fallback to interactive auth
   */
  private async refreshToken(account?: AccountInfo, cacheKey?: string): Promise<string> {
    if (!account) {
      throw new Error('No authenticated account found');
    }

    try {
      const silentRequest: SilentRequest = {
        scopes: this.config.scopes,
        account: account,
        forceRefresh: false
      };

      if (this.config.enablePerformanceLogging) {
  debugLog('[EnhancedAuthManager] Attempting silent token acquisition with MSAL cache check');
      }

      const response = await this.msalInstance.acquireTokenSilent(silentRequest);

      if (response.accessToken) {
        if (this.config.enablePerformanceLogging) {
          const tokenPayload = this.parseTokenPayload(response.accessToken);
          debugLog('[EnhancedAuthManager] MSAL token acquired successfully:', {
            fromCache: response.fromCache,
            iat: tokenPayload?.iat ? new Date(tokenPayload.iat * 1000).toISOString() : 'N/A',
            exp: tokenPayload?.exp ? new Date(tokenPayload.exp * 1000).toISOString() : 'N/A',
            scopes: response.scopes || []
          });
        }

        if (cacheKey) {
          this.setTokenCache(cacheKey, response.accessToken, 'msal');
        }

        return response.accessToken;
      } else {
        throw new Error('No access token in MSAL response');
      }
    } catch (silentError) {
  debugWarn('[EnhancedAuthManager] Silent token acquisition failed, trying interactive:', silentError);
      this.metrics.errorCount++;

      try {
        const interactiveResponse = await this.msalInstance.acquireTokenPopup({
          scopes: this.config.scopes,
          account: account
        });

        if (interactiveResponse.accessToken && cacheKey) {
          this.setTokenCache(cacheKey, interactiveResponse.accessToken, 'msal');
        }

        return interactiveResponse.accessToken;
      } catch (interactiveError) {
  console.error('[EnhancedAuthManager] Interactive token acquisition failed:', interactiveError);
        this.metrics.errorCount++;
        throw interactiveError;
      }
    }
  }

  /**
   * Helper method to safely parse token payload for debugging
   */
  private parseTokenPayload(token: string): any {
    try {
      const [, payloadBase64] = token.split('.');
      if (!payloadBase64) return null;
      const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
      return payload;
    } catch (error) {
  debugWarn('[EnhancedAuthManager] Failed to parse token payload:', error);
      return null;
    }
  }

  /**
   * Handle legacy token for backward compatibility with proper caching
   */
  async getLegacyToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null;

    const cacheKey = 'legacy_token';

    // Check cache first
    const cachedToken = await this.getTokenFromCache(cacheKey);
    if (cachedToken) {
      if (this.config.enablePerformanceLogging) {
  debugLog('[EnhancedAuthManager] Legacy token served from cache');
      }
      this.metrics.cacheHits++;
      // Report to frontend monitor
      authMonitor.recordTokenAcquisition(0, true); // Legacy tokens are always cached
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
        this.tokenCache.delete(cacheKey);
        this.metrics.cacheMisses++;
        return null;
      }

      // Cache legacy token for future requests
      this.setTokenCache(cacheKey, token, 'legacy');
      this.metrics.cacheMisses++;

      if (this.config.enablePerformanceLogging) {
  debugLog('[EnhancedAuthManager] Legacy token cached from localStorage');
      }

      return token;
    } catch (error) {
  console.error('[EnhancedAuthManager] Invalid legacy token:', error);
      window.localStorage.removeItem('token');
      this.tokenCache.delete(cacheKey);
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

    if (this.config.enablePerformanceLogging) {
  debugLog('[EnhancedAuthManager] Current metrics:', {
        tokenRefreshCount: metrics.tokenRefreshCount,
        cacheHits: metrics.cacheHits,
        cacheMisses: metrics.cacheMisses,
        backgroundRefreshes: metrics.backgroundRefreshes,
        preemptiveRefreshes: metrics.preemptiveRefreshes,
        errorCount: metrics.errorCount,
        cacheSize: metrics.cacheSize,
        hitRate: `${metrics.hitRate}%`,
        averageRefreshTime: `${metrics.averageRefreshTime.toFixed(2)}ms`,
        totalRefreshTime: `${metrics.totalRefreshTime.toFixed(2)}ms`
      });
    }

    return metrics;
  }

  /**
   * Clear all cached tokens (logout scenario)
   */
  clearCache(): void {
    this.tokenCache.clear();
  // Cache cleared debug removed
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

  // Metrics reset debug removed
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

  // Cleanup completed debug removed
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
