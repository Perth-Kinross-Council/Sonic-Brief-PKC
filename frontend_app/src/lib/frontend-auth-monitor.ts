/**
 * Frontend Authentication Performance Monitor for Phase 3
 * Provides performance tracking and integration with backend monitoring endpoints
 */

import { debugLog } from './debug';

interface FrontendAuthMetrics {
  // Token operations
  tokenAcquisitionTime: number[];
  tokenRefreshCount: number;
  cacheHitRate: number;

  // User interactions
  loginAttempts: number;
  logoutCount: number;

  // Error tracking
  authErrors: string[];
  networkErrors: string[];

  // Performance metrics
  averageResponseTime: number;
  peakResponseTime: number;

  // Session info
  sessionStartTime: number;
  lastActivity: number;
}

class FrontendAuthPerformanceMonitor {
  private metrics: FrontendAuthMetrics;
  private config: {
    maxMetricsHistory: number;
    reportingInterval: number;
    enableBackendReporting: boolean;
    backendEndpoint: string;
  };

  constructor(config?: Partial<typeof this.config>) {
    this.config = {
      maxMetricsHistory: 100,
      reportingInterval: 60000, // 1 minute
      enableBackendReporting: false, // Disabled - endpoint not available
      backendEndpoint: '/auth/frontend/metrics', // Updated endpoint
      ...config
    };

    this.metrics = {
      tokenAcquisitionTime: [],
      tokenRefreshCount: 0,
      cacheHitRate: 0,
      loginAttempts: 0,
      logoutCount: 0,
      authErrors: [],
      networkErrors: [],
      averageResponseTime: 0,
      peakResponseTime: 0,
      sessionStartTime: Date.now(),
      lastActivity: Date.now()
    };

    // Start periodic reporting if enabled
    if (this.config.enableBackendReporting) {
      this.startPeriodicReporting();
    }
  }

  /**
   * Record token acquisition performance
   */
  recordTokenAcquisition(duration: number, _fromCache: boolean = false) {
    this.metrics.tokenAcquisitionTime.push(duration);

    // Keep only recent measurements
    if (this.metrics.tokenAcquisitionTime.length > this.config.maxMetricsHistory) {
      this.metrics.tokenAcquisitionTime.shift();
    }

    // Update average response time
    const times = this.metrics.tokenAcquisitionTime;
    this.metrics.averageResponseTime = times.reduce((a, b) => a + b, 0) / times.length;

    // Update peak response time
    this.metrics.peakResponseTime = Math.max(this.metrics.peakResponseTime, duration);

    // Update last activity
    this.metrics.lastActivity = Date.now();

  // (Verbose token timing logs removed for cleanliness; enable via debug helper if reintroduced)
  }

  /**
   * Record token refresh
   */
  recordTokenRefresh() {
    this.metrics.tokenRefreshCount++;
    this.metrics.lastActivity = Date.now();
  // (Verbose refresh log removed)
  }

  /**
   * Update cache hit rate
   */
  updateCacheHitRate(hitRate: number) {
    this.metrics.cacheHitRate = hitRate;
  }

  /**
   * Record login attempt
   */
  recordLoginAttempt(success: boolean = true) {
    this.metrics.loginAttempts++;
    this.metrics.lastActivity = Date.now();

    if (success) {
      // (Verbose login success log removed)
    } else {
      this.recordAuthError('Login failed');
    }
  }

  /**
   * Record logout
   */
  recordLogout() {
    this.metrics.logoutCount++;
  // (Verbose logout log removed)
  }

  /**
   * Record authentication error
   */
  recordAuthError(error: string) {
    this.metrics.authErrors.push(`${new Date().toISOString()}: ${error}`);

    // Keep only recent errors
    if (this.metrics.authErrors.length > this.config.maxMetricsHistory) {
      this.metrics.authErrors.shift();
    }

  // (Verbose auth error log removed)
  }

