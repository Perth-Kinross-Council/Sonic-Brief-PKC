/**
 * READ-ONLY Authentication Metrics Provider
 * 
 * This provides authentication metrics for display purposes ONLY.
 * It never triggers authentication flows or state changes.
 * Perfect for debug panels and monitoring displays.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAuthMonitor } from './frontend-auth-monitor';

interface ReadOnlyAuthMetrics {
  tokenRefreshCount: number;
  cacheHits: number;
  cacheMisses: number;
  errorCount: number;
  averageRefreshTime: number;
  backgroundRefreshes: number;
  preemptiveRefreshes: number;
  cacheSize: number;
  hitRate: number;
  authErrors?: string[];
}

/**
 * Get cached metrics from the global auth monitor without triggering any auth flows
 * This is a PURE READ operation - no side effects, no network calls
 */
export function getReadOnlyAuthMetrics(): ReadOnlyAuthMetrics | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // Get metrics from the global auth monitor (frontend-level metrics)
    const authMonitor = getAuthMonitor();
    const frontendMetrics = authMonitor.getMetrics();
    
    // Try to get enhanced metrics from the global auth manager if available
    let authManagerMetrics = null;
    if (typeof window !== 'undefined' && (window as any).sonicBriefAuthManager) {
      try {
        authManagerMetrics = (window as any).sonicBriefAuthManager.getMetrics();
      } catch (e) {
        // Auth manager not available or error getting metrics
      }
    }
    
    // Combine metrics from both sources
    return {
      tokenRefreshCount: authManagerMetrics?.tokenRefreshCount || frontendMetrics.tokenRefreshCount,
      cacheHits: authManagerMetrics?.cacheHits || 0,
      cacheMisses: authManagerMetrics?.cacheMisses || 0,
      errorCount: frontendMetrics.authErrors.length + frontendMetrics.networkErrors.length,
      averageRefreshTime: authManagerMetrics?.averageRefreshTime || frontendMetrics.averageResponseTime,
      backgroundRefreshes: authManagerMetrics?.backgroundRefreshes || 0,
      preemptiveRefreshes: authManagerMetrics?.preemptiveRefreshes || 0,
      cacheSize: authManagerMetrics?.cacheSize || 0,
      hitRate: authManagerMetrics?.hitRate || frontendMetrics.cacheHitRate,
      authErrors: frontendMetrics.authErrors
    };
  } catch (e) {
    // Error reading metrics, return default values
    return {
      tokenRefreshCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errorCount: 0,
      averageRefreshTime: 0,
      backgroundRefreshes: 0,
      preemptiveRefreshes: 0,
      cacheSize: 0,
      hitRate: 0,
      authErrors: []
    };
  }
}

/**
 * React hook for read-only auth metrics
 * Updates metrics from localStorage without triggering auth flows
 */
export function useReadOnlyAuthMetrics(refreshInterval: number = 5000): ReadOnlyAuthMetrics | null {
  const [metrics, setMetrics] = useState<ReadOnlyAuthMetrics | null>(null);

  const updateMetrics = useCallback(() => {
    const currentMetrics = getReadOnlyAuthMetrics();
    setMetrics(currentMetrics);
  }, []);

  useEffect(() => {
    // Initial update
    updateMetrics();

    // Set up interval for updates
    const interval = setInterval(updateMetrics, refreshInterval);

    return () => clearInterval(interval);
  }, [updateMetrics, refreshInterval]);

  return metrics;
}
