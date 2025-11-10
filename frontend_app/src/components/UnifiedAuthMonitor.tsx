/**
 * Unified Authentication Monitor - Integrates current DiagnosticPanel with EID monitoring
 * Provides comprehensive monitoring for both legacy and Entra ID authentication systems
 */
import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMsal } from "@azure/msal-react";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { fetchJsonStrict } from "@/lib/api";
import { apiUrl } from "@/lib/apiUrl";
import {
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Settings,
  Copy,
  Check,
  Activity,
  Shield,
  Timer,
  Users
} from "lucide-react";

interface AuthMetrics {
  // Relaxed to align with hook which may return 'msal' | 'legacy' | null
  method?: string | null;
  isAuthenticated: boolean;
  // Optional – only shown when available
  tokenExpiry?: number;
  lastActivity?: number;
  user?: any;
  cacheStats?: any;
  debugInfo?: any;
}

interface BackendAuthStats {
  authentication?: {
    method: string;
    enabled_methods: string[];
    legacy_enabled: boolean;
    entra_enabled: boolean;
  };
  services?: {
    app_config?: any;
    cosmos_db?: any;
    entra_service?: any;
    auth_cache?: any;
  };
  jwks_stats?: any;
}

export function UnifiedAuthMonitor() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [authMetrics, setAuthMetrics] = useState<AuthMetrics | null>(null);
  const [backendStats, setBackendStats] = useState<BackendAuthStats | null>(null);
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [copiedRecently, setCopiedRecently] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { accounts } = useMsal();
  // Cast to allow optional debug fields without changing hook contract
  const enhancedAuth = useEnhancedUnifiedAuth() as ReturnType<typeof useEnhancedUnifiedAuth> & {
    debugInfo?: any;
    tokenExpiry?: number;
    lastActivity?: number;
  };

  const log = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
  setLogEntries(prev => [...prev, entry]); // Removed commented console logging
  }, []);

  // Update auth metrics in real-time
  useEffect(() => {
    const updateMetrics = () => {
      const metrics: AuthMetrics = {
        method: enhancedAuth.authMethod as any,
        isAuthenticated: enhancedAuth.isAuthenticated,
        tokenExpiry: enhancedAuth.tokenExpiry,
        lastActivity: enhancedAuth.lastActivity,
        // user/debugInfo are optional; presence depends on hook impl
        user: (enhancedAuth as any).user,
        debugInfo: enhancedAuth.debugInfo
      };
      setAuthMetrics(metrics);
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 1000); // Update every second
    return () => clearInterval(interval);
  }, [enhancedAuth]);

  const fetchBackendAuthStats = useCallback(async () => {
    try {
  const token = await enhancedAuth.getToken();

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Fetch auth info
  let authInfo = null as any;
  try { authInfo = await fetchJsonStrict(apiUrl(`/admin/auth/info`), { headers }); } catch { authInfo = null; }

      // Fetch health check
  let health = null as any;
  try { health = await fetchJsonStrict(apiUrl(`/admin/auth/health`), { headers }); } catch { health = null; }

      // Fetch JWKS stats if available
  let jwksStats = null as any;
  try { jwksStats = await fetchJsonStrict(apiUrl(`/admin/auth/admin/jwks/stats`), { headers }); } catch { jwksStats = null; }

      setBackendStats({
        authentication: authInfo?.authentication,
        services: health?.services,
        jwks_stats: jwksStats?.jwks_stats
      });
    } catch (error) {
      console.error('Failed to fetch backend auth stats:', error);
    }
  }, [enhancedAuth]);

  const refreshAuthState = useCallback(async () => {
    setRefreshing(true);
    try {
      // Behavior-preserving "refresh": clear cache, reacquire token, then refetch backend stats
      enhancedAuth.clearCache?.();
      await enhancedAuth.getToken();
      await fetchBackendAuthStats();
      log('Authentication state refreshed successfully', 'success');
    } catch (error) {
      log(`Failed to refresh auth state: ${error}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }, [enhancedAuth, fetchBackendAuthStats, log]);

  const copyDiagnostics = useCallback(async () => {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      frontend: {
        authMetrics,
        msalAccounts: accounts.length,
        enhancedAuth: {
          isAuthenticated: enhancedAuth.isAuthenticated,
          authMethod: enhancedAuth.authMethod,
          pending: enhancedAuth.pending,
          debugInfo: enhancedAuth.debugInfo
        }
      },
      backend: backendStats,
      logs: logEntries.slice(-50) // Last 50 log entries
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopiedRecently(true);
      setTimeout(() => setCopiedRecently(false), 2000);
    } catch (error) {
      console.error('Failed to copy diagnostics:', error);
    }
  }, [authMetrics, accounts, enhancedAuth, backendStats, logEntries]);

  const getStatusBadge = (status: boolean | string) => {
    if (typeof status === 'boolean') {
      return status ? (
        <Badge variant="default" className="bg-green-100 text-green-800">
          <CheckCircle className="w-3 h-3 mr-1" />
          Active
        </Badge>
      ) : (
        <Badge variant="destructive">
          <XCircle className="w-3 h-3 mr-1" />
          Inactive
        </Badge>
      );
    }

    return <Badge variant="outline">{status}</Badge>;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatDuration = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s ago`;
  };

  useEffect(() => {
    if (isOpen) {
      fetchBackendAuthStats();
    }
  }, [isOpen, fetchBackendAuthStats]);

  if (!isOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          onClick={() => setIsOpen(true)}
          variant="outline"
          size="sm"
          className="shadow-lg bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
          <Activity className="w-4 h-4 mr-2" />
          Auth Monitor
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-4 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border rounded-lg shadow-xl">
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Unified Authentication Monitor
            </CardTitle>
            <CardDescription>
              Real-time monitoring for legacy and Entra ID authentication systems
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={refreshAuthState}
              variant="outline"
              size="sm"
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
            <Button
              onClick={copyDiagnostics}
              variant="outline"
              size="sm"
            >
              {copiedRecently ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
            <Button
              onClick={() => setIsOpen(false)}
              variant="outline"
              size="sm"
            >
              ✕
            </Button>
          </div>
        </CardHeader>
        <CardContent className="h-[calc(100%-8rem)]">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="frontend">Frontend</TabsTrigger>
              <TabsTrigger value="backend">Backend</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="h-[calc(100%-3rem)]">
              <ScrollArea className="h-full">
                <div className="space-y-4">
                  {/* Auth Status Overview */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Users className="w-5 h-5" />
                        Authentication Status
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span>Status:</span>
                        {getStatusBadge(authMetrics?.isAuthenticated ?? false)}
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Method:</span>
                        <Badge variant="outline" className="capitalize">
                          {authMetrics?.method || 'none'}
                        </Badge>
                      </div>
                      {authMetrics?.user && (
                        <div className="flex justify-between items-center">
                          <span>User:</span>
                          <span className="text-sm font-mono">
                            {authMetrics.user.username || authMetrics.user.name || 'Unknown'}
                          </span>
                        </div>
                      )}
                      {authMetrics?.tokenExpiry && (
                        <div className="flex justify-between items-center">
                          <span>Token Expires:</span>
                          <span className="text-sm font-mono">
                            {formatTime(authMetrics.tokenExpiry)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span>Last Activity:</span>
                        <span className="text-sm font-mono">
                          {authMetrics?.lastActivity ? formatDuration(authMetrics.lastActivity) : 'Unknown'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Backend Status */}
                  {backendStats?.authentication && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Settings className="w-5 h-5" />
                          Backend Configuration
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span>Configured Method:</span>
                          <Badge variant="outline">
                            {backendStats.authentication.method}
                          </Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Legacy Enabled:</span>
                          {getStatusBadge(backendStats.authentication.legacy_enabled)}
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Entra Enabled:</span>
                          {getStatusBadge(backendStats.authentication.entra_enabled)}
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Available Methods:</span>
                          <div className="flex gap-1">
                            {(backendStats.authentication.enabled_methods ?? []).length > 0 ? (
                              backendStats.authentication.enabled_methods!.map(method => (
                                <Badge key={method} variant="secondary" className="text-xs">
                                  {method}
                                </Badge>
                              ))
                            ) : (
                              <Badge variant="outline" className="text-xs">none</Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Frontend Tab */}
            <TabsContent value="frontend" className="h-[calc(100%-3rem)]">
              <ScrollArea className="h-full">
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Enhanced Auth Manager</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm font-mono">
                        <div>Authenticated: {enhancedAuth.isAuthenticated ? '✅' : '❌'}</div>
                        <div>Method: {enhancedAuth.authMethod}</div>
                        <div>Pending: {enhancedAuth.pending ? '✅' : '❌'}</div>
                        {enhancedAuth.debugInfo && (
                          <>
                            <div>Cache Hit: {enhancedAuth.debugInfo.cacheHit ? '✅' : '❌'}</div>
                            <div>Needs Refresh: {enhancedAuth.debugInfo.needsRefresh ? '✅' : '❌'}</div>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>MSAL State</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm font-mono">
                        <div>Accounts: {accounts.length}</div>
                        {accounts.map((account, index) => (
                          <div key={index} className="pl-4">
                            <div>• {account.username}</div>
                            <div className="pl-2 text-gray-500">
                              {account.name || 'No display name'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Backend Tab */}
            <TabsContent value="backend" className="h-[calc(100%-3rem)]">
              <ScrollArea className="h-full">
                <div className="space-y-4">
                  {backendStats?.services && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Service Health</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {Object.entries(backendStats.services).map(([service, status]: [string, any]) => (
                            <div key={service} className="flex justify-between items-center">
                              <span className="capitalize">{service.replace('_', ' ')}:</span>
                              {getStatusBadge(status?.status === 'healthy')}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {backendStats?.jwks_stats && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Timer className="w-4 h-4" />
                          JWKS Cache
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span>Cache Valid:</span>
                            {getStatusBadge(backendStats.jwks_stats?.cache_valid ?? false)}
                          </div>
                          <div className="flex justify-between">
                            <span>Keys Count:</span>
                            <span>{backendStats.jwks_stats?.keys_count ?? 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Cache Age:</span>
                            <span>{Math.floor(backendStats.jwks_stats?.cache_age_seconds ?? 0)}s</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Last Fetch:</span>
                            <span className="font-mono text-xs">
                              {backendStats.jwks_stats?.last_fetch
                                ? new Date(backendStats.jwks_stats.last_fetch as any).toLocaleTimeString()
                                : 'Never'
                              }
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Logs Tab */}
            <TabsContent value="logs" className="h-[calc(100%-3rem)]">
              <ScrollArea className="h-full">
                <div className="space-y-2">
                  {logEntries.map((entry, index) => (
                    <div key={index} className="text-xs font-mono p-2 bg-gray-50 rounded">
                      {entry}
                    </div>
                  ))}
                  {logEntries.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                      No log entries yet. Activity will appear here.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