  /**
   * Record network error
   */
  recordNetworkError(error: string) {
    this.metrics.networkErrors.push(`${new Date().toISOString()}: ${error}`);

    // Keep only recent errors
    if (this.metrics.networkErrors.length > this.config.maxMetricsHistory) {
      this.metrics.networkErrors.shift();
    }

  // (Verbose network error log removed)
  }

  /**
   * Get current metrics summary
   */
  getMetrics(): FrontendAuthMetrics & {
    sessionDuration: number;
    errorRate: number;
    totalErrors: number;
  } {
    const now = Date.now();
    const sessionDuration = now - this.metrics.sessionStartTime;
    const totalErrors = this.metrics.authErrors.length + this.metrics.networkErrors.length;
    const totalOperations = this.metrics.loginAttempts + this.metrics.tokenRefreshCount;
    const errorRate = totalOperations > 0 ? (totalErrors / totalOperations) * 100 : 0;

    return {
      ...this.metrics,
      sessionDuration,
      errorRate,
      totalErrors
    };
  }

  /**
   * Get performance summary for dashboards
   */
  getPerformanceSummary() {
    const metrics = this.getMetrics();

    return {
      performance: {
        averageTokenTime: metrics.averageResponseTime,
        peakTokenTime: metrics.peakResponseTime,
        cacheHitRate: metrics.cacheHitRate,
        sessionDuration: metrics.sessionDuration
      },
      activity: {
        totalLogins: metrics.loginAttempts,
        totalLogouts: metrics.logoutCount,
        tokenRefreshes: metrics.tokenRefreshCount,
        lastActivity: metrics.lastActivity
      },
      errors: {
        totalErrors: metrics.totalErrors,
        errorRate: metrics.errorRate,
        authErrors: metrics.authErrors.length,
        networkErrors: metrics.networkErrors.length
      },
      status: this.getHealthStatus()
    };
  }

  /**
   * Get health status based on current metrics
   */
  private getHealthStatus(): 'excellent' | 'good' | 'warning' | 'critical' {
    const metrics = this.getMetrics();

    // Critical conditions
    if (metrics.errorRate > 20 || metrics.averageResponseTime > 2000) {
      return 'critical';
    }

    // Warning conditions
    if (metrics.errorRate > 10 || metrics.averageResponseTime > 1000 || metrics.cacheHitRate < 50) {
      return 'warning';
    }

    // Good conditions
    if (metrics.errorRate < 5 && metrics.averageResponseTime < 500 && metrics.cacheHitRate > 70) {
      return 'excellent';
    }

    return 'good';
  }

