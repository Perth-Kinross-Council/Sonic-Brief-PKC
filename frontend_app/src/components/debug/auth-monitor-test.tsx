/**
 * Auth Monitor Test Component
 * This component displays the current state of the auth monitor for debugging
 */

import { useEffect, useState } from "react";
import { getAuthMonitor } from "@/lib/frontend-auth-monitor";

export function AuthMonitorTest() {
  const [monitorData, setMonitorData] = useState<any>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const updateData = () => {
      try {
        const monitor = getAuthMonitor();
        const metrics = monitor.getMetrics();
        const performanceSummary = monitor.getPerformanceSummary();
        
        setMonitorData({
          metrics,
          performanceSummary,
          timestamp: new Date().toLocaleTimeString()
        });
      } catch (error) {
        setMonitorData({
          error: error instanceof Error ? error.message : 'Failed to get monitor data',
          timestamp: new Date().toLocaleTimeString()
        });
      }
    };

    // Update immediately
    updateData();

    // Update every 2 seconds
    const interval = setInterval(updateData, 2000);

    return () => clearInterval(interval);
  }, []);

  if (!monitorData) {
    return (
      <div className="bg-yellow-50 border border-yellow-300 rounded-md p-3 mb-4">
        <div className="text-yellow-800 text-sm">🔄 Loading auth monitor...</div>
      </div>
    );
  }

  if (monitorData.error) {
    return (
      <div className="bg-red-50 border border-red-300 rounded-md p-3 mb-4">
        <div className="text-red-800 text-sm">❌ {monitorData.error}</div>
      </div>
    );
  }

  const { metrics, performanceSummary } = monitorData;

  return (
    <div className="bg-indigo-50 border border-indigo-300 rounded-md p-3 mb-4">
      <div 
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="text-indigo-800 font-semibold text-sm">
          🔬 Auth Monitor Test Panel
        </div>
        <div className="text-xs text-indigo-600">
          {isExpanded ? '▼' : '▶'} Last update: {monitorData.timestamp}
        </div>
      </div>
      
      {isExpanded && (
        <div className="mt-2 space-y-2 text-xs text-indigo-700">
          <div className="border-b border-indigo-200 pb-1">
            <strong>Quick Stats:</strong>
          </div>
          <div>Token Refreshes: {metrics.tokenRefreshCount}</div>
          <div>Login Attempts: {metrics.loginAttempts}</div>
          <div>Logout Count: {metrics.logoutCount}</div>
          <div>Cache Hit Rate: {metrics.cacheHitRate}%</div>
          <div>Auth Errors: {metrics.authErrors?.length || 0}</div>
          <div>Network Errors: {metrics.networkErrors?.length || 0}</div>
          <div>Avg Response Time: {metrics.averageResponseTime.toFixed(2)}ms</div>
          <div>Peak Response Time: {metrics.peakResponseTime}ms</div>
          <div>Session Duration: {Math.floor((Date.now() - metrics.sessionStartTime) / 1000)}s</div>
          
          {performanceSummary && (
            <>
              <div className="border-b border-indigo-200 pb-1 mt-2">
                <strong>Performance Summary:</strong>
              </div>
              <div>Status: {performanceSummary.status}</div>
              <div>Total Errors: {performanceSummary.errors.totalErrors}</div>
              <div>Error Rate: {performanceSummary.errors.errorRate.toFixed(1)}%</div>
            </>
          )}
          
          {metrics.authErrors && metrics.authErrors.length > 0 && (
            <>
              <div className="border-b border-indigo-200 pb-1 mt-2">
                <strong>Recent Auth Errors:</strong>
              </div>
              {metrics.authErrors.slice(-3).map((error: string, index: number) => (
                <div key={index} className="text-xs text-red-600 bg-red-50 p-1 rounded">
                  {error}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Button to trigger test operations for the auth monitor
 */
export function AuthMonitorTestActions() {
  const handleTestTokenAcquisition = () => {
    const monitor = getAuthMonitor();
    const randomTime = Math.random() * 500 + 100; // 100-600ms
    monitor.recordTokenAcquisition(randomTime, Math.random() > 0.5);
  };

  const handleTestTokenRefresh = () => {
    const monitor = getAuthMonitor();
    monitor.recordTokenRefresh();
  };

  const handleTestLogin = () => {
    const monitor = getAuthMonitor();
    monitor.recordLoginAttempt(true);
  };

  const handleTestError = () => {
    const monitor = getAuthMonitor();
    monitor.recordAuthError('Test error at ' + new Date().toLocaleTimeString());
  };

  const handleUpdateCacheHitRate = () => {
    const monitor = getAuthMonitor();
    const randomRate = Math.random() * 100;
    monitor.updateCacheHitRate(randomRate);
  };

  return (
    <div className="bg-gray-50 border border-gray-300 rounded-md p-3 mb-4">
      <div className="text-gray-800 font-semibold text-sm mb-2">
        🧪 Auth Monitor Test Actions
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleTestTokenAcquisition}
          className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Test Token Acquisition
        </button>
        <button
          onClick={handleTestTokenRefresh}
          className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
        >
          Test Token Refresh
        </button>
        <button
          onClick={handleTestLogin}
          className="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Test Login
        </button>
        <button
          onClick={handleTestError}
          className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
        >
          Test Error
        </button>
        <button
          onClick={handleUpdateCacheHitRate}
          className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
        >
          Update Cache Rate
        </button>
      </div>
    </div>
  );
}
