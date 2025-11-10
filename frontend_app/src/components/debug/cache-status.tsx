/**
 * Cache Status Component
 * Shows real-time cache usage and effectiveness
 */

import { useEffect, useState } from "react";
import { getReadOnlyAuthMetrics } from "@/lib/read-only-auth-metrics";

interface CacheStatus {
  isEnabled: boolean;
  isWorking: boolean;
  hitRate: number;
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
  status: 'excellent' | 'good' | 'poor' | 'not-working';
  message: string;
}

export function CacheStatusComponent() {
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);

  useEffect(() => {
    const updateCacheStatus = () => {
      const metrics = getReadOnlyAuthMetrics();
      
      if (!metrics) {
        setCacheStatus({
          isEnabled: false,
          isWorking: false,
          hitRate: 0,
          totalRequests: 0,
          cacheHits: 0,
          cacheMisses: 0,
          cacheSize: 0,
          status: 'not-working',
          message: 'Cache metrics not available'
        });
        return;
      }

      const totalRequests = metrics.cacheHits + metrics.cacheMisses;
      const hitRate = metrics.hitRate;
      
      let status: 'excellent' | 'good' | 'poor' | 'not-working';
      let message: string;
      let isWorking = false;

      if (totalRequests === 0) {
        status = 'not-working';
        message = 'No cache requests detected yet';
      } else if (hitRate >= 80) {
        status = 'excellent';
        message = 'Cache is working excellently!';
        isWorking = true;
      } else if (hitRate >= 60) {
        status = 'good';
        message = 'Cache is working well';
        isWorking = true;
      } else if (hitRate >= 30) {
        status = 'poor';
        message = 'Cache hit rate is low';
        isWorking = true;
      } else {
        status = 'poor';
        message = 'Cache is barely working';
        isWorking = true;
      }

      setCacheStatus({
        isEnabled: true,
        isWorking,
        hitRate,
        totalRequests,
        cacheHits: metrics.cacheHits,
        cacheMisses: metrics.cacheMisses,
        cacheSize: metrics.cacheSize,
        status,
        message
      });
    };

    // Update immediately
    updateCacheStatus();

    // Update every 2 seconds
    const interval = setInterval(updateCacheStatus, 2000);

    return () => clearInterval(interval);
  }, []);

  if (!cacheStatus) {
    return (
      <div className="bg-gray-50 border border-gray-300 rounded-md p-3">
        <div className="text-gray-600 text-sm">🔄 Checking cache status...</div>
      </div>
    );
  }

  const getStatusColor = () => {
    switch (cacheStatus.status) {
      case 'excellent': return 'bg-green-50 border-green-300 text-green-800';
      case 'good': return 'bg-blue-50 border-blue-300 text-blue-800';
      case 'poor': return 'bg-yellow-50 border-yellow-300 text-yellow-800';
      case 'not-working': return 'bg-red-50 border-red-300 text-red-800';
      default: return 'bg-gray-50 border-gray-300 text-gray-800';
    }
  };

  const getStatusIcon = () => {
    switch (cacheStatus.status) {
      case 'excellent': return '🟢';
      case 'good': return '🔵';
      case 'poor': return '🟡';
      case 'not-working': return '🔴';
      default: return '⚪';
    }
  };

  return (
    <div className={`border rounded-md p-3 ${getStatusColor()}`}>
      <div className="flex justify-between items-center mb-2">
        <div className="font-semibold text-sm">
          {getStatusIcon()} Cache Status
        </div>
        <div className="text-xs">
          {cacheStatus.isWorking ? 'ACTIVE' : 'INACTIVE'}
        </div>
      </div>
      
      <div className="text-sm mb-2">
        <strong>Answer:</strong> {cacheStatus.message}
      </div>
      
      {cacheStatus.totalRequests > 0 && (
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span>Hit Rate:</span>
            <span className="font-mono font-bold">{cacheStatus.hitRate.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Cache Hits:</span>
            <span className="font-mono">{cacheStatus.cacheHits}</span>
          </div>
          <div className="flex justify-between">
            <span>Cache Misses:</span>
            <span className="font-mono">{cacheStatus.cacheMisses}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Requests:</span>
            <span className="font-mono">{cacheStatus.totalRequests}</span>
          </div>
          <div className="flex justify-between">
            <span>Cache Size:</span>
            <span className="font-mono">{cacheStatus.cacheSize} tokens</span>
          </div>
        </div>
      )}
      
      {cacheStatus.totalRequests === 0 && (
        <div className="text-xs mt-2 p-2 bg-white bg-opacity-50 rounded">
          <strong>💡 Tip:</strong> Try refreshing the page or triggering some authentication actions to see cache activity.
        </div>
      )}
    </div>
  );
}

/**
 * Simple one-liner cache status
 */
export function SimpleCacheStatus() {
  const [answer, setAnswer] = useState<string>("Checking...");

  useEffect(() => {
    const checkCache = () => {
      const metrics = getReadOnlyAuthMetrics();
      
      if (!metrics) {
        setAnswer("❓ Cache status unknown");
        return;
      }

      const totalRequests = metrics.cacheHits + metrics.cacheMisses;
      
      if (totalRequests === 0) {
        setAnswer("🔴 No cache activity detected yet");
      } else if (metrics.hitRate >= 60) {
        setAnswer(`🟢 YES - Cache working well (${metrics.hitRate.toFixed(0)}% hit rate)`);
      } else if (metrics.hitRate >= 30) {
        setAnswer(`🟡 Partially - Cache hit rate is ${metrics.hitRate.toFixed(0)}%`);
      } else {
        setAnswer(`🔴 Poorly - Cache hit rate only ${metrics.hitRate.toFixed(0)}%`);
      }
    };

    checkCache();
    const interval = setInterval(checkCache, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-sm">
      <strong>Is the cache being used?</strong> {answer}
    </div>
  );
}