  /**
   * Send metrics to backend endpoint
   */
  private async sendMetricsToBackend() {
    if (!this.config.enableBackendReporting) return;

    try {
      const metrics = this.getMetrics();

      const response = await fetch(this.config.backendEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionId: `session_${this.metrics.sessionStartTime}`,
          userAgent: navigator.userAgent,
          pageUrl: window.location.href,
          metrics: {
            authPerformance: {
              averageResponseTime: metrics.averageResponseTime,
              peakResponseTime: metrics.peakResponseTime,
              tokenRefreshCount: metrics.tokenRefreshCount,
              cacheHitRate: metrics.cacheHitRate
            },
            tokenManagement: {
              acquisitionTimes: metrics.tokenAcquisitionTime,
              totalRefreshes: metrics.tokenRefreshCount,
              cacheEfficiency: metrics.cacheHitRate
            },
            errorTracking: {
              totalErrors: metrics.totalErrors,
              errorRate: metrics.errorRate,
              authErrors: metrics.authErrors.length,
              networkErrors: metrics.networkErrors.length,
              recentErrors: metrics.authErrors.slice(-5) // Last 5 errors
            },
            networkPerformance: {
              averageLatency: metrics.averageResponseTime,
              peakLatency: metrics.peakResponseTime,
              requestsTotal: metrics.loginAttempts + metrics.logoutCount
            },
            userActivity: {
              loginAttempts: metrics.loginAttempts,
              logoutCount: metrics.logoutCount,
              sessionDuration: Date.now() - metrics.sessionStartTime,
              lastActivity: metrics.lastActivity
            }
          }
        })
      });

      if (!response.ok) {
        // Handle specific HTTP status codes gracefully
        if (response.status === 405) {
          debugLog('[AuthMonitor] Backend metrics endpoint does not support POST method - disabling backend reporting');
          this.config.enableBackendReporting = false; // Auto-disable on 405 error
          return;
        } else if (response.status === 404) {
          debugLog('[AuthMonitor] Backend metrics endpoint not found - disabling backend reporting');
          this.config.enableBackendReporting = false; // Auto-disable on 404 error
          return;
        } else {
          // (Backend metrics failure warning removed to avoid noise; debugLog handles notable cases)
        }
      } else {
  debugLog('[AuthMonitor] Metrics sent to backend successfully');
      }
    } catch (error) {
      // Handle network errors gracefully
      if (error instanceof TypeError && error.message.includes('fetch')) {
  debugLog('[AuthMonitor] Network error sending metrics to backend - disabling backend reporting');
        this.config.enableBackendReporting = false; // Auto-disable on network errors
      } else {
        // (Backend metrics send error suppressed for cleanliness)
      }
    }
  }

  /**
   * Start periodic reporting to backend
   */
  private startPeriodicReporting() {
    const intervalId = setInterval(() => {
      // Check if backend reporting is still enabled before sending
      if (this.config.enableBackendReporting) {
        this.sendMetricsToBackend();
      } else {
        // If disabled, clear the interval to stop periodic reporting
        clearInterval(intervalId);
  debugLog('[AuthMonitor] Backend reporting disabled, stopping periodic reporting');
      }
    }, this.config.reportingInterval);

  debugLog('[AuthMonitor] Periodic reporting started (if enabled)');
  }

  /**
   * Reset all metrics (for testing or new session)
   */
  reset() {
    this.metrics = {
      tokenAcquisitionTime: [],
      tokenRefreshCount: 0,
      cacheHitRate: 0,
      loginAttempts: 0,
      logoutCount: 0,
      authErrors: [],
      networkErrors: [],
      averageResponseTime: 0,
      peakResponseTime: 0,
      sessionStartTime: Date.now(),
      lastActivity: Date.now()
    };

  // (Verbose metrics reset log removed)
  }

  /**
   * Export metrics for debugging
   */
  exportMetrics(): string {
    return JSON.stringify(this.getMetrics(), null, 2);
  }
}

// Global instance for easy access
let globalAuthMonitor: FrontendAuthPerformanceMonitor | null = null;

/**
 * Get or create global auth monitor instance
 */
export const getAuthMonitor = (config?: any): FrontendAuthPerformanceMonitor => {
  if (!globalAuthMonitor) {
    // Ensure backend reporting is disabled by default to prevent 405 errors
    const defaultConfig = {
      enableBackendReporting: false, // Disabled until backend endpoint is available
      ...config
    };
    globalAuthMonitor = new FrontendAuthPerformanceMonitor(defaultConfig);
  }
  return globalAuthMonitor;
};

/**
 * Simple functions for common monitoring tasks
 */
export const authMonitor = {
  recordTokenAcquisition: (duration: number, fromCache?: boolean) =>
    getAuthMonitor().recordTokenAcquisition(duration, fromCache),

  recordTokenRefresh: () =>
    getAuthMonitor().recordTokenRefresh(),

  recordLogin: (success?: boolean) =>
    getAuthMonitor().recordLoginAttempt(success),

  recordLogout: () =>
    getAuthMonitor().recordLogout(),

  recordError: (error: string) =>
    getAuthMonitor().recordAuthError(error),

  updateCacheHitRate: (hitRate: number) =>
    getAuthMonitor().updateCacheHitRate(hitRate),

  getMetrics: () =>
    getAuthMonitor().getMetrics(),

  getPerformanceSummary: () =>
    getAuthMonitor().getPerformanceSummary(),

  reset: () =>
    getAuthMonitor().reset()
};

export default FrontendAuthPerformanceMonitor;
