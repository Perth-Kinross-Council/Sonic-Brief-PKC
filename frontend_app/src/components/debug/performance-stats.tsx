/**
 * Performance Stats Component
 * Displays authentication performance metrics in real-time
 */

import { useReadOnlyAuthMetrics } from "@/lib/read-only-auth-metrics";
import { useState } from "react";

interface PerformanceStatsProps {
  refreshInterval?: number;
  showDetails?: boolean;
  className?: string;
}

export function PerformanceStats({ 
  refreshInterval = 2000, 
  showDetails = true,
  className = ""
}: PerformanceStatsProps) {
  const metrics = useReadOnlyAuthMetrics(refreshInterval);
  const [isVisible, setIsVisible] = useState(true);

  if (!metrics) {
    return (
      <div className={`bg-gray-50 border border-gray-300 rounded-md p-3 ${className}`}>
        <div className="text-gray-600 text-sm">📊 Performance stats not available</div>
      </div>
    );
  }

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getPerformanceStatus = () => {
    if (metrics.averageRefreshTime < 500) return { status: '🟢 Excellent', color: 'text-green-700' };
    if (metrics.averageRefreshTime < 1000) return { status: '🟡 Good', color: 'text-yellow-700' };
    if (metrics.averageRefreshTime < 2000) return { status: '🟠 Warning', color: 'text-orange-700' };
    return { status: '🔴 Critical', color: 'text-red-700' };
  };

  const performanceStatus = getPerformanceStatus();

  return (
    <div className={`bg-green-50 border border-green-300 rounded-md p-3 ${className}`}>
      <div 
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsVisible(!isVisible)}
      >
        <div className="text-green-800 font-semibold text-sm">
          📊 Auth Performance
        </div>
        <div className="text-xs text-green-600">
          {isVisible ? '▼' : '▶'} Click to {isVisible ? 'collapse' : 'expand'}
        </div>
      </div>
      
      {isVisible && (
        <div className="mt-2 space-y-1 text-xs text-green-700">
          {/* Quick Status */}
          <div className="flex justify-between">
            <span className="font-medium">Status:</span>
            <span className={performanceStatus.color}>{performanceStatus.status}</span>
          </div>
          
          {/* Key Metrics */}
          <div className="flex justify-between">
            <span>Token Refreshes:</span>
            <span className="font-mono">{metrics.tokenRefreshCount}</span>
          </div>
          
          <div className="flex justify-between">
            <span>Cache Hit Rate:</span>
            <span className="font-mono">{metrics.hitRate.toFixed(1)}%</span>
          </div>
          
          <div className="flex justify-between">
            <span>Avg Response Time:</span>
            <span className="font-mono">{formatTime(metrics.averageRefreshTime)}</span>
          </div>
          
          <div className="flex justify-between">
            <span>Total Errors:</span>
            <span className="font-mono">{metrics.errorCount}</span>
          </div>

          {/* Detailed Metrics */}
          {showDetails && (
            <>
              <div className="border-t border-green-200 pt-1 mt-2">
                <div className="font-medium mb-1">Detailed Metrics:</div>
                
                <div className="flex justify-between">
                  <span>Cache Hits:</span>
                  <span className="font-mono">{metrics.cacheHits}</span>
                </div>
                
                <div className="flex justify-between">
                  <span>Cache Misses:</span>
                  <span className="font-mono">{metrics.cacheMisses}</span>
                </div>
                
                <div className="flex justify-between">
                  <span>Background Refreshes:</span>
                  <span className="font-mono">{metrics.backgroundRefreshes}</span>
                </div>
                
                <div className="flex justify-between">
                  <span>Preemptive Refreshes:</span>
                  <span className="font-mono">{metrics.preemptiveRefreshes}</span>
                </div>
              </div>
              
              {/* Recent Errors */}
              {metrics.authErrors && metrics.authErrors.length > 0 && (
                <div className="border-t border-green-200 pt-1 mt-2">
                  <div className="font-medium mb-1">Recent Errors:</div>
                  <div className="max-h-20 overflow-y-auto space-y-1">
                    {metrics.authErrors.slice(-3).map((error, index) => (
                      <div key={index} className="text-xs text-red-600 bg-red-50 p-1 rounded">
                        {error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          
          {/* Timestamp */}
          <div className="border-t border-green-200 pt-1 mt-2 text-xs text-green-600">
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact version for dashboards
 */
export function CompactPerformanceStats({ className = "" }: { className?: string }) {
  const metrics = useReadOnlyAuthMetrics(3000);
  
  if (!metrics) {
    return (
      <div className={`text-xs text-gray-500 ${className}`}>
        📊 Stats: N/A
      </div>
    );
  }

  const formatTime = (ms: number) => ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
  
  return (
    <div className={`text-xs ${className}`}>
      📊 {metrics.tokenRefreshCount} refreshes • {metrics.hitRate.toFixed(0)}% cache • {formatTime(metrics.averageRefreshTime)} avg
    </div>
  );
}
